import React, { useMemo, useState } from "react";
import {
  SLRProtocol,
  SLRRecord,
  SynthesisResult,
  StudyCharacteristic,
} from "../types/slr";
import {
  Sparkles,
  BookOpen,
  Filter,
  Copy,
  Zap,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { callAI, parseJSONLoose } from "../utils/aiClient";
import { getIncludedEvidenceKey } from "../utils/evidenceKey";
import {
  buildEvidenceBudget,
} from "../utils/evidenceSelection";

interface SynthesisSectionProps {
  protocol: SLRProtocol;
  onUpdateProtocol: (protocol: SLRProtocol) => void;
  synthesis: SynthesisResult;
  onUpdateSynthesis: (synthesis: SynthesisResult) => void;
  includedRecords: SLRRecord[];
  characteristics: StudyCharacteristic[];
  aiConfig: any;
  onNavigateToScreening?: () => void;
}

const MIN_SYNTHESIS_CLUSTERS = 3;

type SynthesisStudy = StudyCharacteristic & {
  recordId: string;
  authorYear: string;
};

const RECORD_NOT_REPORTED = "Not reported in the supplied record";

const firstAuthorSurname = (record: SLRRecord) => {
  const firstAuthor = record.authors?.[0]?.trim();

  if (!firstAuthor) return "Author";

  return firstAuthor.includes(",")
    ? firstAuthor.split(",")[0].trim()
    : firstAuthor.split(/\s+/).slice(-1)[0] || "Author";
};

const authorYearLabel = (record: SLRRecord) =>
  `${firstAuthorSurname(record)} et al. (${record.year || "n.d."})`;

const cleanText = (value: any) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const buildStudiesFromRecords = (
  records: SLRRecord[],
  characteristics: StudyCharacteristic[]
): SynthesisStudy[] => {
  const characteristicMap = new Map<string, StudyCharacteristic>();

  characteristics.forEach((characteristic) => {
    if (characteristic.recordId) {
      characteristicMap.set(characteristic.recordId, characteristic);
    }
  });

  return records.map((record) => {
    const characteristic = characteristicMap.get(record.id);

    return {
      recordId: record.id,
      authorYear: authorYearLabel(record),

      country:
        cleanText(characteristic?.country) || RECORD_NOT_REPORTED,

      sampleSize:
        cleanText(characteristic?.sampleSize) || RECORD_NOT_REPORTED,

      population:
        cleanText(characteristic?.population) || RECORD_NOT_REPORTED,

      interventionOrFocus:
        cleanText(characteristic?.interventionOrFocus) ||
        cleanText(record.title) ||
        RECORD_NOT_REPORTED,

      comparator:
        cleanText(characteristic?.comparator) || RECORD_NOT_REPORTED,

      primaryOutcome:
        cleanText(characteristic?.primaryOutcome) || RECORD_NOT_REPORTED,

      studyDesign:
        cleanText(characteristic?.studyDesign) || RECORD_NOT_REPORTED,

      keyFinding:
        cleanText(characteristic?.keyFinding) ||
        cleanText(record.abstract)?.slice(0, 500) ||
        RECORD_NOT_REPORTED,

      category:
        cleanText(characteristic?.category) || "Uncategorized evidence",
    };
  });
};

const titleStopWords = new Set([
  "about", "across", "after", "among", "analysis", "approach", "approaches",
  "based", "between", "clinical", "data", "early", "evidence", "from",
  "health", "included", "literature", "model", "models", "outcomes",
  "reported", "review", "studies", "study", "systematic", "using",
  "with", "within", "type", "types",
]);

const getRecordTitleTerms = (records: SLRRecord[]) => {
  const documentFrequency = new Map<string, number>();
  const minimumFrequency = records.length >= 4 ? 2 : 1;

  records.forEach((record) => {
    const seen = new Set<string>();
    const rawTitle = cleanText(record.title).replace(/&/g, " and ");
    rawTitle.match(/[A-Za-z][A-Za-z'-]*/g)?.forEach((rawWord) => {
      const word = rawWord.toLowerCase().replace(/^['-]+|['-]+$/g, "");
      const looksLikeAbbreviation =
        /^[A-Z0-9]{2,8}$/.test(rawWord) ||
        word.length < 4 ||
        !/[aeiouy]/.test(word) ||
        /(.)\1{2,}/.test(word);

      if (
        !word ||
        titleStopWords.has(word) ||
        looksLikeAbbreviation ||
        seen.has(word)
      ) {
        return;
      }

      seen.add(word);
    });

    seen.forEach((word) => {
      documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
    });
  });

  return Array.from(documentFrequency.entries())
    .filter(([, frequency]) => frequency >= minimumFrequency)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
};

const suggestReviewTitles = (records: SLRRecord[]) => {
  const evidenceTerms = getRecordTitleTerms(records);
  const subject = evidenceTerms.length >= 2
    ? evidenceTerms.join(", ")
    : cleanText(records[0]?.title) || "The Included Evidence";

  return Array.from(new Set([
    `A Narrative Synthesis of ${subject}`,
    `A PRISMA 2020 Systematic Review of ${subject}`,
    `${subject} Across the Included Studies`,
    `Evidence on ${subject} in the Included Literature`,
    `A Systematic Review of ${subject} and Reported Outcomes`,
  ]));
};

const buildTitleSourceRecords = (
  records: SLRRecord[],
  characteristics: StudyCharacteristic[]
) => {
  const characteristicMap = new Map(
    characteristics.map((characteristic) => [
      characteristic.recordId,
      characteristic,
    ])
  );
  return records.map((record) => {
    const characteristic = characteristicMap.get(record.id);
    const sourceRecord: Record<string, unknown> = {
      id: record.id,
      title: cleanText(record.title),
      authors: Array.isArray(record.authors) ? record.authors : [],
      year: cleanText(record.year),
      abstract: cleanText(record.abstract),
    };

    if (characteristic) {
      sourceRecord.studyCharacteristic = Object.fromEntries(
        Object.entries(characteristic).filter(([, value]) => {
          if (Array.isArray(value)) return value.length > 0;
          return cleanText(value) !== "";
        })
      );
    }

    return sourceRecord;
  });
};

const sanitizeTitleCandidates = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  const prohibitedTerms = /\b(ai|artificial intelligence|software|automated screening|this application)\b/i;

  return value
    .map((title) => cleanText(title).replace(/^["']|["']$/g, ""))
    .filter(
      (title) =>
        title.length >= 20 &&
        title.length <= 180 &&
        !prohibitedTerms.test(title)
    )
    .filter((title, index, titles) =>
      titles.findIndex((candidate) => candidate.toLowerCase() === title.toLowerCase()) === index
    )
    .slice(0, 5);
};

const completeTitleCandidates = (
  candidates: string[],
  fallbackTitles: string[]
) => Array.from(new Set([...candidates, ...fallbackTitles])).slice(0, 5);

const limitWords = (value: string, maximum: number) => {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length <= maximum) return words.join(" ");
  return `${words.slice(0, maximum).join(" ").replace(/[,:;.!?]+$/, "")}.`;
};

/*
 * Conservative fallback only. It does not invent themes or force studies
 * into application-defined domains. The AI path remains the primary route
 * for integrated thematic synthesis.
 */
const buildFallbackNarrative = (studies: SynthesisStudy[]) => {
  if (studies.length === 0) return "";

  const opening = "Across the included literature, the supplied records describe the reported research approaches, contexts, and findings.";

  const usable = studies.filter(
    (study) => cleanText(study.keyFinding) && cleanText(study.keyFinding) !== RECORD_NOT_REPORTED
  );

  if (usable.length === 0) {
    return `${opening} Specific findings and relationships between studies are not reported in sufficient detail in the supplied records to support a more developed thematic synthesis.`;
  }

  const excerpts = usable.slice(0, 12).map((study) => {
    const finding = cleanText(study.keyFinding);
    const sentence = finding.split(/(?<=[.!?])\s+/)[0].slice(0, 280).trim();
    return `${sentence} (${study.authorYear})`;
  });

  return `${opening} The available evidence spans related but not necessarily equivalent contexts, approaches, and outcomes. ${excerpts.join(" ")} Taken together, these records indicate multiple dimensions of the review topic, while the supplied record-level information does not support stronger claims about comparative effectiveness, causal relationships, or quantitative consistency.`;
};

const buildFallbackSubtopics = (studies: SynthesisStudy[]) => {
  if (studies.length === 0) return [];

  return [{
    title: "Included Evidence",
    prose: limitWords(buildFallbackNarrative(studies), 1500),
    supportingRecordIds: studies.map((study) => study.recordId),
  }];
};

/*
 * Validate AI output without replacing model-discovered themes with
 * hard-coded application categories.
 */
const sanitizeSubtopics = (
  value: any,
  validRecordIds: Set<string>
): SynthesisResult["subtopics"] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      title: cleanText(item?.title)
        .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
        .replace(/[.!?]+$/, "")
        .split(/\s+/)
        .slice(0, 6)
        .join(" "),
      prose: limitWords(item?.prose, 1500),
      supportingRecordIds: Array.isArray(item?.supportingRecordIds)
        ? Array.from(
            new Set<string>(
              item.supportingRecordIds
                .map((recordId: unknown) => cleanText(recordId))
                .filter((recordId: string) => validRecordIds.has(recordId))
            )
          )
        : [],
    }))
    .filter((item) => item.title.length > 0 && item.prose.length > 0)
    .slice(0, 5)
    .map((item, index) => ({
      title: item.title.replace(/^\d+\.\s*/, `${index + 1}. `),
      prose: item.prose,
      supportingRecordIds: item.supportingRecordIds,
    }));
};

const buildEvidenceTable = (
  studies: SynthesisStudy[],
  subtopics: SynthesisResult["subtopics"]
) => {
  if (!subtopics || subtopics.length === 0) return [];

  return subtopics.map((subtopic) => ({
    topic: cleanText(subtopic.title).replace(/^\d+\.\s*/, ""),
    summary: cleanText(subtopic.prose),
    consistency: "Described narratively; not assessed quantitatively",
    evidenceBase: `Drawn from the final included evidence set (${studies.length} included ${studies.length === 1 ? "record" : "records"})`,
  }));
};

const INTEGRATED_SYNTHESIS_PROMPT = `
Using only the supplied final included study records, identify the major thematic patterns, evidence domains, approaches, interventions, contexts, populations, outcomes, or other meaningful dimensions that emerge from the literature.

The thematic structure must be discovered from the supplied evidence. Do not use predefined thematic categories.

The objective is not to summarize every study individually. The objective is to explain what the body of included evidence collectively shows, how studies relate to one another, where they converge or diverge, and what meaningful patterns can be identified from the supplied evidence.

Create approximately 1–5 distinct themes when the evidence supports them. Do
not manufacture themes to reach a target. Keep each heading to a concise
2–6-word noun phrase. You MUST write an extremely detailed and extensive synthesis. 
Expand each thematic narrative to approximately 1000–1500 words through exhaustive substantive synthesis, very deep comparison of studies, extensive methodological analysis, and comprehensive elaboration. The complete Section 3.4 MUST be extremely lengthy (targeting 4000–6000 words minimum) to guarantee a final comprehensive manuscript length of at least 12-15 pages. DO NOT output brief summaries.

A study may contribute to more than one theme when its supplied information supports that interpretation.

WRITING RULES:

1. Use objective third-person academic writing.

2. CRITICAL: The final manuscript must NOT mention: the application name, AI, ChatGPT, Gemini, Claude, OpenAI, or software-specific processing.

3. Do not mention PRISMA items.

4. Do not invent sample sizes, populations, methods, datasets, comparisons, outcomes, effect sizes, confidence intervals, p-values, statistical significance, heterogeneity statistics, risk of bias, GRADE ratings, reviewer activity, or any other information not explicitly supplied.

5. Use only information explicitly supplied in the records.

6. If a characteristic is absent, use: "not reported in the supplied record."

7. Distinguish carefully between measured outcomes, calculated or estimated outcomes, proxy indicators, model-predicted outcomes, simulation results, intended or proposed effects, and demonstrated real-world outcomes.

8. Do not treat model accuracy as evidence of real-world effectiveness unless the supplied record explicitly demonstrates such effectiveness.

9. Do not treat simulation results as demonstrated real-world outcomes.

10. Do not perform quantitative pooling or meta-analysis.

11. Identify similarities and differences between studies only where the supplied information supports the comparison.

12. Do not infer causality unless it is explicitly supported by the supplied record.

13. Do not assume that studies use the same definitions, populations, interventions, contexts, outcome measures, or methodological approaches.

14. Preserve important differences between studies rather than collapsing them into a single generalized conclusion.

15. CITE AND DISCUSS THE ACTUAL INCLUDED STUDIES by author and year (e.g., Smith et al., 2024). This exact format is REQUIRED for the manuscript engine to correctly process the references later.

16. Do not prescribe, assume, or hard-code a citation style like APA or IEEE. Always use the (Author, Year) placeholder format.

17. Preserve the study identity information (Author, Year) supplied with each record so that citations can be formatted later according to the citation style selected by the user.

18. Do not fabricate citation information.

19. CRITICAL FORMATTING RULE: Write all text as continuous academic prose paragraphs. DO NOT use bullet points. DO NOT use numbered lists. DO NOT use dash lists.

16. Do not fabricate citations. Every cited study must correspond to a study in the supplied records.

17. Do not create numerical evidence counts in the narrative. Evidence counts are calculated separately by the application.

18. Do not assign a study to a theme solely because of a keyword match. Themes must reflect the substantive meaning of the supplied evidence.

19. Do not create themes such as "Technologies", "Methods", "Outcomes", "Applications", or other generic categories unless the supplied literature itself clearly supports them as meaningful thematic domains.

20. Each thematic narrative should synthesize multiple relevant studies where possible. Avoid creating a separate theme for an individual study unless that study represents a genuinely distinct evidence domain.

21. Explain how studies relate to one another rather than merely listing what each study did.

22. When several studies address a similar issue, synthesize them in the same discussion and identify the common pattern before referring to individual studies as supporting evidence.

23. When studies differ in their conclusions, contexts, approaches, or reported outcomes, explain the distinction rather than presenting them as if they were consistent.

24. Use citations naturally within sentences and paragraphs. Citations should support claims made in the synthesis rather than function as headings or labels for individual studies.

25. Do not structure the prose as: "Author et al. (Year): ..." followed by another study summary.

26. Do not begin successive sentences or paragraphs with different author names merely to summarize one study at a time.

27. Avoid repetitive citation patterns such as "X et al. (Year) found...", "Y et al. (Year) found...", "Z et al. (Year) found...".

28. Prefer integrated structures in which several studies support a broader proposition, followed by comparison, contrast, or interpretation where supported.

29. Use transitions such as "Similarly", "In contrast", "Complementing this approach", "Extending this line of research", "Taken together", "Collectively", and "However" only when the relationship is actually supported by the supplied records.

30. Do not force relationships between studies merely to make the writing appear connected.

31. Each thematic narrative should progress logically: broad pattern → supporting evidence → comparison or contrast → interpretation of the evidence → remaining limitation or gap, where supported.

32. Avoid repeating the same study's information unnecessarily across multiple themes. If a study contributes to more than one theme, use only the aspect relevant to that theme.

33. The final paragraph of each thematic section should synthesize the evidence discussed rather than introduce another isolated study summary.

34. Each prose field must read as a continuous academic discussion. It must not read as an annotated bibliography or a list of study summaries.

35. Do not create a separate sentence for every supplied study. Select and connect the studies that are relevant to the thematic argument.

36. If the supplied evidence is insufficient to establish a meaningful thematic pattern, state this explicitly rather than inferring one.

In the same response, generate exactly five concise, publication-ready
candidate titles for the systematic literature review. Use only the complete
title evidence base supplied separately below to determine the review scope.
Do not simply concatenate keywords, introduce unsupported concepts, fabricate
findings, write a protocol title, or mention the application name, AI, ChatGPT, Gemini, Claude, OpenAI, or software-specific processing. Do not make the title narrower or
broader than the included evidence. Avoid a colon unless it materially
improves clarity.

RETURN VALID JSON ONLY:

{
  "titles": [
    "Candidate title 1",
    "Candidate title 2",
    "Candidate title 3",
    "Candidate title 4",
    "Candidate title 5"
  ],
  "subtopics": [
    {
      "title": "Concise Thematic Domain",
      "prose": "A concise integrated narrative synthesis in which studies are interrelated through patterns, similarities, differences, and supported interpretations.",
      "supportingRecordIds": ["an-actual-supplied-record-id"]
    }
  ]
}
`;

export default function SynthesisSection({
  protocol,
  onUpdateProtocol,
  synthesis,
  onUpdateSynthesis,
  includedRecords,
  characteristics,
  aiConfig,
  onNavigateToScreening,
}: SynthesisSectionProps) {
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] =
    useState<"prose" | "groups" | "table">("prose");
  const [groupingMode, setGroupingMode] = useState<
    "category" | "intervention" | "design" | "outcome"
  >("category");
  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);
  const [titleCopied, setTitleCopied] =
    useState(false);

  /*
   * Evidence Lock:
   * ALL final included records remain in the synthesis evidence base.
   * Characteristics are supplementary and never determine inclusion.
   */
const evidenceBudget = useMemo(
  () =>
    buildEvidenceBudget(
      includedRecords,
      characteristics,
      protocol
    ),
  [includedRecords, characteristics, protocol]
);

const introductionRecords =
  evidenceBudget.introductionRecords;

const detailedEvidenceRecords =
  evidenceBudget.detailedRecords;

const synthesisStudies = useMemo(
  () =>
    buildStudiesFromRecords(
      detailedEvidenceRecords,
      characteristics
    ),
  [detailedEvidenceRecords, characteristics]
);

  const fallbackTitleOptions = useMemo(
    () => suggestReviewTitles(includedRecords),
    [includedRecords]
  );
  const titleEvidenceKey = useMemo(
    () => getIncludedEvidenceKey(includedRecords, characteristics),
    [includedRecords, characteristics]
  );
  const titleOptions =
    synthesis.titleCandidateEvidenceKey === titleEvidenceKey &&
    synthesis.titleCandidates?.length
      ? synthesis.titleCandidates
      : fallbackTitleOptions;
  const titleMatchesEvidence =
    synthesis.titleCandidateEvidenceKey === titleEvidenceKey;

  const suggestedTitle =
    (titleMatchesEvidence ? synthesis.suggestedTitle : "") ||
    titleOptions[0] ||
    protocol.title ||
    "";

  const getGroupedCharacteristics = () => {
    const map = new Map<string, SynthesisStudy[]>();

    synthesisStudies.forEach((study) => {
      let groupKey =
        "Uncategorized evidence";

      if (groupingMode === "category") {
        groupKey =
          study.category ||
          "Uncategorized evidence";
      }

      if (groupingMode === "design") {
        groupKey =
          study.studyDesign ||
          "Study design details in supplied records";
      }

      if (groupingMode === "intervention") {
        groupKey =
          study.interventionOrFocus ||
          "Focus described in supplied records";
      }

      if (groupingMode === "outcome") {
        groupKey =
          study.primaryOutcome ||
          "Outcome details in supplied records";
      }

      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }

      map.get(groupKey)!.push(study);
    });

    return Array.from(map.entries()).map(
      ([groupTitle, studies]) => ({
        groupTitle,
        studies,
      })
    );
  };

  const groupedData = getGroupedCharacteristics();

  const runHeuristicSynthesis = () => {
    if (synthesisStudies.length === 0) return;

    const fallbackTopics = buildFallbackSubtopics(synthesisStudies);
    const fallbackTitles = suggestReviewTitles(includedRecords);

    const generated: SynthesisResult = {
      suggestedTitle: protocol.title?.trim() || fallbackTitles[0],
      titleCandidates: fallbackTitles,
      titleCandidateEvidenceKey: titleEvidenceKey,
      subtopics: fallbackTopics,
      keyFindingsTable: buildEvidenceTable(
        synthesisStudies,
        fallbackTopics
      ),
      forestPlotEstimates: [],
      pooledEffectEstimate: undefined,
      heterogeneityDiscussion:
        "The included evidence is synthesized narratively because the supplied records differ in their reported contexts, approaches, outcomes, and findings. Quantitative pooling is not performed.",
    };

    onUpdateSynthesis(generated);
    setErrorMessage(null);
  };

  const handleGenerateSynthesis = async () => {
    if (synthesisStudies.length === 0) return;

    setGenerating(true);
    setErrorMessage(null);

   const titleSourceRecords =
  buildTitleSourceRecords(
    detailedEvidenceRecords,
    characteristics
  );

    const prompt = `
${INTEGRATED_SYNTHESIS_PROMPT}

EVIDENCE-BASE NOTE:

The complete final included evidence set contains
${includedRecords.length} records.

For this AI synthesis writing pass, only
${detailedEvidenceRecords.length} records have been supplied.

These records were selected locally from the included evidence
using a two-stage evidence budget:

1. title relevance selection;
2. method/study/content/intervention relevance selection.

Do not claim that all ${includedRecords.length} records were directly
analyzed by this AI writing pass.

Do not invent evidence from records that are not supplied below.

The complete final included record set remains the citation and
reference universe for the manuscript, but every substantive
statement generated in this synthesis must be supported by the
records actually supplied to this writing pass.
SUPPLIED SYNTHESIS RECORDS:
${JSON.stringify(synthesisStudies, null, 2)}


TITLE GENERATION:

Generate exactly five publication-ready systematic literature
review titles.

The titles must be derived ONLY from the supplied title-evidence
records.

Before generating titles, internally identify:

1. The central subject or phenomenon.
2. The main intervention, technology, strategy, exposure, or
   research focus, where consistently supported.
3. The relevant population, system, sector, environment, or
   application context, where supported.
4. The principal outcome or purpose, where supported.
5. The appropriate scope of the review.

Do NOT simply concatenate frequently occurring keywords.

Do NOT copy the title of an included paper.

Do NOT create a title that is broader than the supplied evidence.

Do NOT create a title that is narrower than the supplied evidence.

Do NOT introduce an intervention, population, outcome, technology,
method, sector, or application that is not supported by the
supplied records.

Do NOT use generic filler such as:

- "A Review of the Literature"
- "Evidence from Included Studies"
- "Current Trends"
- "Recent Advances"
- "An Overview"
- "A Comprehensive Review"

Do NOT include "PRISMA 2020" in the title.

Do NOT mention artificial intelligence, AI, software, automation,
screening, or LitlMatrix.

Prefer a concise title of approximately 10–20 words.

Use a colon only when it substantially improves precision.

The five candidates must be meaningfully different in wording
while describing the same evidence-supported review scope.

Candidate 1 must be the strongest and most publication-ready title.

Candidates 2–5 should provide genuinely different formulations,
not superficial word substitutions.

The title must describe what the included evidence is actually
about, rather than describing the review process itself.

${JSON.stringify(titleSourceRecords, null, 2)}
`;

    try {
      const text = await callAI(
        prompt,
        "You are an expert systematic review methodologist focused on transparent, evidence-grounded narrative and thematic synthesis. You MUST write highly detailed, extensive, and very lengthy academic prose. Do NOT write brief summaries.",
        aiConfig,
        12000
      );

      const parsed = parseJSONLoose(text);

      if (!parsed || !Array.isArray(parsed.subtopics)) {
        throw new Error("The synthesis response could not be parsed.");
      }

      const validRecordIds = new Set(includedRecords.map((record) => record.id));
      const subtopics = sanitizeSubtopics(parsed.subtopics, validRecordIds);
      const titleCandidates = completeTitleCandidates(
        sanitizeTitleCandidates(parsed.titles),
        fallbackTitleOptions
      );

      if (subtopics.length === 0) {
        throw new Error("No valid thematic synthesis was returned.");
      }

      onUpdateSynthesis({
        ...synthesis,
        suggestedTitle:
          titleCandidates[0] ||
          protocol.title?.trim() ||
          "Systematic Literature Review Manuscript",
        titleCandidates,
        titleCandidateEvidenceKey: titleEvidenceKey,
        subtopics,
        keyFindingsTable: buildEvidenceTable(
          synthesisStudies,
          subtopics
        ),
        forestPlotEstimates: [],
        pooledEffectEstimate: undefined,
        heterogeneityDiscussion:
          "The included evidence is synthesized narratively. Similarities and differences are described according to the information reported in the supplied records, and quantitative pooling is not performed.",
      });
    } catch (error: any) {
      console.warn("Narrative synthesis generation error:", error);

      setErrorMessage(
        "Automatic synthesis could not be completed. A conservative evidence-grounded structured synthesis has been generated instead."
      );

      runHeuristicSynthesis();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      id="synthesis-section-container"
      className="space-y-6"
    >
      {/* =====================================================
          SUGGESTED TITLE — INTENTIONALLY FIRST
          ===================================================== */}
      <div className="bg-emerald-50/70 border border-emerald-200 p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] text-emerald-700 uppercase tracking-wider font-bold">
              Manuscript Development
            </div>

            <h2 className="text-xl font-bold text-emerald-950 mt-0.5">
              Suggested Review Title
            </h2>

            <p className="text-xs text-emerald-800 mt-1 max-w-3xl">
              Five publication-oriented titles are generated from the complete
              final included-record evidence set. The selected title can be
              edited before being applied to the review protocol.
            </p>
          </div>

          <span className="text-[10px] font-mono text-emerald-800 bg-white border border-emerald-200 px-2 py-1 rounded-md">
            Editable
          </span>
        </div>

        {titleOptions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-emerald-800 font-medium">
              Recommended starting titles
            </p>

            <div className="grid gap-2">
              {titleOptions.map((title) => {
                const selected =
                  (synthesis.suggestedTitle ||
                    suggestedTitle) === title;

                return (
                  <button
                    key={title}
                    type="button"
                    onClick={() =>
                      onUpdateSynthesis({
                        ...synthesis,
                        suggestedTitle: title,
                        titleCandidateEvidenceKey: titleEvidenceKey,
                      })
                    }
                    className={`w-full text-left px-4 py-3 text-sm rounded-lg border transition-colors cursor-pointer ${
                      selected
                        ? "border-emerald-500 bg-emerald-100 text-emerald-950 font-semibold"
                        : "border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50"
                    }`}
                  >
                    {selected && (
                      <CheckCircle className="inline-block w-4 h-4 mr-2 align-text-bottom" />
                    )}

                    {title}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider font-mono font-bold text-emerald-800">
            Working manuscript title
          </label>

          <input
            type="text"
            value={
              synthesis.suggestedTitle ||
              suggestedTitle
            }
            onChange={(event) =>
              onUpdateSynthesis({
                ...synthesis,
                suggestedTitle:
                  event.target.value,
                titleCandidateEvidenceKey: titleEvidenceKey,
              })
            }
            placeholder="Enter or edit the review title"
            className="w-full px-4 py-3 text-base font-semibold text-emerald-950 bg-white border border-emerald-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400"
            aria-label="Suggested review title"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const title = (
                synthesis.suggestedTitle ||
                suggestedTitle
              ).trim();

              if (!title) return;

              onUpdateProtocol({
                ...protocol,
                title,
              });
            }}
            disabled={
              !(
                synthesis.suggestedTitle ||
                suggestedTitle
              ).trim()
            }
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:bg-emerald-300 cursor-pointer disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Use as review title
          </button>

          <button
            type="button"
            onClick={() => {
              const title = (
                synthesis.suggestedTitle ||
                suggestedTitle
              ).trim();

              if (!title) return;

              navigator.clipboard.writeText(title);
              setTitleCopied(true);

              window.setTimeout(
                () => setTitleCopied(false),
                1800
              );
            }}
            disabled={
              !(
                synthesis.suggestedTitle ||
                suggestedTitle
              ).trim()
            }
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-semibold text-emerald-900 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            <Copy className="w-3.5 h-3.5" />

            {titleCopied
              ? "Copied"
              : "Copy title"}
          </button>
        </div>
      </div>

      {/* =====================================================
          ERROR / NOTICE
          ===================================================== */}
      {errorMessage && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs flex items-center justify-between font-mono">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>

          <button
            type="button"
            onClick={() =>
              setErrorMessage(null)
            }
            className="text-amber-700 hover:text-amber-900 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* =====================================================
          HEADER
          ===================================================== */}
      <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] text-indigo-600 uppercase tracking-wider font-bold">
              Results & Evidence Synthesis
            </div>

            <h2 className="text-2xl font-bold text-slate-900 mt-0.5">
              Narrative & Thematic Synthesis
            </h2>

            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              Synthesize only evidence supported by the final
              included records. Quantitative pooling is not
              performed unless appropriate data are available.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleGenerateSynthesis}
              disabled={
                generating ||
                synthesisStudies.length === 0
              }
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />

              {generating
                ? "Generating Synthesis..."
                : "Generate Narrative Synthesis"}
            </button>

            <button
              type="button"
              onClick={runHeuristicSynthesis}
              disabled={
                synthesisStudies.length === 0
              }
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-indigo-600" />
              Instant Synthesis
            </button>
          </div>
        </div>

        {/* Evidence lock indicator */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
          <div className="text-xs font-mono text-slate-600">
            <strong className="text-slate-900">
              Evidence lock:
            </strong>{" "}
            {includedRecords.length} included record
            {includedRecords.length === 1
              ? ""
              : "s"}
          </div>

          <div className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
            Final included records only
          </div>

        <div className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md">
  {detailedEvidenceRecords.length} records supplied to AI synthesis
</div>
          <div className="text-[10px] font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
  {introductionRecords.length} records available for introduction
</div>
          <div className="text-[10px] font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
  {includedRecords.length} records retained for citation/reference
</div>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-2 pt-3 border-t border-slate-100 flex-wrap">
          {[
            {
              key: "prose",
              label: "Narrative Synthesis by Subtopics",
            },
            {
              key: "groups",
              label:
                "Findings Grouped by Study Characteristics",
            },
            {
              key: "table",
              label: "Summary of Findings Matrix",
            },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() =>
                setActiveTab(tab.key as any)
              }
              className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors cursor-pointer ${
                activeTab === tab.key
                  ? "bg-slate-900 text-white font-semibold shadow-2xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* =====================================================
          EMPTY STATE
          ===================================================== */}
      {includedRecords.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 p-6 rounded-xl text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-amber-600 mx-auto" />

          <h3 className="text-sm font-bold text-amber-900">
            No Included Studies Available for Synthesis
          </h3>

          <p className="text-xs text-amber-700 max-w-md mx-auto">
            Synthesis requires records that have been
            included during the Study Selection stage.
          </p>

          {onNavigateToScreening && (
            <button
              type="button"
              onClick={onNavigateToScreening}
              className="px-4 py-2 text-xs font-mono font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors cursor-pointer"
            >
              Go to Study Selection
            </button>
          )}
        </div>
      )}

      {/* =====================================================
          TAB 1: NARRATIVE
          ===================================================== */}
      {activeTab === "prose" && (
        <div className="space-y-4">
          {synthesis.subtopics &&
          synthesis.subtopics.length > 0 ? (
            synthesis.subtopics.map(
              (subtopic, index) => (
                <div
                  key={index}
                  className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 font-mono">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />

                      {subtopic.title}
                    </h3>

                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                      Subtopic {index + 1}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans whitespace-pre-line text-justify">
                    {subtopic.prose}
                  </p>
                </div>
              )
            )
          ) : (
            <div className="bg-white border border-slate-200 p-12 text-center rounded-xl space-y-4">
              <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />

              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-800">
                  Narrative Synthesis Not Yet Generated
                </h3>

                <p className="text-xs text-slate-500">
                  Generate the synthesis above to
                  organize the included evidence into
                  thematic domains.
                </p>
              </div>
            </div>
          )}

          {synthesis.heterogeneityDiscussion && (
            <div className="bg-indigo-50/50 border border-indigo-200 p-6 rounded-xl space-y-2">
              <h3 className="text-sm font-bold text-indigo-950 font-mono">
                Patterns and Differences Across Records
              </h3>

              <p className="text-xs text-indigo-900 font-sans leading-relaxed text-justify">
                {synthesis.heterogeneityDiscussion}
              </p>
            </div>
          )}
        </div>
      )}

      {/* =====================================================
          TAB 2: GROUPS
          ===================================================== */}
      {activeTab === "groups" && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-xs flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-700">
              <Filter className="w-4 h-4 text-indigo-600" />

              <span className="font-bold">
                Group Characteristics by:
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {[
                {
                  id: "category",
                  label: "Evidence Category",
                },
                {
                  id: "intervention",
                  label:
                    "Intervention / Focus",
                },
                {
                  id: "design",
                  label: "Study Design",
                },
                {
                  id: "outcome",
                  label: "Outcome Measure",
                },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() =>
                    setGroupingMode(
                      mode.id as any
                    )
                  }
                  className={`px-3 py-1 text-xs font-mono rounded-lg transition-colors cursor-pointer ${
                    groupingMode === mode.id
                      ? "bg-indigo-600 text-white font-semibold shadow-xs"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {groupedData.length > 0 ? (
            <div className="space-y-4">
              {groupedData.map(
                (group, groupIndex) => (
                  <div
                    key={group.groupTitle}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
                  >
                    <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-800 text-xs font-mono font-bold flex items-center justify-center">
                          {groupIndex + 1}
                        </span>

                        <h4 className="text-sm font-bold text-slate-900 font-mono">
                          {group.groupTitle}
                        </h4>
                      </div>

                      <span className="text-xs font-mono text-slate-600 bg-white border border-slate-200 px-2.5 py-0.5 rounded-full">
                        {group.studies.length}{" "}
                        {group.studies.length === 1
                          ? "Study"
                          : "Studies"}
                      </span>
                    </div>

                    <div className="p-5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {group.studies.map(
                          (study) => (
                            <div
                              key={study.recordId}
                              className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-lg space-y-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-1 flex-wrap">
                                <span className="font-mono font-bold text-indigo-900 text-xs">
                                  {study.authorYear}
                                </span>

                                <span className="font-mono text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                                  {study.country} ·{" "}
                                  {study.sampleSize}
                                </span>
                              </div>

                              <div className="space-y-1 text-slate-700">
                                <p>
                                  <strong>
                                    Design:
                                  </strong>{" "}
                                  {study.studyDesign}
                                </p>

                                <p>
                                  <strong>
                                    Intervention / Focus:
                                  </strong>{" "}
                                  {
                                    study.interventionOrFocus
                                  }
                                </p>

                                <p>
                                  <strong>
                                    Primary Outcome:
                                  </strong>{" "}
                                  {
                                    study.primaryOutcome
                                  }
                                </p>

                                <p className="pt-1 text-slate-900 italic font-serif">
                                  "{study.keyFinding}"
                                </p>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="p-10 text-center bg-white border border-slate-200 rounded-xl text-slate-500 text-xs font-mono">
              No grouped evidence is available.
            </div>
          )}
        </div>
      )}

      {/* =====================================================
          TAB 3: SUMMARY MATRIX
          ===================================================== */}
      {activeTab === "table" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-mono text-[11px]">
              <tr>
                <th className="py-3 px-4 font-bold">
                  Thematic Domain
                </th>

                <th className="py-3 px-4 font-bold">
                  Summary of Synthesized Evidence
                </th>

                <th className="py-3 px-4 font-bold">
                  Consistency
                </th>

                <th className="py-3 px-4 font-bold">
                  Evidence Base
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {synthesis.keyFindingsTable &&
              synthesis.keyFindingsTable.length > 0 ? (
                synthesis.keyFindingsTable.map(
                  (row, index) => (
                    <tr
                      key={index}
                      className="hover:bg-slate-50/70"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 align-top max-w-[220px]">
                        {row.topic}
                      </td>

                      <td className="py-3 px-4 text-slate-700 align-top leading-relaxed">
                        {row.summary}
                      </td>

                      <td className="py-3 px-4 font-mono text-indigo-700 align-top max-w-[160px]">
                        {row.consistency}
                      </td>

                      <td className="py-3 px-4 font-mono text-slate-500 align-top max-w-[160px]">
                        {row.evidenceBase}
                      </td>
                    </tr>
                  )
                )
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="p-8 text-center text-xs font-mono text-slate-400"
                  >
                    No summary table rows available.
                    Generate the synthesis above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* =====================================================
          FINAL EVIDENCE NOTE
          ===================================================== */}
      {includedRecords.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />

            <div>
              <p className="text-xs font-bold text-slate-800">
                Evidence lock active
              </p>

              <p className="text-[11px] text-slate-600 leading-relaxed mt-1">
                Only final included records are eligible to
                contribute to the synthesis, evidence matrix,
                discussion, and manuscript results. Missing
                characteristics remain reported as not reported
                rather than being inferred.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
