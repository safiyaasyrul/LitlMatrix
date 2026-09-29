export const MAX_INTRODUCTION_RECORDS = 100;
export const MAX_DETAILED_RECORDS = 100;

export type RecordData = Record<string, unknown>;

export type EvidenceContext = {
  criteria?: string[];
  protocol?: Record<string, unknown> | null;
  maxIntroduction?: number;
  maxDetailed?: number;
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
  const maxLimit = Math.max(1, Math.min(100, context.maxIntroduction ?? MAX_INTRODUCTION_RECORDS));
  return [...records]
    .map((record, index) => ({ record, index, score: relevanceScore(record, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxLimit)
    .map(({ record }) => record);
}

export function selectDetailedRecords(records: RecordData[], characteristics: RecordData[] = [], context: EvidenceContext = {}) {
  const terms = termsFromContext(context);
  const characteristicIds = new Set(characteristics.map((c) => String(c.recordId ?? c.id ?? "")));
  const methodTerms = ["method", "methodology", "experiment", "simulation", "model", "case study", "intervention", "design", "sample", "population", ...terms];
  const maxLimit = Math.max(1, Math.min(100, context.maxDetailed ?? MAX_DETAILED_RECORDS));
  return [...records]
    .map((record, index) => ({
      record,
      index,
      score: relevanceScore(record, methodTerms) + (record.studyType ? 4 : 0) + (characteristicIds.has(String(record.id)) ? 8 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxLimit)
    .map(({ record }) => record);
}

export function getFirstAuthorLastName(authors: unknown): string {
  if (!Array.isArray(authors) || !authors.length) return "Unknown";
  const first = String(authors[0]).trim();
  if (first.includes(",")) return first.split(",")[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1] || first;
}

export function formatInTextCitation(record: RecordData, index: number, style: string = "APA 7th"): string {
  const authors = Array.isArray(record.authors) ? (record.authors as string[]) : [];
  const first = getFirstAuthorLastName(authors);
  const year = String(record.year ?? "n.d.").trim() || "n.d.";

  if (style === "IEEE" || style === "Vancouver") {
    return `[${index + 1}]`;
  }
  if (style === "Harvard") {
    if (authors.length > 2) return `(${first} et al., ${year})`;
    if (authors.length === 2) return `(${first} and ${getFirstAuthorLastName([authors[1]])}, ${year})`;
    return `(${first}, ${year})`;
  }
  // Default APA 7th
  if (authors.length > 2) return `(${first} et al., ${year})`;
  if (authors.length === 2) return `(${first} & ${getFirstAuthorLastName([authors[1]])}, ${year})`;
  return `(${first}, ${year})`;
}

export function formatFullReference(record: RecordData, index: number, style: string = "APA 7th"): string {
  const authors = Array.isArray(record.authors) ? (record.authors as string[]) : [];
  const authorList = authors.length > 0 ? authors.join(", ") : "Unknown Author";
  const year = String(record.year ?? "n.d.").trim() || "n.d.";
  const title = String(record.title ?? "Untitled").trim();
  const source = String(record.source ?? record.journal ?? "").trim();
  const doi = record.doi ? `https://doi.org/${String(record.doi).trim()}` : "";

  if (style === "IEEE") {
    return `[${index + 1}] ${authorList}, "${title}," ${source ? source + ", " : ""}${year}.${doi ? " " + doi : ""}`;
  }
  if (style === "Vancouver") {
    return `${index + 1}. ${authorList}. ${title}. ${source}. ${year}.${doi ? " Available from: " + doi : ""}`;
  }
  if (style === "Harvard") {
    return `${authorList} (${year}) '${title}', ${source}.${doi ? " doi: " + doi : ""}`;
  }
  // Default APA 7th
  return `${authorList} (${year}). ${title}. ${source ? source + ". " : ""}${doi ? doi : ""}`;
}

export function enrichRecordsWithCitations(records: RecordData[], startIndex: number = 0, style: string = "APA 7th"): RecordData[] {
  return records.map((record, i) => {
    const idx = startIndex + i;
    return {
      ...record,
      citationNumber: idx + 1,
      inTextCitation: formatInTextCitation(record, idx, style),
      fullReference: formatFullReference(record, idx, style),
    };
  });
}
