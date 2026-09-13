import React, { useState, useRef } from "react";
import { SLRRecord, ScreeningDecision, SLRProtocol } from "../types/slr";
import {
  Sparkles,
  AlertCircle,
  Download,
  FileText,
  KeyRound,
} from "lucide-react";
import { AIProviderConfig, AIRequestError, callAI, parseJSONLoose } from "../utils/aiClient";
import StudyCharacteristicsTable from "./StudyCharacteristicsTable";

const STRICT_SCREENING_THRESHOLD = 85;

interface ScreeningSectionProps {
  records: SLRRecord[];
  dupesRemoved: number;
  screening: Record<string, ScreeningDecision>;
  onUpdateScreening: (screening: Record<string, ScreeningDecision>) => void;
  protocol: SLRProtocol;
  aiConfig: AIProviderConfig;
  onReplaceGeminiApiKey?: (apiKey: string) => void;
}

export default function ScreeningSection({
  records,
  dupesRemoved,
  screening,
  onUpdateScreening,
  protocol,
  aiConfig,
  onReplaceGeminiApiKey,
}: ScreeningSectionProps) {
  const [runningScreening, setRunningScreening] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [replacementGeminiKey, setReplacementGeminiKey] = useState("");
  const screeningRunRef = useRef(false);
  const screeningPool = records;

  const includedRecords = screeningPool
    .filter((record) => screening[record.id]?.agreed === true)
    .sort((a, b) => (screening[b.id]?.score || 0) - (screening[a.id]?.score || 0));
  const includedCount = includedRecords.length;
  const afterDedupCount = screeningPool.length;
  const excludedCount = screeningPool.filter((record) => screening[record.id]?.agreed === false).length;
  const unresolvedCount = Math.max(0, afterDedupCount - includedCount - excludedCount);
  const exclusionBreakdown = screeningPool.reduce<Record<string, number>>((acc, record) => {
    const decision = screening[record.id];
    if (decision?.agreed === false) {
      const reason = decision.exclusionReason || "Other";
      acc[reason] = (acc[reason] || 0) + 1;
    }
    return acc;
  }, {});

  const downloadPrismaSynthesisReport = () => {
    const report = [
      `# PRISMA Synthesis Report`,
      ``,
      `## Review`,
      protocol.title || "Untitled systematic review",
      ``,
      `## Exclusion reasons`,
      ...(Object.entries(exclusionBreakdown).length > 0
        ? Object.entries(exclusionBreakdown).map(([reason, count]) => `- ${reason}: ${count}`)
        : ["- No exclusions recorded."]),
      ``,
      `## Screening status`,
      `- Included: ${includedCount}`,
      `- Excluded: ${excludedCount}`,
      `- Unresolved: ${unresolvedCount}`,
      ``,
      `## Included records and screening justifications`,
      ...(includedRecords.length > 0
        ? includedRecords.map((record, index) => {
            const authors = record.authors?.join(", ") || "Authors not reported";
            const source = record.source || "Source not reported";
            const reason = screening[record.id]?.reason || "No justification recorded.";
            return `${index + 1}. **${record.title}** — ${authors} — ${source}\n   ${reason}`;
          })
        : ["No records are currently included."]),
      ``,
      `## Evidence-synthesis status`,
      `This report summarizes uploaded citation records and recorded screening decisions. Narrative findings should be generated only from information contained in the uploaded records or separately verified full texts. No pooled effects, heterogeneity statistics, risk-of-bias judgments, or certainty ratings are inferred.`,
    ].join("\n");

    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "PRISMA_Synthesis_Report.md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // AI-assisted screening
 const runAIScreening = async (
  configOverride?: AIProviderConfig
) => {
  if (
    screeningPool.length === 0 ||
    screeningRunRef.current
  ) {
    return;
  }

  screeningRunRef.current = true;
  setRunningScreening(true);
  setProgress(0);
  setErrorMessage(null);

  const unresolvedRecords =
    screeningPool.filter(
      (record) =>
        screening[record.id]?.agreed === undefined
    );

  if (unresolvedRecords.length === 0) {
    setErrorMessage(
      "All imported records already have screening decisions. No new AI calls were made."
    );

    screeningRunRef.current = false;
    setRunningScreening(false);
    return;
  }

  /*
   * Small batches are intentional.
   * Keeping the batch small reduces malformed JSON and
   * makes partial recovery possible.
   */
  const batchSize = 4;

  const recordsToScreen = unresolvedRecords;

  const totalBatches = Math.ceil(
    recordsToScreen.length / batchSize
  );

  const nextScreening = {
    ...screening,
  };

  const effectiveThreshold = Math.max(
    STRICT_SCREENING_THRESHOLD,
    protocol.selectionProcess.screeningThreshold || 0
  );

  try {
    for (
      let b = 0;
      b < totalBatches;
      b++
    ) {
      const batch = recordsToScreen.slice(
        b * batchSize,
        (b + 1) * batchSize
      );

      const batchIds = new Set(
        batch.map((record) => record.id)
      );

      /*
       * Give the model enough record-level information
       * to make a defensible screening decision.
       */
      const payload = batch.map((record) => ({
        id: record.id,
        title: record.title || "",
        abstract: (record.abstract || "").slice(
          0,
          2000
        ),
        authors: Array.isArray(record.authors)
          ? record.authors
          : [],
        year: record.year || "",
        journal:
          (record as any).journal ||
          (record as any).source ||
          "",
        keywords:
          Array.isArray((record as any).keywords)
            ? (record as any).keywords
            : [],
      }));

      const prompt = `
SYSTEMATIC REVIEW SCREENING

Protocol title:
"${protocol.title}"

INCLUSION CRITERIA:
${protocol.eligibilityCriteria.inclusion
  .map((item) => `- ${item}`)
  .join("\n")}

EXCLUSION CRITERIA:
${protocol.eligibilityCriteria.exclusion
  .map((item) => `- ${item}`)
  .join("\n")}

SCREENING THRESHOLD:
${effectiveThreshold}/100

TASK:

Screen each supplied record independently using ONLY the
information contained in that record and the supplied review
criteria.

This is RECORD-LEVEL TITLE/ABSTRACT SCREENING.

Do not claim that the full text was reviewed.

Do not infer missing information.

Do not assume that a study is eligible merely because it
shares keywords with the review topic.

For each record:

1. Determine whether the available record information
   supports inclusion.
2. Assign an eligibility score from 0 to 100.
3. Provide a concise criterion-specific reason.
4. If the evidence is insufficient for inclusion, score it
   below ${effectiveThreshold}.
5. Select the most appropriate exclusion reason when
   excluding.

IMPORTANT:

- Every supplied record MUST have exactly one decision.
- Do not omit a record.
- Use the exact record ID supplied.
- Do not invent record IDs.
- Do not add records that were not supplied.
- Do not return Markdown.
- Do not return explanatory text outside the JSON.
- Return valid JSON only.

VALID EXCLUSION REASONS:

"Secondary literature / Review paper"
"Out of scope / Keyword mismatch"
"Wrong population"
"Wrong intervention / exposure"
"Wrong comparator"
"Wrong outcome"
"Wrong study design"
"Not accessible / full text unavailable"
"Duplicate / non-original"
"Language barrier"
"Other"

SUPPLIED RECORDS:

${JSON.stringify(payload, null, 2)}

RETURN EXACTLY THIS JSON STRUCTURE:

{
  "decisions": [
    {
      "id": "exact supplied record id",
      "score": 0,
      "reason": "criterion-specific justification",
      "exclusionReason": "Wrong population"
    }
  ]
}
`;

      let batchCompleted = false;

      try {
        const text = await callAI(
          prompt,
          "You are an expert systematic review screening methodologist. Return only valid JSON.",
          configOverride || aiConfig,
          1800
        );

        let parsed: any;

        try {
          parsed = parseJSONLoose(text);
        } catch {
          parsed = null;
        }

        /*
         * Accept both:
         *
         * { decisions: [...] }
         *
         * and the older:
         *
         * [...]
         *
         * format.
         */
        const decisions = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.decisions)
            ? parsed.decisions
            : [];

        if (decisions.length === 0) {
          throw new Error(
            "AI returned no usable screening decisions."
          );
        }

        let acceptedDecisions = 0;

        for (const decision of decisions) {
          if (
            !decision ||
            !batchIds.has(decision.id)
          ) {
            continue;
          }

          const numericScore =
            typeof decision.score === "number"
              ? decision.score
              : Number(decision.score);

          if (
            !Number.isFinite(numericScore)
          ) {
            continue;
          }

          const finalScore = Math.max(
            0,
            Math.min(100, numericScore)
          );

          const isInclude =
            finalScore >= effectiveThreshold;

          nextScreening[decision.id] = {
            score: finalScore,

            reason:
              typeof decision.reason === "string" &&
              decision.reason.trim()
                ? decision.reason.trim()
                : isInclude
                  ? "The supplied record supports the eligibility criteria."
                  : "The supplied record does not sufficiently support the eligibility criteria.",

            decision: isInclude
              ? "include"
              : "exclude",

            agreed: isInclude,

            exclusionReason: !isInclude
              ? decision.exclusionReason ||
                "Other"
              : undefined,
          };

          acceptedDecisions += 1;
        }

        /*
         * A malformed/partial response must not silently
         * mark missing records as excluded.
         */
        const unresolvedBatchRecords =
          batch.filter(
            (record) =>
              nextScreening[record.id]
                ?.agreed === undefined
          );

        if (
          unresolvedBatchRecords.length > 0
        ) {
          console.warn(
            `Screening batch ${b + 1} returned ${acceptedDecisions}/${batch.length} usable decisions.`,
            unresolvedBatchRecords.map(
              (record) => record.id
            )
          );

          throw new Error(
            `AI returned only ${acceptedDecisions} of ${batch.length} valid screening decisions.`
          );
        }

        batchCompleted = true;
      } catch (err: any) {
        console.warn(
          "AI screening batch error:",
          err
        );

        const isProviderQuotaError =
          /quota|rate limit|resource[_\s-]?exhausted|exceeded your current quota|insufficient credits|credits/i.test(
            err?.message || ""
          );

        /*
         * Save all successfully completed decisions
         * before reporting the failure.
         */
        onUpdateScreening({
          ...nextScreening,
        });

        const remainingUnresolved =
          screeningPool.filter(
            (record) =>
              nextScreening[record.id]
                ?.agreed === undefined
          ).length;

        setErrorMessage(
          `AI screening could not complete batch ${
            b + 1
          }. Completed decisions were kept; ${
            remainingUnresolved
          } record${
            remainingUnresolved === 1
              ? ""
              : "s"
          } remain unresolved. ${
            err?.message ||
            "The AI response could not be parsed."
          }`
        );

        /*
         * Stop immediately on quota/rate-limit errors.
         * The user can continue later without losing
         * completed screening decisions.
         */
        if (isProviderQuotaError) {
          setProgress(
            Math.round(
              (b / totalBatches) * 100
            )
          );

          break;
        }

        /*
         * Stop on malformed responses as well.
         * We do NOT automatically repeat the same API call,
         * because that would increase API usage.
         *
         * The user can press Continue AI Screening later.
         */
        break;
      }

      if (!batchCompleted) {
        break;
      }

      setProgress(
        Math.round(
          ((b + 1) / totalBatches) * 100
        )
      );

      onUpdateScreening({
        ...nextScreening,
      });
    }
  } finally {
    screeningRunRef.current = false;
    setRunningScreening(false);
  }
};

    const unresolvedRecords = screeningPool.filter(
      (record) => screening[record.id]?.agreed === undefined
    );
    if (unresolvedRecords.length === 0) {
      setErrorMessage("All imported records already have screening decisions. No new AI calls were made.");
      screeningRunRef.current = false;
      setRunningScreening(false);
      return;
    }
    const recordsToScreen = unresolvedRecords;
    const batchSize = 4;
    const totalBatches = Math.ceil(recordsToScreen.length / batchSize);
    const nextScreening = { ...screening };

    try {
      for (let b = 0; b < totalBatches; b++) {
        const batch = recordsToScreen.slice(b * batchSize, (b + 1) * batchSize);
        const batchIds = new Set(batch.map((record) => record.id));
        const payload = batch.map((r) => ({
          id: r.id,
          title: r.title,
          abstract: (r.abstract || "").slice(0, 500),
        }));

        const effectiveThreshold = Math.max(
          STRICT_SCREENING_THRESHOLD,
          protocol.selectionProcess.screeningThreshold || 0
        );
        const prompt = `Systematic Review Protocol Title: "${protocol.title}"
Inclusion Criteria: ${protocol.eligibilityCriteria.inclusion.join("; ")}
Exclusion Criteria: ${protocol.eligibilityCriteria.exclusion.join("; ")}

Apply a strict record-evidence screening gate to every study. Include only when the supplied record details explicitly support the review population, intervention or exposure, outcome, and eligible study design. Do not infer eligibility from keyword overlap, topic similarity, or absent information. Ambiguous records and records without enough evidence must score below ${effectiveThreshold} and be excluded at this stage; full-text verification is not claimed.
Calculate an overall eligibility score (0-100) and give a concise, criterion-specific justification.
If score < ${effectiveThreshold}, choose the best-supported exclusion reason: "Secondary literature / Review paper" | "Out of scope / Keyword mismatch" | "Wrong population" | "Wrong intervention / exposure" | "Wrong comparator" | "Wrong outcome" | "Wrong study design" | "Not accessible / full text unavailable" | "Duplicate / non-original" | "Language barrier" | "Other".

Studies:
${JSON.stringify(payload)}

Return ONLY a JSON array:
[
  {
    "id": "...",
    "score": 90,
    "reason": "...",
    "exclusionReason": "Wrong population" (optional)
  }
]`;

        try {
          const text = await callAI(
            prompt,
            "You are a medical librarian and PRISMA screening methodologist.",
            configOverride || aiConfig,
            1200
          );
          const parsed = parseJSONLoose(text);
          if (!Array.isArray(parsed)) {
            throw new Error("AI returned an invalid screening response.");
          }
          parsed.forEach((p: any) => {
              if (!batchIds.has(p.id)) return;
              const finalScore = p.score ?? null;
              const isInclude = finalScore !== null && finalScore >= effectiveThreshold;

              nextScreening[p.id] = {
                score: finalScore,
                reason: p.reason || (isInclude ? "Meets PICO criteria and keyword match" : "Does not meet criteria"),
                decision: isInclude ? "include" : "exclude",
                agreed: isInclude,
                exclusionReason: !isInclude ? p.exclusionReason || "Wrong study design" : undefined,
              };
            });
        } catch (err: any) {
          console.warn("AI screening batch error:", err);
          const remainingUnresolved = screeningPool.filter(
            (record) => nextScreening[record.id]?.agreed === undefined
          ).length;
          const isProviderQuotaError =
            /quota|rate limit|resource[_\s-]?exhausted|exceeded your current quota|insufficient credits|credits/i.test(
              err?.message || ""
            );
          setErrorMessage(
            `AI screening could not complete batch ${b + 1}. Completed decisions were kept; ${remainingUnresolved} affected record${remainingUnresolved === 1 ? "" : "s"} remain unresolved. ${err?.message || "Request failed."}`
          );
          onUpdateScreening({ ...nextScreening });
          if (isProviderQuotaError) {
            setProgress(Math.round((b / totalBatches) * 100));
            break;
          }
        }

        setProgress(Math.round(((b + 1) / totalBatches) * 100));
        onUpdateScreening({ ...nextScreening });
      }
    } finally {
      screeningRunRef.current = false;
      setRunningScreening(false);
    }
  };

  return (
    <div id="screening-section-container" className="space-y-6">
      {/* Error / Notice message */}
      {errorMessage && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-amber-900">
          <div className="flex items-start justify-between gap-3 text-xs font-mono">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="shrink-0 font-bold text-amber-700 hover:text-amber-900">
              ✕
            </button>
          </div>
          {unresolvedCount > 0 &&
            onReplaceGeminiApiKey &&
            (aiConfig.provider === "gemini" ||
              /openrouter|insufficient credits|quota|credits/i.test(errorMessage)) && (
            <form
              className="rounded-lg border border-amber-200 bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const nextKey = replacementGeminiKey.trim();
                if (!nextKey) return;
                onReplaceGeminiApiKey(nextKey);
                setReplacementGeminiKey("");
                void runAIScreening({ ...aiConfig, provider: "gemini", apiKey: nextKey });
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {aiConfig.provider === "gemini"
                      ? "Continue with another Gemini API key"
                      : "Switch from OpenRouter to Gemini"}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Enter a Google AI Studio key. It will be saved as the active Gemini provider in this browser, then resume the {unresolvedCount} unresolved record{unresolvedCount === 1 ? "" : "s"}.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={replacementGeminiKey}
                  onChange={(event) => setReplacementGeminiKey(event.target.value)}
                  placeholder="Enter a new Gemini API key"
                  aria-label="New Gemini API key"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="submit"
                  disabled={runningScreening || !replacementGeminiKey.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:bg-slate-300"
                >
                  Save key & resume
                </button>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                Direct-provider keys stay in browser storage and are sent directly to Gemini.
              </p>
            </form>
          )}
        </div>
      )}

      {/* Header Card */}
      <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] text-indigo-600 uppercase tracking-wider font-bold">
               PRISMA 2020 Items 8, 16a & 16b · Investigator Screening
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mt-0.5">
              Study Selection & Screening Review
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Screen every imported record using a strict record-evidence gate. New imports and interrupted batches remain pending until screening completes; existing decisions are preserved.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void runAIScreening()}
              disabled={runningScreening || screeningPool.length === 0 || unresolvedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              {runningScreening
                ? `Screening (${progress}%)...`
                : unresolvedCount === 0
                  ? "Screening complete"
                  : "Continue AI Screening"}
            </button>
          </div>
        </div>

        {/* Progress bar if running */}
        {runningScreening && (
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
            <div style={{ width: `${progress}%` }} className="bg-indigo-600 h-full transition-all duration-300" />
          </div>
        )}

        {Object.keys(screening).length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50/80 border border-slate-200 rounded-xl">
            <div className="font-mono text-xs text-slate-800 flex items-center gap-3">
              <span className="text-emerald-700 font-semibold">{includedCount} Included</span>
              <span className="text-rose-700 font-semibold">{excludedCount} Excluded</span>
              <span className="text-amber-700 font-semibold">{unresolvedCount} Unresolved</span>
            </div>
          </div>
        )}
      </div>

      <StudyCharacteristicsTable
        screeningRecords={includedRecords}
        screening={screening}
      />

      <section className="bg-slate-950 text-slate-100 border border-slate-800 p-6 rounded-xl shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] text-indigo-300 uppercase tracking-wider font-bold">
              Uploaded Records · PRISMA 2020 Evidence Summary
            </div>
            <h3 className="text-xl font-bold mt-1 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-300" />
              PRISMA Synthesis Report
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Automatically summarizes all uploaded records, current screening outcomes, exclusion reasons, and the included synthesis set without claiming unverified full-text results.
            </p>
          </div>
          <button
            onClick={downloadPrismaSynthesisReport}
            disabled={screeningPool.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-semibold text-slate-950 bg-white hover:bg-slate-100 disabled:bg-slate-700 disabled:text-slate-400 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Report
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ["Uploaded", screeningPool.length + dupesRemoved],
            ["After deduplication", afterDedupCount],
            ["Included", includedCount],
            ["Excluded", excludedCount],
             ["Unresolved", unresolvedCount],
          ].map(([label, value]) => (
            <div key={label} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-mono uppercase text-slate-500">{label}</div>
              <div className="text-xl font-bold mt-1">{value}</div>
            </div>
          ))}
        </div>

        <div className="text-xs">
          <h4 className="font-mono font-bold text-slate-200 mb-2">Recorded exclusion reasons</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(exclusionBreakdown).length > 0 ? (
              Object.entries(exclusionBreakdown).map(([reason, count]) => (
                <span key={reason} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300">
                  {reason}: {count}
                </span>
              ))
            ) : (
              <span className="text-slate-500">No exclusions recorded yet.</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
