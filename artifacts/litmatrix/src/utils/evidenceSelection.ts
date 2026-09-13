import { SLRRecord, StudyCharacteristic, SLRProtocol } from "../types/slr";

const MAX_INTRODUCTION_RECORDS = 100;
const MAX_DETAILED_RECORDS = 50;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "among",
  "and",
  "are",
  "based",
  "been",
  "being",
  "between",
  "both",
  "can",
  "could",
  "data",
  "different",
  "during",
  "each",
  "for",
  "from",
  "have",
  "into",
  "more",
  "most",
  "other",
  "over",
  "such",
  "than",
  "that",
  "their",
  "these",
  "they",
  "this",
  "those",
  "through",
  "using",
  "were",
  "which",
  "with",
  "within",
  "without",
  "study",
  "studies",
  "analysis",
  "review",
  "systematic",
  "literature",
]);

const clean = (value: unknown): string =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";

const tokenize = (text: string): string[] =>
  clean(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter(
      (word) =>
        word.length >= 3 &&
        !STOP_WORDS.has(word) &&
        !/^\d+$/.test(word)
    );

const unique = <T,>(items: T[]): T[] =>
  Array.from(new Set(items));

/**
 * Creates a compact concept vocabulary from the review protocol.
 * No AI call is made.
 */
const getProtocolTerms = (protocol?: SLRProtocol): Set<string> => {
  if (!protocol) return new Set();

  const source = [
    clean((protocol as any).title),
    clean((protocol as any).researchQuestion),
    clean((protocol as any).question),
    clean((protocol as any).objective),
    clean((protocol as any).objectives),
    clean((protocol as any).scope),
    clean((protocol as any).population),
    clean((protocol as any).intervention),
    clean((protocol as any).outcome),
    clean((protocol as any).context),
  ]
    .filter(Boolean)
    .join(" ");

  return new Set(tokenize(source));
};

const overlapScore = (
  termsA: Set<string>,
  termsB: Set<string>
): number => {
  if (termsA.size === 0 || termsB.size === 0) return 0;

  let matches = 0;

  termsA.forEach((term) => {
    if (termsB.has(term)) matches += 1;
  });

  return matches / Math.max(termsA.size, 1);
};

/**
 * Stage 1:
 *
 * Select up to 100 records using TITLE relevance.
 *
 * This is deterministic and does not call an AI model.
 */
export const selectIntroductionRecords = (
  records: SLRRecord[],
  protocol?: SLRProtocol
): SLRRecord[] => {
  if (records.length <= MAX_INTRODUCTION_RECORDS) {
    return [...records];
  }

  const protocolTerms = getProtocolTerms(protocol);

  const documentFrequency = new Map<string, number>();

  records.forEach((record) => {
    const terms = unique(tokenize(clean(record.title)));

    terms.forEach((term) => {
      documentFrequency.set(
        term,
        (documentFrequency.get(term) || 0) + 1
      );
    });
  });

  const scored = records.map((record, originalIndex) => {
    const titleTerms = unique(tokenize(clean(record.title)));
    const titleSet = new Set(titleTerms);

    const protocolRelevance =
      overlapScore(titleSet, protocolTerms);

    const centrality =
      titleTerms.reduce(
        (sum, term) =>
          sum +
          1 / Math.max(documentFrequency.get(term) || 1, 1),
        0
      );

    const titleInformation =
      Math.min(titleTerms.length, 15) / 15;

    const abstractAvailability =
      clean(record.abstract).length > 0 ? 0.05 : 0;

    const score =
      protocolRelevance * 100 +
      centrality * 5 +
      titleInformation * 5 +
      abstractAvailability;

    return {
      record,
      score,
      originalIndex,
    };
  });

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.originalIndex - b.originalIndex
    )
    .slice(0, MAX_INTRODUCTION_RECORDS)
    .map((item) => item.record);
};

/**
 * Stage 2:
 *
 * From the 100-record title-relevant set, select up to 50
 * records using method/study/content/intervention evidence.
 *
 * Again, this is entirely local.
 */
export const selectDetailedEvidenceRecords = (
  records: SLRRecord[],
  characteristics: StudyCharacteristic[],
  protocol?: SLRProtocol
): SLRRecord[] => {
  if (records.length <= MAX_DETAILED_RECORDS) {
    return [...records];
  }

  const protocolTerms = getProtocolTerms(protocol);

  const characteristicMap = new Map<
    string,
    StudyCharacteristic
  >();

  characteristics.forEach((characteristic) => {
    if (characteristic.recordId) {
      characteristicMap.set(
        characteristic.recordId,
        characteristic
      );
    }
  });

  const scored = records.map((record, originalIndex) => {
    const characteristic = characteristicMap.get(record.id);

    const intervention = clean(
      (characteristic as any)?.interventionOrFocus
    );

    const studyDesign = clean(
      (characteristic as any)?.studyDesign
    );

    const population = clean(
      (characteristic as any)?.population
    );

    const outcome = clean(
      (characteristic as any)?.primaryOutcome
    );

    const keyFinding = clean(
      (characteristic as any)?.keyFinding
    );

    const comparator = clean(
      (characteristic as any)?.comparator
    );

    const category = clean(
      (characteristic as any)?.category
    );

    const abstract = clean(record.abstract);
    const title = clean(record.title);

    const evidenceText = [
      title,
      abstract,
      intervention,
      studyDesign,
      population,
      outcome,
      keyFinding,
      comparator,
      category,
    ]
      .filter(Boolean)
      .join(" ");

    const evidenceTerms = new Set(
      tokenize(evidenceText)
    );

    const interventionTerms = new Set(
      tokenize(intervention)
    );

    const methodTerms = new Set(
      tokenize(studyDesign)
    );

    const contentTerms = new Set(
      tokenize(`${abstract} ${keyFinding} ${outcome}`)
    );

    const protocolRelevance =
      overlapScore(evidenceTerms, protocolTerms);

    const interventionRelevance =
      overlapScore(
        interventionTerms,
        protocolTerms
      );

    const contentRelevance =
      overlapScore(
        contentTerms,
        protocolTerms
      );

    const hasMethod =
      studyDesign.length > 0 &&
      studyDesign.toLowerCase() !==
        "not reported in the supplied record";

    const hasIntervention =
      intervention.length > 0 &&
      intervention.toLowerCase() !==
        "not reported in the supplied record";

    const hasAbstract =
      abstract.length >= 100;

    const hasFinding =
      keyFinding.length >= 30;

    const hasOutcome =
      outcome.length > 0;

    const evidenceCompleteness =
      [
        hasMethod,
        hasIntervention,
        hasAbstract,
        hasFinding,
        hasOutcome,
      ].filter(Boolean).length / 5;

    /*
     * Slight preference for records with explicit
     * methodological and intervention information.
     *
     * This does NOT mean those studies are "better".
     * It only means they contain more usable record-level
     * information for an AI writing pass.
     */
    const methodScore = hasMethod ? 1 : 0;
    const interventionScore = hasIntervention ? 1 : 0;
    const contentScore = hasAbstract ? 1 : 0;

    const score =
      protocolRelevance * 60 +
      interventionRelevance * 25 +
      contentRelevance * 20 +
      evidenceCompleteness * 15 +
      methodScore * 5 +
      interventionScore * 5 +
      contentScore * 3;

    return {
      record,
      score,
      originalIndex,
    };
  });

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.originalIndex - b.originalIndex
    )
    .slice(0, MAX_DETAILED_RECORDS)
    .map((item) => item.record);
};

/**
 * Convenience function used by synthesis.
 *
 * 200 → 100 → 50
 */
export const buildEvidenceBudget = (
  records: SLRRecord[],
  characteristics: StudyCharacteristic[],
  protocol?: SLRProtocol
) => {
  const introductionRecords =
    selectIntroductionRecords(
      records,
      protocol
    );

  const detailedRecords =
    selectDetailedEvidenceRecords(
      introductionRecords,
      characteristics,
      protocol
    );

  return {
    allRecords: [...records],
    introductionRecords,
    detailedRecords,
  };
};
