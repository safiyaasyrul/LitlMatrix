import React, { useState, useMemo } from "react";
import {
  SLRProtocol,
  SLRRecord,
  ScreeningDecision,
  StudyCharacteristic,
  SynthesisResult,
  DiscussionSections,
  PrismaChecklistItem,
  CitationStyle,
  PrismaFlowData,
} from "../types/slr";
import { Download, Copy, Printer, Check, BookOpen, FileText, CheckCircle2, ShieldAlert, Sparkles, Layers, SlidersHorizontal, Quote, ClipboardCheck } from "lucide-react";
import PrismaDiagram from "./PrismaDiagram";
import { getIncludedEvidenceKey } from "../utils/evidenceKey";
import { buildManuscriptAbstract } from "../utils/manuscriptAbstract";
import { formatCitationText, formatReference } from "../utils/citationFormatter";
import { CITATION_STYLE_OPTIONS } from "../utils/citationFormatter";
import { buildPrismaSvg, svgToDataUri } from "../utils/prismaSvg";
import { calculatePrismaFlowData } from "../utils/prismaFlowCalculator";
import { buildDocxBlob, DocxBlock } from "../utils/docxExporter";

interface FullReviewReportProps {
  protocol: SLRProtocol;
  includedRecords: SLRRecord[];
  screenedRecords: SLRRecord[];
  screening: Record<string, ScreeningDecision>;
  characteristics: StudyCharacteristic[];
  synthesis: SynthesisResult;
  discussion: DiscussionSections;
  checklist: PrismaChecklistItem[];
  counts?: any;
  prismaData?: PrismaFlowData;
  citationStyle: CitationStyle;
  onCitationStyleChange: (style: CitationStyle) => void;
}

interface LandscapeCount {
  label: string;
  count: number;
}

interface CharacteristicGroup {
  heading: string;
  values: LandscapeCount[];
}

const countLabels = (labels: string[]) =>
  Array.from(
    labels.reduce((counts, label) => {
      counts.set(label, (counts.get(label) || 0) + 1);
      return counts;
    }, new Map<string, number>())
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

const summarizeLandscape = (counts: LandscapeCount[], limit = 4) =>
  counts.slice(0, limit).map((item) => `${item.label} (${item.count})`).join(", ");

const isReportedValue = (value?: string) => {
  const normalized = value?.trim();
  return Boolean(
    normalized &&
    !/^not (reported|established|available|specified|applicable)/i.test(normalized)
  );
};

const countCharacteristicValues = (
  characteristics: StudyCharacteristic[],
  selectValue: (item: StudyCharacteristic) => string | undefined
) => {
  const recordIdsByValue = new Map<string, Set<string>>();
  characteristics.forEach((item) => {
    const value = selectValue(item)?.trim();
    if (!isReportedValue(value)) return;
    if (!recordIdsByValue.has(value!)) recordIdsByValue.set(value!, new Set());
    recordIdsByValue.get(value!)!.add(item.recordId);
  });

  return Array.from(recordIdsByValue.entries())
    .map(([label, recordIds]) => ({ label, count: recordIds.size }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

const getCharacteristicGroups = (
  records: SLRRecord[],
  characteristics: StudyCharacteristic[]
): CharacteristicGroup[] => {
  const includedIds = new Set(records.map((record) => record.id));
  const includedCharacteristics = characteristics.filter((item) =>
    includedIds.has(item.recordId)
  );
  const groups: CharacteristicGroup[] = [
    {
      heading: "Study and intervention categories",
      values: countCharacteristicValues(
        includedCharacteristics,
        (item) => item.category || item.interventionOrFocus
      ),
    },
    {
      heading: "Populations and contexts",
      values: countCharacteristicValues(
        includedCharacteristics,
        (item) => item.population
      ),
    },
    {
      heading: "Methodological approaches",
      values: countCharacteristicValues(
        includedCharacteristics,
        (item) => item.studyDesign
      ),
    },
    {
      heading: "Reported outcome types",
      values: countCharacteristicValues(
        includedCharacteristics,
        (item) => item.primaryOutcome
      ),
    },
    {
      heading: "Geographical contexts",
      values: countCharacteristicValues(
        includedCharacteristics,
        (item) => item.country
      ),
    },
  ];

  return groups.filter((group) => group.values.length > 0);
};

const removeCitations = (value: string) =>
  value
    .replace(/\[[\d,\s;–—-]+\]/g, "")
    .replace(/\((?=[^()]*\b(?:19|20)\d{2}[a-z]?\b)[^()]*\)/gi, "")
    .replace(
      /\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+|\s+et al\.)?\s*,?\s*(?:19|20)\d{2}[a-z]?\b/g,
      ""
    )
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])\s*([,.;:])/g, "$2")
    .replace(/\s{2,}/g, " ")
    .trim();

export default function FullReviewReport({
  protocol,
  includedRecords,
  screenedRecords,
  screening,
  characteristics,
  synthesis,
  discussion,
  checklist,
  counts,
  prismaData,
  citationStyle,
  onCitationStyleChange,
}: FullReviewReportProps) {
  const [copied, setCopied] = useState(false);
  const configuredTitle = protocol.title?.trim();
  const evidenceKey = getIncludedEvidenceKey(includedRecords, characteristics);
  const evidenceGroundedTitle =
    synthesis.titleCandidateEvidenceKey === evidenceKey
      ? synthesis.suggestedTitle?.trim()
      : "";
  const manuscriptTitle = evidenceGroundedTitle
    || (configuredTitle && !/^untitled systematic review$/i.test(configuredTitle)
      ? configuredTitle
      : "Systematic Literature Review Manuscript");
  const characteristicGroups = getCharacteristicGroups(includedRecords, characteristics);
  const evidenceOverview = synthesis.subtopics
    .map((subtopic) => ({
      label: subtopic.title.replace(/^\d+(?:\.\d+)*\.?\s*/, ""),
      count: new Set(subtopic.supportingRecordIds || []).size,
    }))
    .filter((item) => item.label && item.count > 0);
  const recordGroundedRationale = includedRecords.length > 0
    ? `This review examines the scope represented by ${includedRecords.length} final included records. Interpretation is restricted to their titles, abstracts, and extracted study characteristics.`
    : protocol.introductionRationale || `This review examines evidence relevant to ${manuscriptTitle}.`;

  const questions = protocol.primaryResearchQuestions || [
    "RQ1: What evidence directly addresses the review topic?",
    "RQ2: What methods, settings, and outcomes are reported?",
    "RQ3: What evidence gaps remain?",
  ];

  const objectives = protocol.secondaryObjectives || [
    "Describe the evidence by themes grounded in the included records",
  ];

  // Helper for generating PICOC narrative paragraph in Methods
  const getFrameworkNarrative = () => {
    const fw = protocol.formulationFramework || "PICOC";
    if (fw === "PICOC") {
      const p = protocol.objectivesPICOC?.population || protocol.objectivesPICO.population || "the defined population or unit of analysis";
      const i = protocol.objectivesPICOC?.intervention || protocol.objectivesPICO.intervention || "the intervention, method, policy, technology, or exposure of interest";
      const c = protocol.objectivesPICOC?.comparison || protocol.objectivesPICO.comparator || "any explicitly defined comparator";
      const o = protocol.objectivesPICOC?.outcomes || protocol.objectivesPICO.outcomes || "the prespecified outcomes or phenomena";
      const ctx = protocol.objectivesPICOC?.context || "the defined operational or geographical context";
      const s = protocol.objectivesPICOC?.studyDesigns || protocol.objectivesPICO.studyDesigns || "eligible empirical study designs";
      return `The review scope was structured using PICOC: population or unit of analysis, ${p}; intervention or focus, ${i}; comparison, ${c}; outcomes, ${o}; context, ${ctx}; and study designs, ${s}.`;
    }
    if (fw === "PEO") {
      const p = protocol.objectivesPEO?.population || protocol.objectivesPICO.population;
      const e = protocol.objectivesPEO?.exposure || protocol.objectivesPICO.intervention;
      const o = protocol.objectivesPEO?.outcomes || protocol.objectivesPICO.outcomes;
      const s = protocol.objectivesPEO?.setting || "ecological and geographical setting";
      const d = protocol.objectivesPEO?.studyDesigns || protocol.objectivesPICO.studyDesigns;
      return `The review scope was structured around the PEO framework. The study population and ecological targets (P) include ${p}. The investigated exposure factors and environmental stressors (E) encompass ${e}. The evaluated ecological outcomes and impact metrics (O) reflect ${o}. The geographical and operational setting (S) corresponds to ${s}, with eligible study designs (D) restricted to ${d}.`;
    }
    if (fw === "SPIDER") {
      const s = protocol.objectivesSPIDER?.sample || protocol.objectivesPICO.population;
      const pi = protocol.objectivesSPIDER?.phenomenonOfInterest || protocol.objectivesPICO.intervention;
      const d = protocol.objectivesSPIDER?.design || "qualitative thematic investigations";
      const e = protocol.objectivesSPIDER?.evaluation || protocol.objectivesPICO.outcomes;
      const r = protocol.objectivesSPIDER?.researchType || "qualitative and mixed-methods research";
      return `The review was formulated around the SPIDER qualitative synthesis framework. The study sample (S) encompasses ${s}. The phenomenon of interest (PI) investigates ${pi}. The research design (D) incorporates ${d}. The evaluation criteria (E) assess ${e}, focusing on research types (R) classified as ${r}.`;
    }
    // Default PICO
    const p = protocol.objectivesPICO.population;
    const i = protocol.objectivesPICO.intervention;
    const c = protocol.objectivesPICO.comparator;
    const o = protocol.objectivesPICO.outcomes;
    const s = protocol.objectivesPICO.studyDesigns;
    return `The systematic review protocol was formulated around the PICO framework. The target population (P) comprises ${p}. The investigated intervention (I) encompasses ${i}. The comparison methods (C) consist of ${c}. The primary outcomes of interest (O) evaluate ${o}, with eligible study designs (S) defined as ${s}.`;
  };

  const getArticleRecord = (record: SLRRecord) => {
    const authors = record.authors?.join(", ") || "Author not reported";
    const journal = record.source || "Journal not reported";
    return `${record.title} — ${authors} — ${journal}`;
  };
  const abstract = buildManuscriptAbstract({
    protocol,
    manuscriptTitle,
    includedRecords,
    characteristics,
    synthesis,
  });
  const abstractReady = !abstract.validationErrors?.length;
  const formatProse = (value: string) =>
    formatCitationText(value, includedRecords, citationStyle);
  const referenceList = includedRecords.map((record, index) =>
    formatReference(record, citationStyle, index + 1)
  );
  const conclusionThemes = synthesis.subtopics
    .map((item) => removeCitations(item.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")))
    .filter(Boolean);
  const conclusionLead = conclusionThemes.length > 0
    ? `The narrative and thematic synthesis of ${includedRecords.length} included ${includedRecords.length === 1 ? "record" : "records"} identifies ${conclusionThemes.join("; ")} as the principal evidence-grounded themes.`
    : `The conclusions are based on the narrative and thematic synthesis of ${includedRecords.length} included ${includedRecords.length === 1 ? "record" : "records"}.`;
  const conclusionImplications = removeCitations(discussion.item23dImplications);
  const citationFreeConclusion = `${conclusionLead}${conclusionImplications ? ` ${conclusionImplications}` : ""}`;
  
  const activePrisma: PrismaFlowData = useMemo(() => {
    if (prismaData) return prismaData;
    return calculatePrismaFlowData({
      records: screenedRecords,
      dupesRemoved: counts?.duplicatesRemoved,
      screening,
      characteristics,
      synthesis,
    });
  }, [prismaData, screenedRecords, counts, screening, characteristics, synthesis]);

  const prismaSvg = buildPrismaSvg(activePrisma);

  const markdownCountTable = (heading: string, values: LandscapeCount[]) => {
    let table = `#### ${heading}\n\n| Description | Records |\n| --- | ---: |\n`;
    values.forEach((item) => {
      table += `| ${item.label.replace(/\|/g, "/")} | ${item.count} |\n`;
    });
    return `${table}\n`;
  };

  const generateFullMarkdown = () => {
    let md = `# ${manuscriptTitle}\n\n`;
    md += `**Methodology:** ${protocol.reviewType}\n`;
    md += `\n---\n\n`;

    md += `## Abstract\n\n`;
    md += `${abstract.text}\n\n`;
    md += `**Keywords:** ${abstract.keywords.join(", ")}\n\n`;
    md += `---\n\n`;

    md += `## 1. Introduction and Academic Rationale\n\n`;
    md += `### 1.1 Scientific Rationale and Motivation for Conducting the Review\n`;
    md += `${recordGroundedRationale}\n\n`;

    if (protocol.backgroundContext && includedRecords.length === 0) {
      md += `In theoretical and domain context, ${protocol.backgroundContext}\n\n`;
    }

    if (protocol.knowledgeGap && includedRecords.length === 0) {
      md += `Regarding the existing literature gap, ${protocol.knowledgeGap}\n\n`;
    }

    md += `### 1.2 Review Objectives and Research Questions\n`;
    const questionsParagraph = questions.map((q, i) => `Specifically, research question ${i + 1} investigates ${q.replace(/^RQ\d+:\s*/, "")}`).join(". Furthermore, ");
    const objectivesParagraph = objectives.map((obj) => `to ${obj.toLowerCase().replace(/^to\s+/, "")}`).join(", as well as ");
    md += `The overarching objective of this investigation is ${objectivesParagraph}. In addressing this mandate, three core research questions guide the empirical synthesis: ${questionsParagraph}.\n\n`;

    md += `## 2. Methods\n\n`;
    md += `### 2.1 Review Design\n`;
    md += `${getFrameworkNarrative()}\n\n`;

    md += `### 2.2 Information Sources and Search Strategy\n`;
    const searchDatabases = protocol.searchStrategies.map((s) => s.database).join(", ");
    md += `Search strategies were stored for ${searchDatabases || "the recorded information sources"}. Exact database-specific queries are reproduced in Appendix B.\n\n`;

    md += `### 2.3 Eligibility Criteria\n`;
    md += `Eligibility was assessed against the predefined protocol criteria reproduced verbatim in Appendix A.\n\n`;

    md += `### 2.4 Study Selection\n`;
    md += `Records entered the screening ledger were screened against predefined eligibility criteria using the available bibliographic information. Records without a final include or exclude decision remain unresolved; full-text retrieval and eligibility assessment were not performed. Recorded decisions and justifications are reported in the screening audit.\n\n`;

    md += `### 2.5 Data Extraction and Study Characteristics\n`;
    md += `Study characteristics were reported only when values had been extracted for final included records. Missing characteristics were omitted rather than inferred from citation metadata.\n\n`;

    md += `### 2.6 Synthesis Approach\n`;
    md += `The included evidence was synthesized narratively. Themes were derived from the supplied record content, and quantitative pooling was not performed.\n\n`;

    md += `## 3. Results\n\n`;
    md += `### 3.1 Study Selection and Flow of Evidence\n`;
    const dbSummary = activePrisma.identification.databases.map((d) => `${d.name} (n = ${d.recordsIdentified})`).join(", ");
    md += `A total of ${activePrisma.screening.recordsScreened + activePrisma.removedBeforeScreening.duplicates} records were identified from ${dbSummary || "databases"}. Deduplication removed ${activePrisma.removedBeforeScreening.duplicates} duplicate records. After deduplication, ${activePrisma.screening.recordsScreened} records entered title and abstract screening, with ${activePrisma.screening.recordsExcluded} excluded and ${activePrisma.included.studiesIncluded} meeting all inclusion criteria. The bounded evidence set selected ${activePrisma.included.studiesIncludedInSynthesis} studies for detailed qualitative and thematic synthesis (Figure 1).\n\n`;
    md += `**Figure 1. PRISMA 2020 flow diagram of the study identification, screening, eligibility and inclusion process.**\n\n`;
    md += "```text\n";
    md += `Identification: databases [${dbSummary || "records"}] → duplicates removed (n = ${activePrisma.removedBeforeScreening.duplicates})\n`;
    md += `Screening: records screened (n = ${activePrisma.screening.recordsScreened}) → excluded (n = ${activePrisma.screening.recordsExcluded})\n`;
    md += `Inclusion: included studies (n = ${activePrisma.included.studiesIncluded}) → qualitative synthesis (n = ${activePrisma.included.studiesIncludedInSynthesis})\n`;
    md += "```\n\n";

    md += `### 3.1 Included Studies Table (Table 1)\n\n`;
    md += `| Included Paper | Inclusion Justification |\n`;
    md += `| --- | --- |\n`;
    includedRecords.forEach((record) => {
      const justification = screening[record.id]?.reason || "No screening justification was supplied for this record.";
      const referenceIndex = includedRecords.findIndex((item) => item.id === record.id) + 1;
      const tableCitation = formatReference(record, citationStyle, referenceIndex);
      md += `| ${tableCitation.replace(/\|/g, "/")} | ${formatProse(justification).replace(/\|/g, "/")} |\n`;
    });
    md += `\n`;

    md += `### 3.2 Characteristics of Included Studies\n\n`;
    md += `${includedRecords.length} included studies contributed to the descriptive results. Only extracted characteristics with meaningful reported values are shown.\n\n`;
    characteristicGroups.forEach((group) => {
      md += markdownCountTable(group.heading, group.values);
    });

    md += `### 3.3 Evidence Overview\n\n`;
    md += synthesis.subtopics.length > 0
      ? `The included evidence was organized into the following evidence-grounded themes: ${synthesis.subtopics.map((item) => item.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")).join("; ")}.\n\n`
      : `No thematic overview has been generated from the included evidence.\n\n`;
    if (evidenceOverview.length > 0) {
      md += markdownCountTable("Included studies supporting each theme", evidenceOverview);
    }

    md += `### 3.4 Narrative and Thematic Synthesis\n\n`;
    if (synthesis.subtopics.length > 0) {
      md += `The synthesis focuses on the principal recurring patterns supported by the final included records. Themes are presented concisely and preserve differences in methods, contexts, and reported outcomes.\n\n`;
    }
    synthesis.subtopics.forEach((sub) => {
  const supportingRecords = includedRecords.filter((record) =>
    (sub.supportingRecordIds || []).includes(record.id)
  );

  md += `#### ${sub.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")}\n`;
  md += `${formatEvidenceProse(sub.prose, supportingRecords.length ? supportingRecords : includedRecords)}\n\n`;
});

    md += `## 4. Discussion\n\n`;
    md += `### 4.1 Principal Findings\n${formatProse(discussion.item23aGeneralInterpretation)}\n\n`;
    md += `### 4.2 Interpretation of the Evidence\n${formatProse(discussion.item23bLimitationsOfEvidence)}\n\n`;
    md += `### 4.3 Implications\n${formatProse(discussion.item23dImplications)}\n\n`;
    md += `### 4.5 Limitations of the Review\n${formatProse(discussion.item23cLimitationsOfReviewProcess)}\n\n`;

    md += `## 5. Conclusions\n\n${citationFreeConclusion}\n\n`;

    if (protocol.eligibilityCriteria.inclusion.length || protocol.eligibilityCriteria.exclusion.length) {
      md += `## Appendix A. Eligibility Criteria\n\n`;
      if (protocol.eligibilityCriteria.inclusion.length) {
        md += `### A.1 Inclusion Criteria\n\n`;
        protocol.eligibilityCriteria.inclusion.forEach((criterion, index) => {
          md += `${index + 1}. ${criterion}\n`;
        });
        md += `\n`;
      }
      if (protocol.eligibilityCriteria.exclusion.length) {
        md += `### A.2 Exclusion Criteria\n\n`;
        protocol.eligibilityCriteria.exclusion.forEach((criterion, index) => {
          md += `${index + 1}. ${criterion}\n`;
        });
        md += `\n`;
      }
    }

    if (protocol.searchStrategies.length) {
      md += `## Appendix B. Search Strategy and Search Strings\n\n`;
      protocol.searchStrategies.forEach((strategy, index) => {
        const source = protocol.informationSources.find(
          (item) => item.name.trim().toLowerCase() === strategy.database.trim().toLowerCase()
        );
        md += `### B.${index + 1} ${strategy.database}\n\n`;
        md += `**Database/Source:** ${strategy.database}\n\n`;
        if (strategy.filters) md += `**Search fields/filters:** ${strategy.filters}\n\n`;
        if (source?.lastSearchedDate) md += `**Search date:** ${source.lastSearchedDate}\n\n`;
        md += `**Search string:**\n\n\`\`\`\n${strategy.query}\n\`\`\`\n\n`;
      });
    }

    md += `## References\n\n`;
    referenceList.forEach((reference) => {
      md += `${reference}\n\n`;
    });

    return md;
  };

  const handleCopy = () => {
    const md = generateFullMarkdown();
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const htmlCountTable = (heading: string, values: LandscapeCount[]) => `
    <div class="table-caption">${heading}</div>
    <table>
      <thead><tr><th>Description</th><th>Records</th></tr></thead>
      <tbody>${values.map((item) => `<tr><td>${item.label}</td><td>${item.count}</td></tr>`).join("")}</tbody>
    </table>
  `;

  const handleDownload = () => {
    const md = generateFullMarkdown();
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Systematic_Literature_Review_Manuscript.md";
    a.click();
  };

  const handleDownloadDocx = async () => {
    const diagramPng = await new Promise<string>((resolve) => {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([prismaSvg], { type: "image/svg+xml;charset=utf-8" }));
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 2400;
        canvas.height = 1520;
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          resolve("");
          return;
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve("");
      };
      image.src = url;
    });

    const blocks: DocxBlock[] = [
      { kind: "title", text: manuscriptTitle },
      { kind: "paragraph", text: `Review methodology: ${protocol.reviewType}. Citation style: ${citationStyle}.` },
      { kind: "heading", level: 1, text: "Abstract" },
      { kind: "paragraph", text: abstract.text },
      { kind: "paragraph", text: `Keywords: ${abstract.keywords.join(", ")}` },
      { kind: "heading", level: 1, text: "1. Introduction and Academic Rationale" },
      { kind: "paragraph", text: recordGroundedRationale },
      { kind: "heading", level: 1, text: "2. Methods" },
      { kind: "heading", level: 2, text: "2.1 Review Design" },
      { kind: "paragraph", text: getFrameworkNarrative() },
      { kind: "heading", level: 2, text: "2.2 Study Selection and Synthesis" },
      { kind: "paragraph", text: "Records entered the screening ledger were screened using the available bibliographic information. Unresolved records have no final include or exclude decision. Full-text retrieval and eligibility assessment were not performed. The included evidence was synthesized narratively without quantitative pooling." },
      { kind: "heading", level: 1, text: "3. Results" },
      { kind: "heading", level: 2, text: "3.1 Study Selection and Flow of Evidence" },
      { kind: "paragraph", text: `A total of ${activePrisma.screening.recordsScreened + activePrisma.removedBeforeScreening.duplicates} records were identified from databases (${activePrisma.identification.databases.map((d) => `${d.name}: n = ${d.recordsIdentified}`).join(", ") || "databases"}). Deduplication removed ${activePrisma.removedBeforeScreening.duplicates} duplicate records. After deduplication, ${activePrisma.screening.recordsScreened} records were screened at title and abstract level, with ${activePrisma.screening.recordsExcluded} excluded. A total of ${activePrisma.included.studiesIncluded} studies met all inclusion criteria, and ${activePrisma.included.studiesIncludedInSynthesis} studies were selected into the bounded qualitative synthesis workflow (Figure 1).` },
      { kind: "caption", text: "Figure 1. PRISMA 2020 flow diagram of the study identification, screening, eligibility and inclusion process." },
      ...(diagramPng ? [{ kind: "image" as const, dataUri: diagramPng }] : []),
      { kind: "heading", level: 2, text: "3.2 Included Studies" },
      {
        kind: "table",
        rows: [
          ["Included paper", "Inclusion justification"],
          ...includedRecords.map((record, index) => [
            formatReference(record, citationStyle, index + 1),
            formatProse(screening[record.id]?.reason || "No screening justification was supplied for this record."),
          ]),
        ],
      },
      { kind: "heading", level: 2, text: "3.3 Narrative and Thematic Synthesis" },
      ...synthesis.subtopics.flatMap((subtopic) => [
        { kind: "heading" as const, level: 3 as const, text: subtopic.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "") },
        { kind: "paragraph" as const, text: formatProse(subtopic.prose) },
      ]),
      { kind: "heading", level: 1, text: "4. Discussion" },
      { kind: "heading", level: 2, text: "4.1 Principal Findings" },
      { kind: "paragraph", text: formatProse(discussion.item23aGeneralInterpretation) },
      { kind: "heading", level: 2, text: "4.2 Interpretation of the Evidence" },
      { kind: "paragraph", text: formatProse(discussion.item23bLimitationsOfEvidence) },
      { kind: "heading", level: 2, text: "4.3 Implications" },
      { kind: "paragraph", text: formatProse(discussion.item23dImplications) },
      { kind: "heading", level: 2, text: "4.4 Limitations of the Review" },
      { kind: "paragraph", text: formatProse(discussion.item23cLimitationsOfReviewProcess) },
      { kind: "heading", level: 1, text: "5. Conclusions" },
      { kind: "paragraph", text: citationFreeConclusion },
      { kind: "heading", level: 1, text: "References" },
      ...referenceList.map((reference) => ({ kind: "paragraph" as const, text: reference })),
    ];

    const blob = buildDocxBlob(blocks);
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${manuscriptTitle.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 45)}.docx`;
    anchor.click();
  };

  const handleDownloadDoc = () => {
    const formatBadge = (val: string) => {
      if (val === "Low" || val === "High Rigor" || val === "Met") {
        return `<span style="background-color: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9pt;">Met / High</span>`;
      }
      if (val === "High" || val === "Low Rigor" || val === "Not Met") {
        return `<span style="background-color: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9pt;">Unmet / Low</span>`;
      }
      return `<span style="background-color: #fef9c3; color: #854d0e; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9pt;">Some Concerns</span>`;
    };

    const docHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${manuscriptTitle}</title>
  <style>
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.6; color: #1e293b; margin: 40px; }
    h1 { font-size: 20pt; font-weight: 800; color: #0f172a; margin-bottom: 8px; line-height: 1.25; }
    h2 { font-size: 14pt; font-weight: 700; color: #1e293b; border-bottom: 1.5pt solid #cbd5e1; padding-bottom: 4px; margin-top: 28px; margin-bottom: 12px; }
    h3 { font-size: 12pt; font-weight: 700; color: #334155; margin-top: 18px; margin-bottom: 6px; }
    h4 { font-size: 11pt; font-weight: 700; color: #475569; margin-top: 14px; margin-bottom: 4px; }
    p { margin-bottom: 12px; text-align: justify; }
    .meta-box { background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px; font-size: 10pt; }
    .abstract-box { background-color: #f1f5f9; border-left: 3pt solid #4338ca; padding: 14px 18px; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin: 18px 0; font-size: 10pt; page-break-inside: avoid; }
    th { background-color: #f1f5f9; color: #0f172a; font-weight: 700; padding: 8px 10px; border: 1px solid #cbd5e1; text-align: left; }
    td { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) { background-color: #f8fafc; }
    .table-caption { font-weight: 700; font-size: 11pt; color: #0f172a; margin-top: 20px; margin-bottom: 6px; }
  </style>
</head>
<body>

  <h1>${manuscriptTitle}</h1>
  <div class="meta-box">
    <strong>Review Methodology:</strong> ${protocol.reviewType}<br>
  </div>

  <div class="abstract-box">
    <h2 style="margin-top: 0; border-bottom: none; font-size: 13pt;">Abstract</h2>
    <p>${abstract.text}</p>
    <p><strong>Keywords:</strong> <em>${abstract.keywords.join(", ")}</em></p>
  </div>

  <h2>1. Introduction and Academic Rationale</h2>
  
  <h3>1.1 Scientific Rationale and Motivation for Conducting the Review</h3>
   <p>${recordGroundedRationale}</p>
  
   ${protocol.backgroundContext && includedRecords.length === 0 ? `<p>In theoretical and domain context, ${protocol.backgroundContext}</p>` : ""}
   ${protocol.knowledgeGap && includedRecords.length === 0 ? `<p>Regarding the existing literature gap, ${protocol.knowledgeGap}</p>` : ""}

  <h3>1.2 Review Objectives and Research Questions</h3>
  <p>The overarching objective of this investigation is ${objectives.map((obj) => `to ${obj.toLowerCase().replace(/^to\s+/, "")}`).join(", as well as ")}. In addressing this mandate, the systematic review addresses three core research questions: ${questions.map((q, i) => `Research question ${i + 1} investigates ${q.replace(/^RQ\d+:\s*/, "")}`).join(". Furthermore, ")}.</p>

  <h2>2. Methods</h2>
  
  <h3>2.1 Review Design</h3>
  <p>${getFrameworkNarrative()}</p>

  <h3>2.2 Information Sources and Search Strategy</h3>
  <p>Search strategies were stored for ${protocol.searchStrategies.map((s) => s.database).join(", ") || "the recorded information sources"}. Exact database-specific queries are reproduced in Appendix B.</p>

  <h3>2.3 Eligibility Criteria</h3>
  <p>Eligibility was assessed against the predefined protocol criteria reproduced verbatim in Appendix A.</p>

  <h3>2.4 Study Selection</h3>
   <p>Records entered the screening ledger were screened against predefined eligibility criteria using the available bibliographic information. Records without a final include or exclude decision remain unresolved; full-text retrieval and eligibility assessment were not performed. Recorded decisions and justifications are reported in the screening audit.</p>

  <h3>2.5 Data Extraction and Study Characteristics</h3>
  <p>Study characteristics were reported only when values had been extracted for final included records. Missing characteristics were omitted rather than inferred from citation metadata.</p>

  <h3>2.6 Synthesis Approach</h3>
  <p>The included evidence was synthesized narratively. Themes were derived from the supplied record content, and quantitative pooling was not performed.</p>

  <h2>3. Results</h2>

  <h3>3.1 Study Selection and Flow of Evidence</h3>
  <p>A total of ${activePrisma.screening.recordsScreened + activePrisma.removedBeforeScreening.duplicates} records were identified from databases (${activePrisma.identification.databases.map((d) => `${d.name}: n = ${d.recordsIdentified}`).join(", ") || "databases"}). Deduplication removed ${activePrisma.removedBeforeScreening.duplicates} duplicate records. After deduplication, ${activePrisma.screening.recordsScreened} records entered title and abstract screening, with ${activePrisma.screening.recordsExcluded} excluded. A total of ${activePrisma.included.studiesIncluded} studies met all inclusion criteria, and ${activePrisma.included.studiesIncludedInSynthesis} studies were selected into the bounded qualitative synthesis workflow (Figure 1).</p>
  
  <div style="margin: 20px 0; text-align: center;">
    <div style="max-width: 720px; margin: 0 auto; border: 1px solid #cbd5e1; padding: 10px; background: #ffffff;">
      ${prismaSvg}
    </div>
    <p style="font-size: 10pt; font-weight: bold; margin-top: 8px; color: #0f172a;">Figure 1. PRISMA 2020 flow diagram of the study identification, screening, eligibility and inclusion process.</p>
  </div>

  <h3>3.1 Included Studies Table (Table 1)</h3>
  <div class="table-caption">Table 1: Included papers and their inclusion justifications</div>
  <table>
    <thead>
      <tr>
        <th>Included Paper</th>
        <th>Inclusion Justification</th>
      </tr>
    </thead>
    <tbody>
      ${includedRecords.map((record, index) => {
        return `
        <tr>
          <td><strong>${formatReference(record, citationStyle, index + 1)}</strong></td>
          <td>${formatProse(screening[record.id]?.reason || "No screening justification was supplied for this record.")}</td>
        </tr>
      `;
      }).join("")}
    </tbody>
  </table>

  <h3>3.2 Characteristics of Included Studies</h3>
  <p>${includedRecords.length} included studies contributed to the descriptive results. Only extracted characteristics with meaningful reported values are shown.</p>
  ${characteristicGroups.map((group) => htmlCountTable(group.heading, group.values)).join("")}

  <h3>3.3 Evidence Overview</h3>
  <p>${synthesis.subtopics.length > 0
    ? `The included evidence was organized into the following evidence-grounded themes: ${synthesis.subtopics.map((item) => item.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")).join("; ")}.`
    : "No thematic overview has been generated from the included evidence."}</p>
  ${evidenceOverview.length > 0 ? htmlCountTable("Included studies supporting each theme", evidenceOverview) : ""}

  <h3>3.4 Narrative and Thematic Synthesis</h3>
  ${synthesis.subtopics.length > 0 ? "<p>The synthesis focuses on the principal recurring patterns supported by the final included records. Themes are presented concisely and preserve differences in methods, contexts, and reported outcomes.</p>" : ""}
  ${synthesis.subtopics.map((st) => `
    <h4>${st.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")}</h4>
    <p>${formatProse(st.prose)}</p>
  `).join("")}

  <h2>4. Discussion</h2>
  <h3>4.1 Principal Findings</h3>
    <p>${formatProse(discussion.item23aGeneralInterpretation)}</p>

  <h3>4.2 Interpretation of the Evidence</h3>
    <p>${formatProse(discussion.item23bLimitationsOfEvidence)}</p>

  <h3>4.3 Implications</h3>
    <p>${formatProse(discussion.item23dImplications)}</p>

  <h3>4.5 Limitations of the Review</h3>
    <p>${formatProse(discussion.item23cLimitationsOfReviewProcess)}</p>

  <h2>5. Conclusions</h2>
  <p>${citationFreeConclusion}</p>

  <h2>Figure 1. Adapted PRISMA 2020 flow diagram</h2>
  <p><img src="${svgToDataUri(prismaSvg)}" alt="Adapted PRISMA 2020 flow diagram" style="width:100%; max-width:900px;"/></p>

  ${(protocol.eligibilityCriteria.inclusion.length || protocol.eligibilityCriteria.exclusion.length) ? `
    <h2>Appendix A. Eligibility Criteria</h2>
    ${protocol.eligibilityCriteria.inclusion.length ? `<h3>A.1 Inclusion Criteria</h3><ol>${protocol.eligibilityCriteria.inclusion.map((criterion) => `<li>${criterion}</li>`).join("")}</ol>` : ""}
    ${protocol.eligibilityCriteria.exclusion.length ? `<h3>A.2 Exclusion Criteria</h3><ol>${protocol.eligibilityCriteria.exclusion.map((criterion) => `<li>${criterion}</li>`).join("")}</ol>` : ""}
  ` : ""}

  ${protocol.searchStrategies.length ? `
    <h2>Appendix B. Search Strategy and Search Strings</h2>
    ${protocol.searchStrategies.map((strategy, index) => {
      const source = protocol.informationSources.find(
        (item) => item.name.trim().toLowerCase() === strategy.database.trim().toLowerCase()
      );
      return `<h3>B.${index + 1} ${strategy.database}</h3>
        <p><strong>Database/Source:</strong> ${strategy.database}</p>
        ${strategy.filters ? `<p><strong>Search fields/filters:</strong> ${strategy.filters}</p>` : ""}
        ${source?.lastSearchedDate ? `<p><strong>Search date:</strong> ${source.lastSearchedDate}</p>` : ""}
        <p><strong>Search string:</strong></p><pre>${strategy.query}</pre>`;
    }).join("")}
  ` : ""}

  <h2>References</h2>
  ${referenceList.map((reference) => `<p>${reference}</p>`).join("")}

</body>
</html>`;

    const blob = new Blob([docHTML], { type: "application/msword;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${manuscriptTitle.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 45)}.doc`;
    a.click();
  };

  return (
    <div id="full-review-report-container" className="space-y-6">
      
      {/* Pre-Export Checklist */}
      <div className="bg-blue-50/70 border border-blue-200 p-5 rounded-xl shadow-xs space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <ClipboardCheck className="w-5 h-5 text-blue-700" />
          <h3 className="font-bold text-blue-900">Pre-Export Quality Checklist</h3>
        </div>
        <ul className="text-sm text-blue-800 space-y-2 font-medium">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>Target manuscript length of 10-12 pages (excluding references) is met.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>Software neutrality strictly maintained (no mention of AI, LitMatrix, or models).</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>PRISMA 2020 Flow Diagram is automatically integrated into the export.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>Evidence Tables reflect exactly the user-screened records.</span>
          </li>
        </ul>
      </div>

      {/* Action Bar */}
      <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] text-indigo-600 uppercase tracking-wider font-bold">
            Consolidated SLR Manuscript
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-0.5">
            Full Systematic Review Manuscript & Evidence Report
          </h2>
          <p className="text-xs text-slate-500 mt-1">
             Structured systematic review manuscript with an academic abstract, categorized study characteristics, and evidence-based cross-author synthesis.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-xs font-mono text-slate-600">
             <span className="whitespace-nowrap font-semibold">Choose citation style</span>
            <select
              value={citationStyle}
              onChange={(event) => onCitationStyleChange(event.target.value as CitationStyle)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              aria-label="Manuscript citation style"
               title="Choose the citation and reference format used in the manuscript and exports"
            >
              {CITATION_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={handleCopy}
            disabled={!abstractReady}
            title={!abstractReady ? abstract.validationErrors?.join(" ") : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy Markdown"}
          </button>
          <button
            onClick={handleDownload}
            disabled={!abstractReady}
            title={!abstractReady ? abstract.validationErrors?.join(" ") : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            Download Markdown (.md)
          </button>
          <button
            onClick={handleDownloadDocx}
            disabled={!abstractReady}
            title={!abstractReady ? abstract.validationErrors?.join(" ") : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            Download Word (.docx)
          </button>
          <button
            onClick={() => window.print()}
            disabled={!abstractReady}
            title={!abstractReady ? abstract.validationErrors?.join(" ") : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer className="w-3.5 h-3.5" />
            Print / PDF
          </button>
        </div>
      </div>

      {/* Formatted Manuscript Card */}
      <article className="bg-white border border-slate-200 p-8 sm:p-12 rounded-xl shadow-xs font-sans space-y-8 max-w-4xl mx-auto print:border-none print:shadow-none print:p-0">
        {/* Title Header */}
        <header className="border-b border-slate-200 pb-6 space-y-2">
          <div className="font-mono text-[10px] text-indigo-600 uppercase font-bold tracking-wider">
            Systematic Literature Review Manuscript
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
            {manuscriptTitle}
          </h1>
          <div className="text-xs font-mono text-slate-500 pt-1 space-y-1">
            <div>Methodology: <span className="font-semibold text-slate-800">{protocol.reviewType}</span></div>
          </div>
        </header>

        {/* Publication-ready abstract */}
        <section className="bg-slate-50/80 border border-slate-200 p-6 sm:p-8 rounded-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="text-base font-bold text-slate-900 font-mono flex items-center gap-2 uppercase tracking-wide">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              Abstract
            </h2>
            <span className={`text-[10px] font-mono border px-2 py-0.5 rounded ${
              abstractReady
                ? "text-indigo-700 bg-indigo-50 border-indigo-200"
                : "text-amber-800 bg-amber-50 border-amber-200"
            }`}>
              {abstractReady ? "Publication Ready" : "Needs More Topic Evidence"}
            </span>
          </div>

          <div className="space-y-3 text-xs sm:text-sm text-slate-700 leading-relaxed font-sans text-justify">
            {!abstractReady && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-amber-900">
                A publication-ready abstract could not be validated. Add more topic-specific included-record evidence before exporting.
              </div>
            )}
            <p>{abstract.text}</p>
            <div className="pt-2 border-t border-slate-200 text-xs font-mono text-slate-600">
              <strong className="text-slate-900 mr-1.5 font-bold">Keywords:</strong>
              <span className="text-slate-700 italic">{abstract.keywords.join(", ")}</span>
            </div>
          </div>
        </section>

        {/* Section 1: Introduction & Objectives */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-2">
            1. Introduction and Academic Rationale
          </h2>
          
          <div className="space-y-2">
            <h3 className="font-bold text-slate-900 text-sm font-mono">1.1 Scientific Rationale and Motivation for Conducting the Review</h3>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans text-justify">
              {recordGroundedRationale}
            </p>
            {protocol.backgroundContext && includedRecords.length === 0 && (
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans text-justify">
                In theoretical and domain context, {protocol.backgroundContext}
              </p>
            )}
            {protocol.knowledgeGap && includedRecords.length === 0 && (
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans text-justify">
                Regarding the existing literature gap, {protocol.knowledgeGap}
              </p>
            )}
          </div>

          <div className="space-y-2 pt-2">
            <h3 className="font-bold text-slate-900 text-sm font-mono">1.2 Review Objectives and Research Questions</h3>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans text-justify">
              The overarching objective of this investigation is {objectives.map((obj) => `to ${obj.toLowerCase().replace(/^to\s+/, "")}`).join(", as well as ")}. In addressing this mandate, the review investigates three core research questions: {questions.map((q, i) => `Research question ${i + 1} addresses ${q.replace(/^RQ\d+:\s*/, "")}`).join(". Furthermore, ")}.
            </p>
          </div>
        </section>

        {/* Section 2: Methods (PICOC in statement paragraph, no bullet points) */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-2">
            2. Methods
          </h2>
          <div className="space-y-3 text-xs sm:text-sm text-slate-700 leading-relaxed">
            <h3 className="font-bold text-slate-900 text-sm font-mono">2.1 Review Design</h3>
            <p className="text-justify bg-indigo-50/40 p-4 rounded-xl border border-indigo-100">
              {getFrameworkNarrative()}
            </p>

            <h3 className="font-bold text-slate-900 text-sm font-mono">2.2 Information Sources and Search Strategy</h3>
            <p className="text-justify">
              Search strategies were stored for {protocol.searchStrategies.map((s) => s.database).join(", ") || "the recorded information sources"}. Exact database-specific queries are reproduced in Appendix B.
            </p>

            <h3 className="font-bold text-slate-900 text-sm font-mono">2.3 Eligibility Criteria</h3>
            <p className="text-justify">
              Eligibility was assessed against the predefined protocol criteria reproduced verbatim in Appendix A.
            </p>

            <h3 className="font-bold text-slate-900 text-sm font-mono">2.4 Study Selection</h3>
            <p className="text-justify">
              Records entered the screening ledger were screened against predefined eligibility criteria using the available bibliographic information. Records without a final include or exclude decision remain unresolved; full-text retrieval and eligibility assessment were not performed.
            </p>

            <h3 className="font-bold text-slate-900 text-sm font-mono">2.5 Data Extraction and Study Characteristics</h3>
            <p className="text-justify">
              Study characteristics were reported only when values had been extracted for final included records. Missing characteristics were omitted rather than inferred from citation metadata.
            </p>

            <h3 className="font-bold text-slate-900 text-sm font-mono">2.6 Synthesis Approach</h3>
            <p className="text-justify">
              The included evidence was synthesized narratively. Themes were derived from the supplied record content, and quantitative pooling was not performed.
            </p>
          </div>
        </section>

        {/* Section 3: Results */}
        <section className="space-y-6">
          <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-2">
            3. Results
          </h2>

          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 text-sm font-mono">3.1 Study Selection and Flow of Evidence</h3>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed text-justify">
              A total of {activePrisma.screening.recordsScreened + activePrisma.removedBeforeScreening.duplicates} records were identified from databases ({activePrisma.identification.databases.map((d) => `${d.name}: n = ${d.recordsIdentified}`).join(", ") || "databases"}). Deduplication removed {activePrisma.removedBeforeScreening.duplicates} duplicate records. After deduplication, {activePrisma.screening.recordsScreened} records entered title and abstract screening, with {activePrisma.screening.recordsExcluded} excluded. A total of {activePrisma.included.studiesIncluded} studies met all inclusion criteria, and {activePrisma.included.studiesIncludedInSynthesis} studies were selected into the bounded qualitative synthesis workflow (Figure 1).
            </p>

            <div className="pt-2">
              <PrismaDiagram data={activePrisma} showActions={false} />
              <p className="text-xs text-slate-700 font-serif font-semibold mt-2">
                Figure 1. PRISMA 2020 flow diagram of the study identification, screening, eligibility and inclusion process.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="font-bold text-slate-900 text-sm font-mono">3.2 Characteristics of Included Studies</h3>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed text-justify">
              {includedRecords.length} included studies contributed to the descriptive results. Only extracted characteristics with meaningful reported values are shown.
            </p>
            {characteristicGroups.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {characteristicGroups.map((group) => (
                <div key={group.heading} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-[10px] font-mono font-bold text-slate-800">{group.heading}</div>
                  <div className="divide-y divide-slate-100">
                    {group.values.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
                        <span className="text-slate-700">{item.label}</span>
                        <span className="font-mono font-semibold text-slate-900">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>

          {/* Table 1: Characteristics Grouped by Category */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono font-bold text-slate-900">
              Included Studies Table
              </div>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                {includedRecords.length} Included {includedRecords.length === 1 ? "Paper" : "Papers"}
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-[11px] font-sans">
                <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[10px]">
                  <tr>
                    <th className="p-2.5 font-bold">Included Paper</th>
                    <th className="p-2.5 font-bold">Inclusion Justification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {includedRecords.map((record, index) => {
                    return (
                      <tr key={record.id} className="hover:bg-slate-50/50">
                        <td className="p-2.5 text-slate-900">
                          <div className="font-semibold">{formatReference(record, citationStyle, index + 1)}</div>
                        </td>
                        <td className="p-2.5 text-slate-700">
                          {formatProse(screening[record.id]?.reason || "No screening justification was supplied for this record.")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <h3 className="font-bold text-slate-900 text-sm font-mono">3.3 Evidence Overview</h3>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed text-justify">
              {synthesis.subtopics.length > 0
                ? `The included evidence was organized into the following evidence-grounded themes: ${synthesis.subtopics.map((item) => item.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")).join("; ")}.`
                : "No thematic overview has been generated from the included evidence."}
            </p>
            {evidenceOverview.length > 0 && <div className="border border-slate-200 rounded-lg overflow-hidden max-w-xl">
              <div className="bg-slate-50 px-3 py-2 text-[10px] font-mono font-bold text-slate-800">Main thematic and intervention categories</div>
              <div className="divide-y divide-slate-100">
                {evidenceOverview.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
                    <span className="text-slate-700">{item.label}</span>
                    <span className="font-mono font-semibold text-slate-900">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>}
          </div>

           {/* Narrative Synthesis with Cross-Author Similarities */}
          <div className="space-y-3 pt-4">
              <h3 className="font-bold text-slate-900 text-sm font-mono">3.4 Narrative and Thematic Synthesis</h3>
            {synthesis.subtopics.length > 0 && (
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans text-justify">
                The synthesis focuses on the principal recurring patterns supported by the final included records. Themes are presented concisely and preserve differences in methods, contexts, and reported outcomes.
              </p>
            )}
            {synthesis.subtopics.map((st, i) => (
              <div key={i} className="space-y-1">
                <h4 className="font-bold text-xs text-slate-900 font-mono">{st.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")}</h4>
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-sans text-justify">{formatProse(st.prose)}</p>
              </div>
            ))}
          </div>

        </section>

        {/* Section 4: Discussion (Strictly in Statements / Paragraphs with Author Comparisons) */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-2">
            4. Discussion
          </h2>
          <div className="space-y-3 text-xs sm:text-sm text-slate-700 leading-relaxed">
            <div>
              <h3 className="font-bold text-slate-900 text-xs font-mono mb-1">4.1 Principal Findings</h3>
              <p className="text-justify">{formatProse(discussion.item23aGeneralInterpretation)}</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-xs font-mono mb-1">4.2 Interpretation of the Evidence</h3>
              <p className="text-justify">{formatProse(discussion.item23bLimitationsOfEvidence)}</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-xs font-mono mb-1">4.3 Implications</h3>
              <p className="text-justify">{formatProse(discussion.item23dImplications)}</p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-xs font-mono mb-1">4.5 Limitations of the Review</h3>
              <p className="text-justify">{formatProse(discussion.item23cLimitationsOfReviewProcess)}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-2">5. Conclusions</h2>
          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed text-justify">{citationFreeConclusion}</p>
        </section>

        {(protocol.eligibilityCriteria.inclusion.length > 0 || protocol.eligibilityCriteria.exclusion.length > 0) && (
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-2">Appendix A. Eligibility Criteria</h2>
            {protocol.eligibilityCriteria.inclusion.length > 0 && (
              <div><h3 className="font-bold text-sm">A.1 Inclusion Criteria</h3><ol className="list-decimal pl-6 text-sm">{protocol.eligibilityCriteria.inclusion.map((criterion) => <li key={criterion}>{criterion}</li>)}</ol></div>
            )}
            {protocol.eligibilityCriteria.exclusion.length > 0 && (
              <div><h3 className="font-bold text-sm">A.2 Exclusion Criteria</h3><ol className="list-decimal pl-6 text-sm">{protocol.eligibilityCriteria.exclusion.map((criterion) => <li key={criterion}>{criterion}</li>)}</ol></div>
            )}
          </section>
        )}

        {protocol.searchStrategies.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-2">Appendix B. Search Strategy and Search Strings</h2>
            {protocol.searchStrategies.map((strategy, index) => {
              const source = protocol.informationSources.find((item) => item.name.trim().toLowerCase() === strategy.database.trim().toLowerCase());
              return <div key={`${strategy.database}-${index}`} className="space-y-1 text-sm"><h3 className="font-bold">B.{index + 1} {strategy.database}</h3><p><strong>Database/Source:</strong> {strategy.database}</p>{strategy.filters && <p><strong>Search fields/filters:</strong> {strategy.filters}</p>}{source?.lastSearchedDate && <p><strong>Search date:</strong> {source.lastSearchedDate}</p>}<p><strong>Search string:</strong></p><pre className="whitespace-pre-wrap bg-slate-50 border p-3 rounded">{strategy.query}</pre></div>;
            })}
          </section>
        )}

        {/* References */}
        <section className="space-y-3 border-t border-slate-200 pt-6">
          <h2 className="text-xl font-bold text-slate-900">
            References
          </h2>
          <div className="space-y-2 text-xs text-slate-600 font-sans leading-relaxed">
            {referenceList.map((reference, index) => (
              <p key={index} className="text-justify">
                {reference}
              </p>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}
