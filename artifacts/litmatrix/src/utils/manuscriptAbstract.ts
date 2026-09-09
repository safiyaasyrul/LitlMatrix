import {
  SLRProtocol,
  SLRRecord,
  StudyCharacteristic,
  SynthesisResult,
} from "../types/slr";
import { getIncludedEvidenceKey } from "./evidenceKey";

export interface ManuscriptAbstract {
  text: string;
  keywords: string[];
  validationErrors?: string[];
}

const METHOD_TERMS = new Set([
  "analysis", "approach", "approaches", "evidence", "literature",
  "meta-analysis", "methodology", "model", "models", "narrative", "prisma",
  "research", "review", "reviews", "studies", "study", "syntheses",
  "synthesis", "systematic", "thematic",
]);

const CONNECTOR_TERMS = new Set([
  "about", "across", "after", "among", "and", "based", "between",
  "for", "from", "in", "into", "of", "on", "the", "this", "through", "to",
  "using", "with", "within",
]);

const cleanText = (value?: string) =>
  (value || "")
    .replace(/\b(?:Background|Objective|Objectives|Methods|Results|Conclusion|Discussion and Conclusion)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const endSentence = (value: string) => {
  const cleaned = cleanText(value).replace(/[,:;]\s*$/, "");
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
};

const firstCompleteSentence = (value?: string, maxWords = 36) => {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  const first = cleaned.split(/(?<=[.!?])\s+/)[0];
  const words = first.split(/\s+/);
  if (words.length <= maxWords) return endSentence(first);
  return "";
};

const normalizeTopic = (title: string) => {
  const cleaned = cleanText(title)
    .replace(/\b(?:a\s+)?systematic(?:\s+literature)?\s+review\b/gi, "")
    .replace(/\b(?:a\s+)?narrative\s+synthesis\b/gi, "")
    .replace(/\s*[:—-]?\s*(?:a\s+)?PRISMA(?:\s*2020)?\b.*$/i, "")
    .replace(/\s*[:—-]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "the defined review topic";
};

const limitWords = (value: string, maximum: number) => {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  return words.length <= maximum ? words.join(" ") : words.slice(0, maximum).join(" ");
};

const uniqueReportedValues = (
  characteristics: StudyCharacteristic[],
  includedIds: Set<string>
) => {
  const values = characteristics
    .filter((item) => includedIds.has(item.recordId))
    .flatMap((item) => [
      item.category,
      item.population,
      item.interventionOrFocus,
    ])
    .map(cleanText)
    .filter((value) =>
      value &&
      !/^not (reported|available|specified|established|applicable)/i.test(value)
    );
  return Array.from(new Set(values));
};

const meaningfulWords = (value: string) =>
  cleanText(value)
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{1,}|[0-9]+/g)
    ?.filter((word) => !METHOD_TERMS.has(word) && !CONNECTOR_TERMS.has(word)) || [];

const keywordPhrases = (value: string) => {
  const rawWords = cleanText(value).toLowerCase().match(/[a-z][a-z0-9-]{1,}|[0-9]+/g) || [];
  const segments: string[][] = [];
  let segment: string[] = [];
  rawWords.forEach((word) => {
    if (CONNECTOR_TERMS.has(word)) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
      return;
    }
    if (!METHOD_TERMS.has(word)) segment.push(word);
  });
  if (segment.length > 0) segments.push(segment);

  const phrases: string[] = [];
  segments.forEach((words) => {
    if (words.length <= 3) {
      if (words.length >= 2) phrases.push(words.join(" "));
      if (words.length === 3) {
        phrases.push(words.slice(0, 2).join(" "));
        phrases.push(words.slice(1).join(" "));
      }
      return;
    }
    for (let index = 0; index <= words.length - 3; index += 1) {
      phrases.push(words.slice(index, index + 3).join(" "));
    }
    for (let index = 0; index <= words.length - 2; index += 1) {
      phrases.push(words.slice(index, index + 2).join(" "));
    }
  });
  return phrases;
};

const evidenceKeywordPhrases = (records: SLRRecord[]) => {
  const phraseCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();
  records.forEach((record) => {
    const phrases = new Set(keywordPhrases(record.title));
    phrases.forEach((phrase) => {
      phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
    });
    new Set(meaningfulWords(record.title)).forEach((word) => {
      if (word.length >= 4) wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    });
  });
  const sortCandidates = (entries: [string, number][]) => entries
    .sort((a, b) =>
      b[1] - a[1] ||
      b[0].split(/\s+/).length - a[0].split(/\s+/).length ||
      a[0].localeCompare(b[0])
    )
    .map(([phrase]) => phrase);
  return [
    ...sortCandidates(Array.from(phraseCounts.entries())),
    ...sortCandidates(Array.from(wordCounts.entries())),
  ];
};

const buildKeywords = (
  topic: string,
  records: SLRRecord[],
  characteristics: StudyCharacteristic[],
  synthesis: SynthesisResult
) => {
  const includedIds = new Set(records.map((record) => record.id));
  const synthesisMatchesEvidence =
    synthesis.titleCandidateEvidenceKey ===
    getIncludedEvidenceKey(records, characteristics);
  const phrases = [
    ...synthesis.subtopics
      .filter((item) =>
        synthesisMatchesEvidence &&
        (item.supportingRecordIds || []).some((id) => includedIds.has(id))
      )
      .map((item) => item.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "")),
    ...uniqueReportedValues(characteristics, includedIds),
  ]
    .map(cleanText)
    .filter((value) => {
      const words = meaningfulWords(value);
      return (
        words.length >= 1 &&
        words.length <= 5 &&
        !/(?:%|\bCI\b|\bAUC\b|\bp\s*[=<]|\d+\.\d+)/i.test(value)
      );
    });

  const evidenceText = records
    .map((record) => `${record.title} ${record.abstract}`)
    .join(" ");
  const wordCounts = meaningfulWords(evidenceText).reduce((counts, word) => {
    counts.set(word, (counts.get(word) || 0) + 1);
    return counts;
  }, new Map<string, number>());
  const recurringWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);

  const candidates = [
    ...evidenceKeywordPhrases(records),
    ...keywordPhrases(topic),
    ...phrases,
    ...phrases.flatMap(keywordPhrases),
    ...recurringWords,
  ];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const candidate of candidates) {
    const normalized = cleanText(candidate).replace(/[.;:,]+$/, "");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key) || METHOD_TERMS.has(key)) continue;
    if (/^\d+\s/.test(normalized)) continue;
    if (meaningfulWords(normalized).length === 0) continue;
    if (keywords.some((keyword) => {
      const existing = keyword.toLowerCase();
      return existing.includes(key) || key.includes(existing);
    })) continue;
    seen.add(key);
    keywords.push(normalized);
    if (keywords.length === 8) break;
  }

  return keywords.slice(0, 8);
};

export const validateManuscriptAbstract = (
  abstract: ManuscriptAbstract,
  includedCount: number
) => {
  const errors: string[] = [];
  const text = cleanText(abstract.text);
  const wordCount = text ? text.split(/\s+/).length : 0;

  if (!text) errors.push("Abstract is empty.");
  if (/[\r\n]/.test(abstract.text)) errors.push("Abstract must be one paragraph.");
  if (wordCount > 300) errors.push("Abstract exceeds 300 words.");
  if (text && !/[.!?]$/.test(text)) errors.push("Abstract must end with complete punctuation.");
  if (/\bRQ\s*\d+\b/i.test(text)) errors.push("Abstract contains protocol question labels.");
  if (/(?:,\s*and to|as well as|and to (?:identify|assess|evaluate|determine))/i.test(text)) {
    errors.push("Abstract contains concatenated objectives.");
  }
  if (/\b(?:AI-assisted|AI screening|automated screening|Gemini|OpenAI|API calls?|language models?|software implementation)\b/i.test(text)) {
    errors.push("Abstract contains software or automated-screening terminology.");
  }
  if (/\bfull[- ]text (?:retrieval|assessment|screening|review)\b/i.test(text)) {
    errors.push("Abstract contains an unsupported full-text claim.");
  }
  if (!new RegExp(`\\b${includedCount}\\s+(?:final\\s+)?(?:records?\\s+were\\s+included|included\\s+records?)\\b`, "i").test(text)) {
    errors.push("Abstract does not state the current included-record count.");
  }
  if (includedCount > 0 && (abstract.keywords.length < 5 || abstract.keywords.length > 8)) {
    errors.push("Abstract must contain five to eight topic-specific keywords.");
  }
  if (abstract.keywords.some((keyword) =>
    /\b(?:systematic(?:\s+literature)?\s+reviews?|evidence syntheses?|narrative syntheses?|PRISMA|research methodology|meta-analys(?:is|es))\b/i.test(keyword)
  )) {
    errors.push("Keywords contain generic review-method terminology.");
  }

  return errors;
};

export const buildManuscriptAbstract = ({
  protocol,
  manuscriptTitle,
  includedRecords,
  characteristics,
  synthesis,
}: {
  protocol: SLRProtocol;
  manuscriptTitle: string;
  includedRecords: SLRRecord[];
  characteristics: StudyCharacteristic[];
  synthesis: SynthesisResult;
}): ManuscriptAbstract => {
  const includedIds = new Set(includedRecords.map((record) => record.id));
  const topic = limitWords(normalizeTopic(manuscriptTitle || protocol.title), 24);
  const possibleProtocolContext =
    firstCompleteSentence(protocol.backgroundContext) ||
    firstCompleteSentence(protocol.introductionRationale);
  const protocolContext = /\d|%|[$£€]|\bCI\b|\bp\s*[=<]/i.test(possibleProtocolContext)
    ? ""
    : possibleProtocolContext;
  const background = protocolContext ||
    `The literature represented in this review addresses ${topic}.`;
  const knowledgeGap = firstCompleteSentence(protocol.knowledgeGap, 28);
  const researchQuestion = cleanText(protocol.primaryResearchQuestions?.[0])
    .replace(/^RQ\d+:\s*/i, "");
  const objective =
    researchQuestion
      ? `This review synthesises the available evidence on ${topic} to clarify the principal patterns and gaps documented in the literature, with particular attention to ${limitWords(researchQuestion, 28)}.`
      : `This review synthesises the available evidence on ${topic} to clarify the principal patterns and gaps documented in the literature.`;
  const informationSourceNames = protocol.informationSources
    .map((item) => cleanText(item.name))
    .filter(Boolean);
  const strategySourceNames = protocol.searchStrategies
    .map((item) => cleanText(item.database))
    .filter(Boolean);
  const configuredSources = informationSourceNames.length > 0
    ? informationSourceNames
    : strategySourceNames;
  const sources = Array.from(new Set(configuredSources));
  const sourceText = sources.length > 0
    ? sources.join(", ")
    : "the recorded information sources";

  const synthesisMatchesEvidence =
    synthesis.titleCandidateEvidenceKey ===
    getIncludedEvidenceKey(includedRecords, characteristics);
  const supportedThemes = synthesis.subtopics
    .filter((item) =>
      synthesisMatchesEvidence &&
      (item.supportingRecordIds || []).some((id) => includedIds.has(id))
    )
    .map((item) => cleanText(item.title).replace(/^\d+(?:\.\d+)*\.?\s*/, ""))
    .filter((value) => value && !/^included evidence$/i.test(value))
    .slice(0, 4);
  const synthesisMethod = supportedThemes.length > 0
    ? "narrative and thematic synthesis"
    : "narrative synthesis";
  const methods = sources.length > 0
    ? `A systematic literature review was conducted across ${sourceText}. Records were screened against predefined eligibility criteria, and ${includedRecords.length} records were included for ${synthesisMethod}.`
    : `Records were screened against predefined eligibility criteria, and ${includedRecords.length} records were included for ${synthesisMethod}.`;
  const characteristicValues = uniqueReportedValues(characteristics, includedIds)
    .filter((value) => value.split(/\s+/).length <= 8)
    .slice(0, 4);
  const reportedDesigns = Array.from(new Set(
    characteristics
      .filter((item) => includedIds.has(item.recordId))
      .map((item) => cleanText(item.studyDesign))
      .filter((value) => value && !/^not (reported|available|specified|established|applicable)/i.test(value))
  )).slice(0, 3);
  const reportedOutcomes = Array.from(new Set(
    characteristics
      .filter((item) => includedIds.has(item.recordId))
      .map((item) => cleanText(item.primaryOutcome))
      .filter((value) => value && !/^not (reported|available|specified|established|applicable)/i.test(value))
  )).slice(0, 3);
  const resultsParts = [
    supportedThemes.length > 0
      ? `The included evidence was organised around ${supportedThemes.join(", ")}`
      : "",
    characteristicValues.length > 0
      ? `reported populations, interventions, or contexts included ${characteristicValues.join(", ")}`
      : "",
    reportedDesigns.length > 0
      ? `reported study designs included ${reportedDesigns.join(", ")}`
      : "",
    reportedOutcomes.length > 0
      ? `reported outcomes included ${reportedOutcomes.join(", ")}`
      : "",
  ].filter(Boolean);
  const results = resultsParts.length > 0
    ? endSentence(resultsParts.join("; ").replace(/^./, (letter) => letter.toUpperCase()))
    : "The final evidence set supports a descriptive account of the approaches, contexts, and outcomes reported in the included records.";
  const conclusion = [
    `Collectively, the included evidence defines the current scope of work on ${topic}`,
    knowledgeGap ? `the review addresses the documented gap that ${limitWords(knowledgeGap, 28).replace(/[.!?]$/, "")}` : "",
    "and the available record-level information supports cautious narrative interpretation rather than claims beyond the supplied evidence",
    "because full-text retrieval and eligibility assessment were not performed",
  ].filter(Boolean).join("; ") + ".";

  const abstract: ManuscriptAbstract = {
    text: [
      `Background: ${background}`,
      `Objective: ${objective}`,
      `Methods: ${methods}`,
      `Results: ${results}`,
      `Conclusion: ${conclusion}`,
    ]
      .map(endSentence)
      .join(" "),
    keywords: buildKeywords(topic, includedRecords, characteristics, synthesis),
  };

  const errors = validateManuscriptAbstract(abstract, includedRecords.length);
  if (errors.length === 0) return abstract;

  const fallback: ManuscriptAbstract = {
    text: [
      `This review examines ${topic}.`,
      `It synthesises the evidence contained in the final included records.`,
      sources.length > 0
        ? `A systematic literature review was conducted across ${sourceText}; records were screened against predefined eligibility criteria, and ${includedRecords.length} records were included for narrative synthesis.`
        : `A systematic literature review was conducted using the recorded search information; records were screened against predefined eligibility criteria, and ${includedRecords.length} records were included for narrative synthesis.`,
      `The results describe only patterns supported by those records and their available extracted characteristics.`,
      `The evidence supports a cautious account of the reviewed topic without claims beyond the supplied record-level information.`,
    ].join(" "),
    keywords: buildKeywords(topic, includedRecords, characteristics, synthesis),
  };

  const fallbackErrors = validateManuscriptAbstract(fallback, includedRecords.length);
  if (fallbackErrors.length === 0) return fallback;

  const finalFallback: ManuscriptAbstract = {
    text: [
      `This review examines ${topic}.`,
      sources.length > 0
        ? `A systematic literature review was conducted across ${sourceText}.`
        : "A systematic literature review was conducted using the recorded search information.",
      `${includedRecords.length} records were included after screening against predefined eligibility criteria.`,
      "Those records and their available extracted characteristics were examined through narrative synthesis.",
      "The manuscript reports only patterns supported by the final included evidence.",
      "The evidence is interpreted cautiously without claims beyond the supplied record-level information.",
    ].join(" "),
    keywords: fallback.keywords,
  };
  const finalErrors = validateManuscriptAbstract(finalFallback, includedRecords.length);
  return finalErrors.length > 0
    ? { ...finalFallback, validationErrors: finalErrors }
    : finalFallback;
};