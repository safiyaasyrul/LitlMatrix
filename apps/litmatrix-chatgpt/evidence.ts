export const MAX_INTRODUCTION_RECORDS = 100;
export const MAX_DETAILED_RECORDS = 50;

type RecordData = Record<string, unknown>;

type EvidenceContext = {
  criteria?: string[];
  protocol?: Record<string, unknown> | null;
};

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function termsFromContext(context: EvidenceContext = {}): string[] {
  const explicit = Array.isArray(context.criteria) ? context.criteria : [];
  const protocolText = context.protocol ? JSON.stringify(context.protocol) : "";
  const protocolTerms = protocolText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 4)
    .filter((term) => !new Set(["null", "true", "false", "undefined", "review", "study", "research", "records", "protocol"]).has(term));
  return [...new Set([...explicit.map(String), ...protocolTerms])].slice(0, 120);
}

function relevanceScore(record: RecordData, terms: string[]): number {
  const title = normalize(record.title);
  const abstract = normalize(record.abstract);
  const keywords = normalize(record.keywords ?? record.authorKeywords ?? "");
  return terms.reduce((score, term) => {
    const t = term.trim().toLowerCase();
    if (!t || t.length < 2) return score;
    return score + (title.includes(t) ? 8 : 0) + (keywords.includes(t) ? 5 : 0) + (abstract.includes(t) ? 2 : 0);
  }, 0);
}

export function selectIntroductionRecords(records: RecordData[], context: EvidenceContext = {}) {
  const terms = termsFromContext(context);
  return [...records]
    .map((record, index) => ({ record, index, score: relevanceScore(record, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_INTRODUCTION_RECORDS)
    .map(({ record }) => record);
}

export function selectDetailedRecords(records: RecordData[], characteristics: RecordData[] = [], context: EvidenceContext = {}) {
  const terms = termsFromContext(context);
  const characteristicIds = new Set(characteristics.map((c) => String(c.recordId ?? c.id ?? "")));
  const methodTerms = ["method", "methodology", "experiment", "simulation", "model", "case study", "intervention", "design", "sample", "population", ...terms];
  return [...records]
    .map((record, index) => ({
      record,
      index,
      score: relevanceScore(record, methodTerms) + (record.studyType ? 4 : 0) + (characteristicIds.has(String(record.id)) ? 8 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_DETAILED_RECORDS)
    .map(({ record }) => record);
}
