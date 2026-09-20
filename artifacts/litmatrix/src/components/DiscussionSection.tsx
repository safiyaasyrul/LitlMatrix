import React, { useState } from "react";
import { DiscussionSections, SLRProtocol, SynthesisResult, SLRRecord, StudyCharacteristic } from "../types/slr";
import { Sparkles, BookOpen, Download, Copy, Check, AlertCircle, Zap, Layers } from "lucide-react";
import { callAI, parseJSONLoose } from "../utils/aiClient";

interface DiscussionSectionProps {
  discussion: DiscussionSections;
  onUpdateDiscussion: (disc: DiscussionSections) => void;
  protocol: SLRProtocol;
  synthesis: SynthesisResult;
  includedRecords?: SLRRecord[];
  characteristics?: StudyCharacteristic[];
  aiConfig: any;
}

export default function DiscussionSection({
  discussion,
  onUpdateDiscussion,
  protocol,
  synthesis,
  includedRecords = [],
  characteristics = [],
  aiConfig,
}: DiscussionSectionProps) {
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dynamic rule-based discussion generator grounded in included study findings and categorized author similarities
  const runHeuristicDiscussion = () => {
    const topic = protocol.title || "the investigated domain";

    // Group characteristics by category
    const catMap = new Map<string, StudyCharacteristic[]>();
    characteristics.forEach((c) => {
      const cat = c.category || "Uncategorized evidence";
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(c);
    });

    const categoryDiscussions: string[] = [];
    catMap.forEach((studies, catName) => {
      if (studies.length >= 2) {
        const a1 = studies[0];
        const a2 = studies[1];
        categoryDiscussions.push(
          `Within the ${catName} theme, ${a1.authorYear}: ${a1.keyFinding}. ${a2.authorYear}: ${a2.keyFinding}. The comparison considers the findings reported by both records.`
        );
      } else if (studies.length === 1) {
        const s = studies[0];
        categoryDiscussions.push(
          `Within the ${catName} theme, ${s.authorYear}: ${s.keyFinding}.`
        );
      }
    });

    const crossAuthorText = categoryDiscussions.length > 0
      ? categoryDiscussions.join(" ")
      : "The included record-level findings provide the basis for a narrative cross-study comparison.";

    const generated: DiscussionSections = {
      item23aGeneralInterpretation: `The records marked for inclusion address ${topic} through several thematic approaches. ${crossAuthorText} These observations are narrative only and do not establish a pooled direction or magnitude of effect.`,
      item23bLimitationsOfEvidence: `The included studies address the review topic across the identified thematic domains. Differences in methods, settings, and reported outcomes are considered narratively within each cluster and are interpreted according to the findings reported by each study.`,
      item23cLimitationsOfReviewProcess: `The review applies predefined eligibility criteria and organizes the included evidence into narrative and thematic clusters. The discussion focuses on relationships, contrasts, and recurring patterns that are visible across the included records.`,
      item23dImplications: `The findings identify recurring themes and areas of convergence across the included records. These themes can inform domain-specific interpretation, practical discussion, and future research priorities grounded in the outcomes reported by the included studies.`,
    };

    onUpdateDiscussion(generated);
    setErrorMessage(null);
  };

  const handleGenerateDiscussion = async () => {
    setGenerating(true);
    setErrorMessage(null);

    const studiesData = characteristics.length > 0
      ? characteristics.map((c) => ({
          citation: c.authorYear,
          category: c.category,
          country: c.country,
          sampleSize: c.sampleSize,
          population: c.population,
          intervention: c.interventionOrFocus,
          comparator: c.comparator,
          primaryOutcome: c.primaryOutcome,
          keyFinding: c.keyFinding,
          studyDesign: c.studyDesign,
        }))
      : includedRecords.map((r) => ({
          citation: `${r.authors[0]?.split(",")[0] || "Author"} et al. (${r.year || "2024"})`,
          title: r.title,
          abstract: (r.abstract || "").slice(0, 250),
        }));

    const prompt = `Draft a cautious 4-part academic Discussion grounded only in the supplied records and extracted characteristics.

Review Title: "${protocol.title}"
Review Type: "${protocol.reviewType}"
Framework: "${protocol.formulationFramework || "PICOC"}"
Included Studies and Characteristics:
${JSON.stringify(studiesData)}

Synthesis Subtopics:
${JSON.stringify(synthesis.subtopics.map((s) => ({ title: s.title, summary: s.prose.slice(0, 200) })))}

STRICT WRITING RULES:
1. WRITE IN CONTINUOUS COHESIVE PARAGRAPHS AND STATEMENTS ONLY. DO NOT USE ANY BULLET POINTS, LISTS, OR DASHES (-).
2. Write in strictly third-person objective academic voice. NEVER use first-person pronouns (DO NOT use "we", "our", "us", "in our review", "we found").
3. DO NOT use dashes or hyphens as punctuation dividers. Use standard sentence structure with commas, semicolons, and parentheses.
4. DO NOT mention "PRISMA Item", "PRISMA", "Item 23a", etc. Use natural academic discourse.
5. CITE AND DISCUSS THE ACTUAL INCLUDED STUDIES by author and year (e.g. Chen et al., 2023). Within each category, discuss authors who share similarities and contrast their results.
6. Never invent or infer pooled effects, confidence intervals, significance, reviewer activity, full-text assessment, search coverage, validation, or findings absent from the supplied data. Do not describe the application, the review workspace, or the supplied records as deficient.

Structure the response into 4 distinct sections (each section should be approximately 600-800 words to target a 10-12 page final manuscript):
1. item23aGeneralInterpretation: Deep, expansive interpretation of findings directly citing included studies, grouping by category, discussing similarities among authors in the same category, and contextualizing extensively within existing literature.
2. item23bLimitationsOfEvidence: Critical, detailed evaluation of limitations within the included studies (e.g., experimental setups, sample/data adequacy, measurement limitations, lack of external validation).
3. item23cLimitationsOfReviewProcess: Neutral methodological context describing the predefined scope, eligibility criteria, screening approach, and narrative or thematic organization. Do not list missing databases, search dates, language restrictions, reviewer actions, or unavailable verification steps.
4. item23dImplications: Cautious, comprehensive implications for practice, policy, and future research appropriate to the review topic.

Return ONLY a JSON object:
{
  "item23aGeneralInterpretation": "...",
  "item23bLimitationsOfEvidence": "...",
  "item23cLimitationsOfReviewProcess": "...",
  "item23dImplications": "..."
}`;

    try {
      const text = await callAI(prompt, "You are a senior academic journal editor and systematic review methodology expert.", aiConfig);
      const parsed = parseJSONLoose(text);
      if (parsed && parsed.item23aGeneralInterpretation) {
        onUpdateDiscussion({
          item23aGeneralInterpretation: parsed.item23aGeneralInterpretation || discussion.item23aGeneralInterpretation,
          item23bLimitationsOfEvidence: parsed.item23bLimitationsOfEvidence || discussion.item23bLimitationsOfEvidence,
          item23cLimitationsOfReviewProcess: parsed.item23cLimitationsOfReviewProcess || discussion.item23cLimitationsOfReviewProcess,
          item23dImplications: parsed.item23dImplications || discussion.item23dImplications,
        });
      } else {
        throw new Error("Could not parse AI response as valid discussion object.");
      }
    } catch (e: any) {
      console.warn("AI Discussion error:", e);
      setErrorMessage(`AI Generation Notice: ${e.message || "Request failed"}. Automatic structured discussion draft applied.`);
      runHeuristicDiscussion();
    } finally {
      setGenerating(false);
    }
  };

  const copyFullDiscussion = () => {
    const text = `## Discussion\n\n### 1. Principal Findings and Contextual Interpretation\n${discussion.item23aGeneralInterpretation}\n\n### 2. Methodological Characteristics of Included Evidence\n${discussion.item23bLimitationsOfEvidence}\n\n### 3. Review Methodological Context\n${discussion.item23cLimitationsOfReviewProcess}\n\n### 4. Practical Implications and Future Research Directions\n${discussion.item23dImplications}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updatePart = (field: keyof DiscussionSections, val: string) => {
    onUpdateDiscussion({
      ...discussion,
      [field]: val,
    });
  };

  return (
    <div id="discussion-section-container" className="space-y-6">
      {/* Error / Notice Alert */}
      {errorMessage && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs flex items-center justify-between font-mono">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-amber-700 hover:text-amber-900 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Header Card */}
      <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] text-indigo-600 uppercase tracking-wider font-bold">
              Evidence Synthesis & Critical Evaluation
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mt-0.5">
              Structured Academic Discussion
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Comprehensive discussion interpreting findings from included records, evaluating evidence limitations, addressing review methodology constraints, and formulating practical implications.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleGenerateDiscussion}
              disabled={generating}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              {generating ? "Drafting Discussion..." : "Generate Discussion from Records"}
            </button>
            <button
              onClick={runHeuristicDiscussion}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-indigo-600" />
              Instant Structured Draft
            </button>
            <button
              onClick={copyFullDiscussion}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy Discussion"}
            </button>
          </div>
        </div>

      </div>

      {/* 4 Editable Sections */}
      <div className="space-y-4">
        {/* 1. General Interpretation */}
        <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs font-bold text-slate-900 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700">
                1
              </span>
              <span>Principal Findings and Contextual Interpretation</span>
            </div>
          </div>
          <textarea
            value={discussion.item23aGeneralInterpretation}
            onChange={(e) => updatePart("item23aGeneralInterpretation", e.target.value)}
            rows={5}
            placeholder="Provide a general interpretation of the results in the context of other evidence..."
            className="w-full text-xs sm:text-sm font-sans p-3.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 leading-relaxed text-slate-800"
          />
        </div>

        {/* 2. Limitations of Evidence */}
        <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs font-bold text-slate-900 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">
                2
              </span>
              <span>Methodological Characteristics of Included Evidence</span>
            </div>
          </div>
          <textarea
            value={discussion.item23bLimitationsOfEvidence}
            onChange={(e) => updatePart("item23bLimitationsOfEvidence", e.target.value)}
            rows={5}
            placeholder="Discuss limitations of the included evidence (study differences, reporting gaps, retrospective designs)..."
            className="w-full text-xs sm:text-sm font-sans p-3.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 leading-relaxed text-slate-800"
          />
        </div>

        {/* 3. Limitations of Review Process */}
        <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs font-bold text-slate-900 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-800">
                3
              </span>
              <span>Review Methodological Context</span>
            </div>
          </div>
          <textarea
            value={discussion.item23cLimitationsOfReviewProcess}
            onChange={(e) => updatePart("item23cLimitationsOfReviewProcess", e.target.value)}
            rows={5}
              placeholder="Describe the predefined scope, eligibility criteria, screening approach, and narrative or thematic organization..."
            className="w-full text-xs sm:text-sm font-sans p-3.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500/20 focus:border-slate-500 leading-relaxed text-slate-800"
          />
        </div>

        {/* 4. Implications */}
        <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-xs font-bold text-slate-900 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
                4
              </span>
              <span>Practical Implications and Future Research Directions</span>
            </div>
          </div>
          <textarea
            value={discussion.item23dImplications}
            onChange={(e) => updatePart("item23dImplications", e.target.value)}
            rows={5}
            placeholder="Discuss actionable implications of the results for clinical practice, health policy, and future studies..."
            className="w-full text-xs sm:text-sm font-sans p-3.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 leading-relaxed text-slate-800"
          />
        </div>
      </div>
    </div>
  );
}
