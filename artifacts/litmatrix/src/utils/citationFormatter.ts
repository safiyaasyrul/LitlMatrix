import { CitationStyle, SLRRecord } from "../types/slr";

export const CITATION_STYLE_OPTIONS: Array<{ value: CitationStyle; label: string }> = [
  { value: "apa7", label: "APA 7th" },
  { value: "ieee", label: "IEEE" },
  { value: "vancouver", label: "Vancouver" },
  { value: "harvard", label: "Harvard" },
];

export const DEFAULT_CITATION_STYLE: CitationStyle = "apa7";

const clean = (value?: string) => value?.replace(/\s+/g, " ").trim() || "";

const firstAuthorSurname = (record: SLRRecord) => {
  const firstAuthor = clean(record.authors?.[0]);
  if (!firstAuthor) return "";
  return firstAuthor.includes(",")
    ? firstAuthor.split(",")[0].trim()
    : firstAuthor.split(/\s+/).slice(-1)[0] || "";
};

const authorList = (record: SLRRecord) => record.authors?.map(clean).filter(Boolean) || [];

const formatAuthorsAPA = (authors: string[]) => {
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]}, & ${authors[1]}`;
  if (authors.length <= 20) {
    return `${authors.slice(0, -1).join(", ")}, & ${authors[authors.length - 1]}`;
  }
  return `${authors.slice(0, 19).join(", ")}, ... ${authors[authors.length - 1]}`;
};

const formatAuthorsVancouver = (authors: string[]) =>
  authors.length > 0 ? authors.join(", ") : "";

const year = (record: SLRRecord) => clean(record.year) || "n.d.";
const title = (record: SLRRecord) => clean(record.title);
const source = (record: SLRRecord) => clean(record.source);
const doi = (record: SLRRecord) => {
  const value = clean(record.doi);
  if (!value) return "";
  return `https://doi.org/${value.replace(/^https?:\/\/doi\.org\//i, "")}`;
};

export const formatReference = (
  record: SLRRecord,
  style: CitationStyle = DEFAULT_CITATION_STYLE,
  index?: number
) => {
  const authors = authorList(record);
  const authorText = formatAuthorsAPA(authors);
  const vancouverAuthors = formatAuthorsVancouver(authors);
  const articleTitle = title(record);
  const journal = source(record);
  const recordDoi = doi(record);
  const number = index == null ? "" : `[${index}] `;

  if (style === "ieee") {
    const parts = [
      vancouverAuthors,
      articleTitle ? `"${articleTitle},"` : "",
      journal ? `${journal},` : "",
      year(record),
      recordDoi ? `doi: ${recordDoi}` : "",
    ].filter(Boolean);
    return `${number}${parts.join(" ")}`.replace(/\s+,/g, ",").replace(/,\s*$/, ".");
  }

  if (style === "vancouver") {
    const parts = [
      vancouverAuthors ? `${vancouverAuthors.replace(/\.+$/, "")}.` : "",
      articleTitle ? `${articleTitle}.` : "",
      journal ? `${journal}.` : "",
      year(record) !== "n.d." ? `${year(record)}.` : "",
      recordDoi ? `doi: ${recordDoi}.` : "",
    ].filter(Boolean);
    return `${number}${parts.join(" ")}`.trim() || `${number}${articleTitle || "Untitled record"}`;
  }

  if (style === "harvard") {
    const parts = [
      authorText ? `${authorText} (${year(record)})` : `(${year(record)})`,
      articleTitle ? `${articleTitle}.` : "",
      journal ? `${journal}.` : "",
      recordDoi ? recordDoi : "",
    ].filter(Boolean);
    return parts.join(" ");
  }

  const parts = [
    authorText ? `${authorText} (${year(record)}).` : `(${year(record)}).`,
    articleTitle ? `${articleTitle}.` : "",
    journal ? `${journal}.` : "",
    recordDoi ? recordDoi : "",
  ].filter(Boolean);
  return parts.join(" ");
};

export const formatInTextCitation = (
  record: SLRRecord,
  style: CitationStyle = DEFAULT_CITATION_STYLE,
  index?: number,
  narrative = false
) => {
  if (style === "ieee" || style === "vancouver") {
    return `[${index ?? 1}]`;
  }

  const surname = firstAuthorSurname(record);
  const authors = authorList(record);
  const authorPart = !surname
    ? ""
    : authors.length > 2
      ? `${surname} et al.`
      : authors.length === 2
        ? `${surname} & ${firstAuthorSurname({ ...record, authors: [authors[1]] })}`
        : surname;
  return narrative
    ? `${authorPart || "Study"} (${year(record)})`
    : `(${authorPart ? `${authorPart}, ` : ""}${year(record)})`;
};

const citationAliases = (record: SLRRecord) => {
  const surname = firstAuthorSurname(record);
  const recordYear = year(record);
  if (!surname) return [];
  return [
    `${escapeRegExp(surname)}\\s+et al\\.\\s*\\(${escapeRegExp(recordYear)}\\)`,
    `${escapeRegExp(surname)}\\s+et al\\.,?\\s*${escapeRegExp(recordYear)}`,
    `${escapeRegExp(surname)}\\s*\\(${escapeRegExp(recordYear)}\\)`,
    `${escapeRegExp(surname)},?\\s*${escapeRegExp(recordYear)}`,
  ];
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Converts legacy author-year strings in stored/generated text at render time.
 * The evidence relationship remains record-ID based; this function only changes
 * presentation and therefore never changes which records support a statement.
 */
export const formatCitationText = (
  value: string,
  records: SLRRecord[],
  style: CitationStyle = DEFAULT_CITATION_STYLE
) => {
  if (!value || records.length === 0) return value;
  let formatted = value;
  records.forEach((record, recordIndex) => {
    citationAliases(record).forEach((alias) => {
      const pattern = new RegExp(alias, "gi");
      formatted = formatted.replace(pattern, (match, offset: number, fullText: string) => {
        const before = fullText[offset - 1];
        const after = fullText[offset + match.length];
        if (style === "ieee" || style === "vancouver") {
          return `[${recordIndex + 1}]`;
        }
        if (before === "(" && after === ")") {
          return formatInTextCitation(record, style, recordIndex + 1)
            .replace(/^\(|\)$/g, "");
        }
        return formatInTextCitation(record, style, recordIndex + 1, true);
      });
    });
  });
  return formatted.replace(/\(\[(\d+(?:\s*,\s*\d+)*)\]\)/g, "[$1]");
};

export const formatReferences = (
  records: SLRRecord[],
  style: CitationStyle = DEFAULT_CITATION_STYLE
) => records.map((record, index) => formatReference(record, style, index + 1));
