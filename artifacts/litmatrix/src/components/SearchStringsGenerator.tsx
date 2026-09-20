import React, { useState, useMemo } from "react";
import { SLRProtocol } from "../types/slr";
import {
  Copy,
  Check,
  Sparkles,
  Database,
  Calendar,
  Plus,
  Trash2,
  Filter,
  Layers,
  BookOpen,
  Tag,
  Clock,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Code2,
} from "lucide-react";
import { callAI, parseJSONLoose } from "../utils/aiClient";

interface SearchStringsGeneratorProps {
  protocol: SLRProtocol;
  onUpdateProtocol: (protocol: SLRProtocol) => void;
  aiConfig: any;
}

interface KeywordItem {
  id: string;
  term: string;
  category: "Concept 1 (Population / Domain)" | "Concept 2 (Intervention / Technology)" | "Concept 3 (Outcome / Comparator)" | "MeSH & Controlled Vocabulary" | "General / Synonym";
  selected: boolean;
}

interface SearchStrategy {
  database: string;
  query: string;
  filters: string;
}

const DEFAULT_SUBJECT_AREAS = [
  { code: "COMP", name: "Computer Science", wos: "Computer Science" },
  { code: "ENGI", name: "Engineering", wos: "Engineering" },
  { code: "MEDI", name: "Medicine", wos: "General & Internal Medicine" },
  { code: "HEAL", name: "Health Professions", wos: "Health Care Sciences & Services" },
  { code: "NURS", name: "Nursing", wos: "Nursing" },
  { code: "BIOC", name: "Biochemistry, Genetics & Molecular Biology", wos: "Biochemistry & Molecular Biology" },
  { code: "DECI", name: "Decision Sciences", wos: "Operations Research & Management Science" },
  { code: "MATH", name: "Mathematics", wos: "Mathematics" },
  { code: "ENVI", name: "Environmental Science", wos: "Environmental Sciences" },
  { code: "AGRI", name: "Agricultural and Biological Sciences", wos: "Agriculture" },
  { code: "SOCI", name: "Social Sciences", wos: "Social Sciences, Interdisciplinary" },
  { code: "BUSI", name: "Business, Management and Accounting", wos: "Business" },
  { code: "MATE", name: "Materials Science", wos: "Materials Science" },
];

function buildWebOfScienceQuery(
  keywords: KeywordItem[],
  yearFrom: number,
  yearTo: number,
  docType: string,
  language: string,
): string {

  const conceptBlocks = Array.from(
    new Set(
      keywords
        .filter((keyword) => keyword.selected && keyword.term.trim())
        .map((keyword) => keyword.category)
    )
  )
    .map((category) => {
      const terms = keywords
        .filter(
          (keyword) =>
            keyword.selected &&
            keyword.term.trim() &&
            keyword.category === category
        )
        .map((keyword) =>
          `"${keyword.term
            .trim()
            .replace(/["()]/g, "")
            .replace(/\s+/g, " ")}"`
        );

      return terms.length > 0
        ? `(${Array.from(new Set(terms)).join(" OR ")})`
        : "";
    })
    .filter(Boolean);

  const topic =
    conceptBlocks.length >= 2
      ? conceptBlocks.join(" AND ")
      : `(${
          keywords
            .filter((k) => k.selected && k.term.trim())
            .map((k) => `"${k.term.trim()}"`)
            .join(" OR ") || "\"systematic review\""
        })`;

  const filters: string[] = [
    `PY=(${yearFrom}-${yearTo})`,
  ];

  if (docType === "Journal article") {
    filters.push("DT=(ARTICLE)");
  } else if (docType === "Review") {
    filters.push("DT=(REVIEW)");
  } else if (docType === "Article OR Review") {
    filters.push("DT=(ARTICLE OR REVIEW)");
  } else if (docType === "Article OR Conference Paper") {
    filters.push("DT=(ARTICLE OR PROCEEDINGS PAPER)");
  }

  if (language === "English") {
    filters.push("LA=(ENGLISH)");
  } else if (language === "Malay") {
    filters.push("LA=(MALAY)");
  } else if (language === "English OR Malay") {
    filters.push("LA=(ENGLISH OR MALAY)");
  }

  return `TI=${topic} AND ${filters.join(" AND ")}`;
}

  const uniqueTerms = Array.from(new Set(selected));
  const topic = uniqueTerms.length > 0
    ? uniqueTerms.map((term) => `"${term}"`).join(" OR ")
    : "\"systematic review\"";

  const filters = [`PY=(${yearFrom}-${yearTo})`];
  if (docType === "Journal article") filters.push("DT=(ARTICLE)");
  if (docType === "Article OR Conference Paper") filters.push("DT=(ARTICLE OR PROCEEDINGS PAPER)");
  if (docType === "Review OR Article") filters.push("DT=(REVIEW OR ARTICLE)");
  if (language === "English") filters.push("LA=(ENGLISH)");
  if (language === "English OR Malay") filters.push("LA=(ENGLISH OR MALAY)");

  return `TI=(${topic}) AND ${filters.join(" AND ")}`;
}

function quoteSearchTerm(term: string): string {
  return `"${term.trim().replace(/["()]/g, "").replace(/\s+/g, " ")}"`;
}

function buildFallbackSearchStrategies(
  keywords: KeywordItem[],
  selectedSubjectAreas: string[],
  publicationStage: "all" | "final" | "inpress",
  yearFrom: number,
  yearTo: number,
  docType: string,
  language: string,
): SearchStrategy[] {
  const selectedTerms = keywords
    .filter((keyword) => keyword.selected && keyword.term.trim())
    .map((keyword) => keyword.term.trim());

  const uniqueTerms = Array.from(new Set(selectedTerms));

  // Group accepted keywords by concept.
  const conceptBlocks = Array.from(
    new Set(
      keywords
        .filter((keyword) => keyword.selected && keyword.term.trim())
        .map((keyword) => keyword.category)
    )
  )
    .map((category) => {
      const terms = keywords
        .filter(
          (keyword) =>
            keyword.selected &&
            keyword.term.trim() &&
            keyword.category === category
        )
        .map((keyword) => quoteSearchTerm(keyword.term));

      return terms.length > 0 ? `(${terms.join(" OR ")})` : "";
    })
    .filter(Boolean);

  /*
   * Use AND between distinct concept groups.
   * If insufficient concept groups exist, fall back to an OR query.
   */
  const topic =
    conceptBlocks.length >= 2
      ? conceptBlocks.join(" AND ")
      : `(${uniqueTerms.map(quoteSearchTerm).join(" OR ") || "\"systematic review\""})`;

  /*
   * -------------------------
   * SCOPUS FILTERS
   * -------------------------
   */
  const scopusFilters: string[] = [
    `PUBYEAR > ${yearFrom - 1}`,
    `PUBYEAR < ${yearTo + 1}`,
  ];

  // Subject areas
  if (selectedSubjectAreas.length > 0) {
    scopusFilters.push(
      `(${selectedSubjectAreas
        .map((code) => `SUBJAREA(${code})`)
        .join(" OR ")})`
    );
  }

  // Publication stage
  if (publicationStage === "final") {
    scopusFilters.push("PUBSTAGE(final)");
  } else if (publicationStage === "inpress") {
    scopusFilters.push("PUBSTAGE(aip)");
  }

  // Document type
  if (docType === "Journal article") {
    scopusFilters.push("DOCTYPE(ar)");
  } else if (docType === "Review") {
    scopusFilters.push("DOCTYPE(re)");
  } else if (docType === "Article OR Review") {
    scopusFilters.push("DOCTYPE(ar OR re)");
  } else if (docType === "Article OR Conference Paper") {
    scopusFilters.push("DOCTYPE(ar OR cp)");
  } else if (docType === "All") {
    // No document-type restriction
  }

  // Language
  if (language === "English") {
    scopusFilters.push("LANGUAGE(English)");
  } else if (language === "Malay") {
    scopusFilters.push("LANGUAGE(Malay)");
  } else if (language === "English OR Malay") {
    scopusFilters.push("LANGUAGE(English OR Malay)");
  }

  const scopusQuery =
    `TITLE(${topic}) AND ${scopusFilters.join(" AND ")}`;

  /*
   * -------------------------
   * WEB OF SCIENCE FILTERS
   * -------------------------
   */

  const wosFilters: string[] = [
    `PY=(${yearFrom}-${yearTo})`,
  ];

  // Document type
  if (docType === "Journal article") {
    wosFilters.push("DT=(ARTICLE)");
  } else if (docType === "Review") {
    wosFilters.push("DT=(REVIEW)");
  } else if (docType === "Article OR Review") {
    wosFilters.push("DT=(ARTICLE OR REVIEW)");
  } else if (docType === "Article OR Conference Paper") {
    wosFilters.push("DT=(ARTICLE OR PROCEEDINGS PAPER)");
  }

  // Language
  if (language === "English") {
    wosFilters.push("LA=(ENGLISH)");
  } else if (language === "Malay") {
    wosFilters.push("LA=(MALAY)");
  } else if (language === "English OR Malay") {
    wosFilters.push("LA=(ENGLISH OR MALAY)");
  }

  /*
   * WoS subject categories are intentionally NOT converted
   * automatically from Scopus SUBJAREA codes.
   *
   * This prevents invalid WoS syntax.
   */
  const wosQuery =
    `${buildWebOfScienceQuery(
      keywords,
      yearFrom,
      yearTo,
      docType,
      language
    )}`;

  const commonFilters =
    `Years ${yearFrom}-${yearTo}, ${docType}, ${language}`;

  return [
    {
      database: "Scopus",
      query: scopusQuery,
      filters: `${commonFilters}${
        selectedSubjectAreas.length > 0
          ? `, Subject areas: ${selectedSubjectAreas.join(", ")}`
          : ", all subject areas"
      }, ${publicationStage}`,
    },
    {
      database: "Web of Science",
      query: wosQuery,
      filters: `${commonFilters}, ${publicationStage}`,
    },
  ];
}

function extractSearchStrategies(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["searchStrategies", "strategies", "results", "queries"]) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
  }
  return [];
}

export default function SearchStringsGenerator({
  protocol,
  onUpdateProtocol,
  aiConfig,
}: SearchStringsGeneratorProps) {
  // Initialize keywords from protocol
  const getInitialKeywords = (): KeywordItem[] => {
    const items: KeywordItem[] = [];
    const fw = protocol.formulationFramework || "PICO";

    if (fw === "PICOC" && protocol.objectivesPICOC) {
      if (protocol.objectivesPICOC.population) {
        items.push({ id: "init-1", term: protocol.objectivesPICOC.population, category: "Concept 1 (Population / Domain)", selected: true });
      }
      if (protocol.objectivesPICOC.intervention) {
        items.push({ id: "init-2", term: protocol.objectivesPICOC.intervention, category: "Concept 2 (Intervention / Technology)", selected: true });
      }
      if (protocol.objectivesPICOC.outcomes) {
        items.push({ id: "init-3", term: protocol.objectivesPICOC.outcomes, category: "Concept 3 (Outcome / Comparator)", selected: true });
      }
      if (protocol.objectivesPICOC.comparison) {
        items.push({ id: "init-4", term: protocol.objectivesPICOC.comparison, category: "Concept 3 (Outcome / Comparator)", selected: true });
      }
    } else if (fw === "PEO" && protocol.objectivesPEO) {
      if (protocol.objectivesPEO.population) {
        items.push({ id: "init-1", term: protocol.objectivesPEO.population, category: "Concept 1 (Population / Domain)", selected: true });
      }
      if (protocol.objectivesPEO.exposure) {
        items.push({ id: "init-2", term: protocol.objectivesPEO.exposure, category: "Concept 2 (Intervention / Technology)", selected: true });
      }
      if (protocol.objectivesPEO.outcomes) {
        items.push({ id: "init-3", term: protocol.objectivesPEO.outcomes, category: "Concept 3 (Outcome / Comparator)", selected: true });
      }
    } else if (fw === "SPIDER" && protocol.objectivesSPIDER) {
      if (protocol.objectivesSPIDER.sample) {
        items.push({ id: "init-1", term: protocol.objectivesSPIDER.sample, category: "Concept 1 (Population / Domain)", selected: true });
      }
      if (protocol.objectivesSPIDER.phenomenonOfInterest) {
        items.push({ id: "init-2", term: protocol.objectivesSPIDER.phenomenonOfInterest, category: "Concept 2 (Intervention / Technology)", selected: true });
      }
      if (protocol.objectivesSPIDER.evaluation) {
        items.push({ id: "init-3", term: protocol.objectivesSPIDER.evaluation, category: "Concept 3 (Outcome / Comparator)", selected: true });
      }
    } else {
      if (protocol.objectivesPICO.population) {
        items.push({ id: "init-1", term: protocol.objectivesPICO.population, category: "Concept 1 (Population / Domain)", selected: true });
      }
      if (protocol.objectivesPICO.intervention) {
        items.push({ id: "init-2", term: protocol.objectivesPICO.intervention, category: "Concept 2 (Intervention / Technology)", selected: true });
      }
      if (protocol.objectivesPICO.outcomes) {
        items.push({ id: "init-3", term: protocol.objectivesPICO.outcomes, category: "Concept 3 (Outcome / Comparator)", selected: true });
      }
    }

    if (protocol.title && items.length === 0) {
      const words = protocol.title
        .replace(/[:,\(\)\-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !["systematic", "literature", "review", "meta", "analysis", "evidence", "synthesis"].includes(w.toLowerCase()));
      words.slice(0, 4).forEach((w, idx) => {
        items.push({ id: `title-${idx}`, term: w, category: "General / Synonym", selected: true });
      });
    }

    if (items.length === 0) {
      return [
        { id: "def-1", term: "systematic review", category: "Concept 1 (Population / Domain)", selected: true },
        { id: "def-2", term: "empirical evaluation", category: "Concept 2 (Intervention / Technology)", selected: true },
        { id: "def-3", term: "reported outcomes", category: "Concept 3 (Outcome / Comparator)", selected: true },
      ];
    }

    return items;
  };

  const [keywords, setKeywords] = useState<KeywordItem[]>(getInitialKeywords);
  const [newKeywordTerm, setNewKeywordTerm] = useState("");
  const [newKeywordCategory, setNewKeywordCategory] = useState<KeywordItem["category"]>("Concept 1 (Population / Domain)");
  
  // Subject Area Filters (Scopus SUBJAREA & WoS WC/SU)
  const [selectedSubjectAreas, setSelectedSubjectAreas] = useState<string[]>([]);
  const [customSubjectArea, setCustomSubjectArea] = useState("");

  // Publication Stage (In Press vs Published Final)
  const [publicationStage, setPublicationStage] = useState<"all" | "final" | "inpress">("all");

  // Date & Language Filters
  const [yearFrom, setYearFrom] = useState(2019);
  const [yearTo, setYearTo] = useState(2026);
  const [docType, setDocType] = useState("Journal article");
  const [language, setLanguage] = useState("English");

  const [loadingKw, setLoadingKw] = useState(false);
  const [loadingStrings, setLoadingStrings] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [stringsMessage, setStringsMessage] = useState<{ type: "success" | "warning"; text: string } | null>(null);

  // Accepted (Active) Keywords
  const acceptedKeywords = useMemo(() => keywords.filter((k) => k.selected), [keywords]);

  const toggleKeyword = (id: string) => {
    setKeywords((prev) => prev.map((k) => (k.id === id ? { ...k, selected: !k.selected } : k)));
  };

  const deleteKeyword = (id: string) => {
    setKeywords((prev) => prev.filter((k) => k.id !== id));
  };

  const addCustomKeyword = () => {
    if (!newKeywordTerm.trim()) return;
    const item: KeywordItem = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      term: newKeywordTerm.trim(),
      category: newKeywordCategory,
      selected: true,
    };
    setKeywords((prev) => [...prev, item]);
    setNewKeywordTerm("");
  };

  const toggleSubjectArea = (code: string) => {
    setSelectedSubjectAreas((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const addCustomSubject = () => {
    if (!customSubjectArea.trim()) return;
    const formatted = customSubjectArea.trim();
    if (!selectedSubjectAreas.includes(formatted)) {
      setSelectedSubjectAreas((prev) => [...prev, formatted]);
    }
    setCustomSubjectArea("");
  };

  const handleSelectAllKeywords = (select: boolean) => {
    setKeywords((prev) => prev.map((k) => ({ ...k, selected: select })));
  };

  const handleSuggestKeywords = async () => {
    if (!protocol.title.trim()) return;
    setLoadingKw(true);
    try {
      const fw = protocol.formulationFramework || "PICO";
      let frameworkDesc = "";
      if (fw === "PICOC") {
        frameworkDesc = `Framework: PICOC (Engineering & Technology)
Population / Domain: "${protocol.objectivesPICOC?.population || protocol.objectivesPICO.population}"
Intervention / Technology: "${protocol.objectivesPICOC?.intervention || protocol.objectivesPICO.intervention}"
Comparison: "${protocol.objectivesPICOC?.comparison || protocol.objectivesPICO.comparator}"
Outcomes / Metrics: "${protocol.objectivesPICOC?.outcomes || protocol.objectivesPICO.outcomes}"
Context: "${protocol.objectivesPICOC?.context || ""}"`;
      } else if (fw === "PEO") {
        frameworkDesc = `Framework: PEO (Observational / Environmental / Exposure)
Population / Biota: "${protocol.objectivesPEO?.population || protocol.objectivesPICO.population}"
Exposure / Pollutant: "${protocol.objectivesPEO?.exposure || protocol.objectivesPICO.intervention}"
Outcomes: "${protocol.objectivesPEO?.outcomes || protocol.objectivesPICO.outcomes}"
Setting: "${protocol.objectivesPEO?.setting || ""}"`;
      } else if (fw === "SPIDER") {
        frameworkDesc = `Framework: SPIDER (Qualitative / Mixed-Methods)
Sample / Informants: "${protocol.objectivesSPIDER?.sample || protocol.objectivesPICO.population}"
Phenomenon of Interest: "${protocol.objectivesSPIDER?.phenomenonOfInterest || protocol.objectivesPICO.intervention}"
Design: "${protocol.objectivesSPIDER?.design || ""}"
Evaluation: "${protocol.objectivesSPIDER?.evaluation || protocol.objectivesPICO.outcomes}"`;
      } else {
        frameworkDesc = `Framework: PICO (Clinical / Health)
Population: "${protocol.objectivesPICO.population}"
Intervention: "${protocol.objectivesPICO.intervention}"
Comparator: "${protocol.objectivesPICO.comparator}"
Outcomes: "${protocol.objectivesPICO.outcomes}"`;
      }

      const prompt = `Systematic Review Title: "${protocol.title}"
Review Type: "${protocol.reviewType}"
${frameworkDesc}

Suggest 12-20 highly focused, specific academic search keywords, exact phrases, acronyms, and controlled vocabulary terms (MeSH, Emtree, IEEE Inspec, ACM Computing Classification) organized by concept facet. Do NOT suggest broad, generic terms that will yield excessive false-positive records (e.g., avoid plain words like "impact", "effect", "system").

Return ONLY a JSON array of objects with the exact structure:
[
  { "term": "keyword or phrase", "category": "Concept 1 (Population / Domain)" },
  { "term": "keyword or phrase", "category": "Concept 2 (Intervention / Technology)" },
  { "term": "keyword or phrase", "category": "Concept 3 (Outcome / Comparator)" },
  { "term": "MeSH or controlled term", "category": "MeSH & Controlled Vocabulary" },
  { "term": "synonym or variant", "category": "General / Synonym" }
]

Ensure categories match one of: "Concept 1 (Population / Domain)" | "Concept 2 (Intervention / Technology)" | "Concept 3 (Outcome / Comparator)" | "MeSH & Controlled Vocabulary" | "General / Synonym".
No preamble or extra commentary.`;

      const text = await callAI(prompt, "You are a senior research librarian and PRISMA 2020 search string engineer.", aiConfig);
      const parsed = parseJSONLoose(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const newItems: KeywordItem[] = parsed.map((item: any, idx: number) => ({
          id: `ai-kw-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          term: typeof item === "string" ? item : item.term || "keyword",
          category: (item.category as KeywordItem["category"]) || "General / Synonym",
          selected: true,
        }));
        setKeywords(newItems);
      }
    } catch (e) {
      console.error("Error generating keyword suggestions:", e);
    }
    setLoadingKw(false);
  };

  const handleGenerateStrings = async () => {
    if (acceptedKeywords.length === 0) {
      alert("Please select or add at least one accepted keyword before generating search strings.");
      return;
    }

    setLoadingStrings(true);
    setStringsMessage(null);
    try {
      const selectedTerms = acceptedKeywords.map((k) => `"${k.term}" (${k.category})`).join("; ");
      
      const subjectAreasDesc = selectedSubjectAreas.length > 0
        ? selectedSubjectAreas.join(", ")
        : "All Subject Areas / Unrestricted";

      const stageDesc =
        publicationStage === "final"
          ? "Final Published Articles Only (Exclude Articles in Press / Preprints)"
          : publicationStage === "inpress"
          ? "Articles in Press / Early Access Only"
          : "All Publication Stages (Both Final Published and Articles in Press / Early Access)";

      const prompt = `Systematic Review Title: "${protocol.title}"
Accepted Keywords for Search:
${selectedTerms}

Applied Search Parameters & Limits:
1. Subject Areas / Categories: ${subjectAreasDesc} (For Scopus, map to SUBJAREA codes like ${selectedSubjectAreas.map((s) => `SUBJAREA(${s})`).join(" OR ")}; For WoS, map to Research Areas / WC codes).
2. Publication Stage: ${stageDesc}
   - For Scopus: Use PUBSTAGE(final) for final published, PUBSTAGE(aip) for articles in press, or omit PUBSTAGE / include both for all stages.
   - For Web of Science: Use DT=(Article) or specify Early Access if in press.
   - For PubMed: Use publication status filters if applicable.
3. Year Limits: ${yearFrom} to ${yearTo} (Scopus: PUBYEAR > ${yearFrom - 1} AND PUBYEAR < ${yearTo + 1}; WoS: PY=(${yearFrom}-${yearTo}); PubMed: ${yearFrom}:${yearTo}[dp]).
4. Document Type: "${docType}"
5. Language: "${language}"

Construct reproducible database-specific Boolean search strings.

CRITICAL RULES:

Construct TWO reproducible, database-specific Boolean search strings ONLY:

1. Scopus
2. Web of Science Core Collection

Do NOT generate PubMed, IEEE Xplore, Google Scholar, ACM,
or any other database.

SEARCH SCOPE RULES:

- Use ONLY the accepted keywords supplied by the researcher.
- Do not introduce unrelated topics.
- Do not add external literature.
- Group synonyms belonging to the same concept using OR.
- Connect distinct concepts using AND.
- Preserve the meaning and scope of the review title.
- Avoid generic terms that create excessive irrelevant results.

MANDATORY SEARCH LIMITS:

Year:
${yearFrom}-${yearTo}

Language:
${language}

Document type:
${docType}

Publication stage:
${stageDesc}

Subject areas:
${subjectAreasDesc}

SCOPUS:

Use:
TITLE(...)

Apply:
PUBYEAR > ${yearFrom - 1}
PUBYEAR < ${yearTo + 1}

Apply document type using valid DOCTYPE codes.

Apply language using LANGUAGE(...).

Apply PUBSTAGE only when required.

Apply SUBJAREA only when subject areas are selected.

WEB OF SCIENCE:

Use:
TI=(...)

Apply:
PY=(${yearFrom}-${yearTo})

Apply document type using valid WoS DT values.

Apply:
LA=(...)

Do NOT use Scopus field codes in WoS.

Do NOT use TS= because LitMatrix is intentionally using title-focused
searching.

CRITICAL:

Every selected search limit must appear in the appropriate database
query unless that database does not support that filter syntax.

Return ONLY:

[
  {
    "database": "Scopus",
    "query": "...",
    "filters": "..."
  },
  {
    "database": "Web of Science",
    "query": "...",
    "filters": "..."
  }
]
      const text = await callAI(prompt, "You are a professional research librarian and Boolean search string engineer. Return syntactically valid JSON only.", aiConfig, 4000);
      const parsedStrategies = extractSearchStrategies(parseJSONLoose(text));
     const fallbackStrategies = buildFallbackSearchStrategies(
  keywords,
  selectedSubjectAreas,
  publicationStage,
  yearFrom,
  yearTo,
  docType,
  language,
);

const normalizedStrategies = fallbackStrategies.map((fallback) => {
  const match = parsedStrategies.find((strategy) => {
    const database =
      typeof strategy?.database === "string"
        ? strategy.database.toLowerCase()
        : "";

    return database.includes(fallback.database.toLowerCase()) ||
      (fallback.database === "Web of Science" &&
        (database.includes("wos") ||
         database.includes("web of science")));
  });

  if (!match) return fallback;

  return {
    database: fallback.database,
    query:
      typeof match.query === "string" && match.query.trim()
        ? match.query.trim()
        : fallback.query,
    filters:
      typeof match.filters === "string" && match.filters.trim()
        ? match.filters.trim()
        : fallback.filters,
 
        };
      });
      onUpdateProtocol({
        ...protocol,
        searchStrategies: normalizedStrategies,
      });
      setStringsMessage(
        parsedStrategies.length > 0
          ? { type: "success", text: "Database search strings generated and saved. Review or edit each query below." }
          : { type: "warning", text: "The AI response was not valid JSON, so reproducible fallback queries were generated from your accepted keywords." }
      );
    } catch (e) {
      console.error("Error generating search strings:", e);
      const fallbackStrategies = buildFallbackSearchStrategies(
        keywords,
        selectedSubjectAreas,
        publicationStage,
        yearFrom,
        yearTo,
        docType,
        language,
      );
      onUpdateProtocol({
        ...protocol,
        searchStrategies: fallbackStrategies,
      });
      setStringsMessage({
        type: "warning",
        text: `AI search-string generation failed, so reproducible fallback queries were generated. ${e instanceof Error ? e.message : "Try again or review the generated queries below."}`,
      });
    }
    setLoadingStrings(false);
  };

  const copyString = (db: string, query: string) => {
    navigator.clipboard.writeText(query);
    setCopiedKey(db);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleUpdateQueryText = (dbName: string, newQuery: string) => {
    onUpdateProtocol({
      ...protocol,
      searchStrategies: protocol.searchStrategies.map((s) =>
        s.database.toLowerCase() === dbName.toLowerCase() ? { ...s, query: newQuery } : s
      ),
    });
  };

  const updateSourceDate = (dbName: string, date: string) => {
    const existing = protocol.informationSources.find((s) => s.name.toLowerCase().includes(dbName.toLowerCase()));
    if (existing) {
      onUpdateProtocol({
        ...protocol,
        informationSources: protocol.informationSources.map((s) =>
          s.name.toLowerCase().includes(dbName.toLowerCase()) ? { ...s, lastSearchedDate: date } : s
        ),
      });
    } else {
      onUpdateProtocol({
        ...protocol,
        informationSources: [
          ...protocol.informationSources,
          { name: dbName, lastSearchedDate: date, urlOrHost: `${dbName.toLowerCase().replace(/\s+/g, "")}.com`, recordsRetrieved: 0 },
        ],
      });
    }
  };

  // Group keywords by category
  const categorizedKeywords = useMemo(() => {
    const groups: Record<KeywordItem["category"], KeywordItem[]> = {
      "Concept 1 (Population / Domain)": [],
      "Concept 2 (Intervention / Technology)": [],
      "Concept 3 (Outcome / Comparator)": [],
      "MeSH & Controlled Vocabulary": [],
      "General / Synonym": [],
    };
    keywords.forEach((k) => {
      if (groups[k.category]) {
        groups[k.category].push(k);
      } else {
        groups["General / Synonym"].push(k);
      }
    });
    return groups;
  }, [keywords]);

  return (
    <div id="search-strings-container" className="space-y-6">
      {/* Header & Main Configuration Box */}
      <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-xs space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] text-indigo-600 uppercase tracking-wider font-bold">
              PRISMA 2020 Items 6 & 7
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>Information Sources & Search Query Synthesizer</span>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700">
                {protocol.formulationFramework || "PICO"} Framework
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
  Develop focused, reproducible Boolean search strategies for
  Scopus and Web of Science using accepted keywords, publication
  year, language, document type, publication stage, and optional
  subject-area limits.
</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleSuggestKeywords}
              disabled={loadingKw || !protocol.title.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              {loadingKw ? "Suggesting Academic Keywords..." : "AI Suggest Keywords & Synonyms"}
            </button>
          </div>
        </div>

        {/* Section 1: Keywords Management with Category Clusters, Deletion & Addition */}
        <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-indigo-600" />
              <span className="font-mono text-xs font-bold text-slate-800 uppercase tracking-wider">
                Keyword Concepts & Synonyms ({acceptedKeywords.length} Accepted of {keywords.length} Total)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSelectAllKeywords(true)}
                className="text-[11px] font-mono text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
              >
                Accept All
              </button>
              <span className="text-slate-300">|</span>
              <button
                onClick={() => handleSelectAllKeywords(false)}
                className="text-[11px] font-mono text-slate-500 hover:text-slate-700 cursor-pointer"
              >
                Deselect All
              </button>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
            Click on any keyword tag to <strong>accept / include</strong> (indigo) or <strong>exclude</strong> (gray strikethrough). Click the <strong>×</strong> icon to permanently delete a keyword. The AI query synthesizer will build search strings strictly using accepted keywords.
          </p>

          {/* Grouped Keyword Badges */}
          <div className="space-y-3">
            {(Object.entries(categorizedKeywords) as [KeywordItem["category"], KeywordItem[]][]).map(([catName, items]) => {
              if (items.length === 0) return null;
              return (
                <div key={catName} className="space-y-1.5">
                  <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">
                    {catName} ({items.filter((i) => i.selected).length}/{items.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {items.map((k) => (
                      <div
                        key={k.id}
                        className={`group inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg border transition-all ${
                          k.selected
                            ? "bg-indigo-50 border-indigo-200 text-indigo-900 font-semibold shadow-2xs"
                            : "bg-white border-slate-200 text-slate-400 line-through"
                        }`}
                      >
                        <button
                          onClick={() => toggleKeyword(k.id)}
                          className="cursor-pointer text-left flex items-center gap-1"
                          title={k.selected ? "Click to exclude from search query" : "Click to include in search query"}
                        >
                          {k.selected ? (
                            <CheckCircle2 className="w-3 h-3 text-indigo-600 shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-slate-400 shrink-0" />
                          )}
                          <span>{k.term}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteKeyword(k.id);
                          }}
                          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-0.5 rounded transition-colors cursor-pointer"
                          title="Delete keyword"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Custom Keyword Input */}
          <div className="pt-2 border-t border-slate-200/80 flex flex-wrap sm:flex-nowrap gap-2 items-center">
            <select
  value={docType}
  onChange={(e) => setDocType(e.target.value)}
  className="w-full text-xs font-mono p-2 border border-slate-200 rounded-lg bg-white text-slate-800"
>
  <option value="Journal article">Journal Article</option>
  <option value="Review">Review</option>
  <option value="Article OR Review">Article + Review</option>
  <option value="Article OR Conference Paper">
    Article + Conference Paper
  </option>
  <option value="All">All Document Types</option>
</select>
<select
  value={language}
  onChange={(e) => setLanguage(e.target.value)}
  className="w-full text-xs font-mono p-2 border border-slate-200 rounded-lg bg-white text-slate-800"
>
  <option value="English">English</option>
  <option value="Malay">Malay</option>
  <option value="English OR Malay">English + Malay</option>
  <option value="All">All Languages</option>
</select>
            <input
              type="text"
              value={newKeywordTerm}
              onChange={(e) => setNewKeywordTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomKeyword()}
              placeholder="Add custom keyword, acronym, or MeSH term (press Enter)..."
              className="flex-1 text-xs font-mono p-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-800"
            />
            <button
              onClick={addCustomKeyword}
              className="flex items-center gap-1 px-3.5 py-2 text-xs font-mono font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg shadow-2xs cursor-pointer transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-600" />
              Add Keyword
            </button>
          </div>
        </div>

        {/* Section 2: Search Limits & Date Range */}
        <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="w-4 h-4 text-indigo-600" />
            <span className="font-mono text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Search Limits & Date Range (PRISMA 2020 Item 7)
            </span>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">Publication Year (From)</label>
              <input
                type="number"
                value={yearFrom}
                onChange={(e) => setYearFrom(parseInt(e.target.value) || 2019)}
                className="w-full text-xs font-mono p-2 border border-slate-200 rounded-lg bg-white text-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">Publication Year (To)</label>
              <input
                type="number"
                value={yearTo}
                onChange={(e) => setYearTo(parseInt(e.target.value) || 2026)}
                className="w-full text-xs font-mono p-2 border border-slate-200 rounded-lg bg-white text-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">Document Type</label>
              <input
                type="text"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                placeholder="e.g. Journal article"
                className="w-full text-xs font-mono p-2 border border-slate-200 rounded-lg bg-white text-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1">Language</label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g. English"
                className="w-full text-xs font-mono p-2 border border-slate-200 rounded-lg bg-white text-slate-800"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Subject Areas & Publication Stage */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Subject Area Selector */}
          <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-600" />
                <span className="font-mono text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Target Subject Areas (Scopus / WoS)
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-500 font-bold">
                {selectedSubjectAreas.length > 0 ? `${selectedSubjectAreas.length} selected` : "All Areas"}
              </span>
            </div>

            <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
              Restricts search results to relevant academic fields (e.g. Scopus <code className="text-indigo-600 font-mono">SUBJAREA(COMP)</code>).
            </p>

            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
              {DEFAULT_SUBJECT_AREAS.map((area) => {
                const isSelected = selectedSubjectAreas.includes(area.code);
                return (
                  <button
                    key={area.code}
                    onClick={() => toggleSubjectArea(area.code)}
                    className={`text-xs font-mono px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-indigo-600 border-indigo-700 text-white font-semibold shadow-2xs"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {area.name} ({area.code})
                  </button>
                );
              })}
            </div>

            {/* Custom Subject Area Input */}
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={customSubjectArea}
                onChange={(e) => setCustomSubjectArea(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomSubject()}
                placeholder="Custom subject code or category..."
                className="flex-1 text-xs font-mono p-1.5 border border-slate-200 rounded-lg bg-white text-slate-800"
              />
              <button
                onClick={addCustomSubject}
                className="px-2.5 py-1 text-xs font-mono text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Add Area
              </button>
            </div>
          </div>

          {/* Publication Stage Selector */}
          <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span className="font-mono text-xs font-bold text-slate-800 uppercase tracking-wider">
                Publication Stage Filter
              </span>
            </div>

            <p className="text-[11px] text-slate-500 font-sans leading-relaxed">
              Controls whether queries include peer-reviewed published articles, early access / in-press manuscripts, or both.
            </p>

            <div className="space-y-2">
              {[
                {
                  id: "all",
                  title: "All Stages (Final & In Press)",
                  desc: "Includes both final published articles and Articles in Press / Early Access.",
                  badge: "Standard",
                },
                {
                  id: "final",
                  title: "Final Published Only",
                  desc: "Restricts to published records (Scopus PUBSTAGE(final), WoS DT=Article).",
                  badge: "PUBSTAGE(final)",
                },
                {
                  id: "inpress",
                  title: "Articles in Press / Early Access Only",
                  desc: "Finds forthcoming / advance online publications (Scopus PUBSTAGE(aip)).",
                  badge: "PUBSTAGE(aip)",
                },
              ].map((st) => (
                <div
                  key={st.id}
                  onClick={() => setPublicationStage(st.id as any)}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                    publicationStage === st.id
                      ? "bg-indigo-50 border-indigo-600 ring-2 ring-indigo-500/20 shadow-2xs"
                      : "bg-white border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="publicationStage"
                        checked={publicationStage === st.id}
                        onChange={() => setPublicationStage(st.id as any)}
                        className="text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-900">{st.title}</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                      {st.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-sans mt-0.5 pl-5">{st.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section 4: Synthesis Trigger */}
        <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-mono text-slate-600">
              Generating queries with: <strong className="text-indigo-600">{acceptedKeywords.length} accepted keywords</strong>, <strong className="text-indigo-600">{selectedSubjectAreas.length} subject areas</strong>, stage: <strong className="text-indigo-600">{publicationStage}</strong>.
            </div>

            <button
              onClick={handleGenerateStrings}
              disabled={loadingStrings || acceptedKeywords.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-mono font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              {loadingStrings ? "Synthesizing Exact Boolean Queries..." : "Generate Database Search Strings (Item 7)"}
            </button>
          </div>
          {stringsMessage && (
            <div className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
              stringsMessage.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{stringsMessage.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Generated Search Strategies Section */}
      {protocol.searchStrategies.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Code2 className="w-4 h-4 text-indigo-600" />
             Scopus & Web of Science Search Strategies ({protocol.searchStrategies.length})
            </h3>
            <span className="text-xs font-mono text-slate-500">
               PRISMA 2020 Item 7 compliant
            </span>
          </div>

          {protocol.searchStrategies.map((strat) => {
            const sourceInfo = protocol.informationSources.find((s) =>
              s.name.toLowerCase().includes(strat.database.toLowerCase())
            );
            const lastDate = sourceInfo?.lastSearchedDate || "2026-08-20";

            return (
              <div
                key={strat.database}
                className="bg-white border border-slate-200 p-5 rounded-xl shadow-xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <Database className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-mono text-xs font-bold text-slate-900 uppercase">
                      {strat.database}
                    </span>
                    <span className="text-[10px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                      {strat.filters}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>Last searched:</span>
                      <input
                        type="date"
                        value={lastDate}
                        onChange={(e) => updateSourceDate(strat.database, e.target.value)}
                        className="p-1 text-[11px] font-mono border border-slate-200 rounded-md bg-white text-slate-700"
                      />
                    </div>

                    <button
                      onClick={() => copyString(strat.database, strat.query)}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    >
                      {copiedKey === strat.database ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-semibold">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-500" />
                          <span>Copy String</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Editable Code Textarea */}
                <div className="relative">
                  <textarea
                    value={strat.query}
                    onChange={(e) => handleUpdateQueryText(strat.database, e.target.value)}
                    rows={4}
                    className="w-full p-3.5 bg-slate-900 text-slate-100 font-mono text-xs rounded-lg whitespace-pre-wrap leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 selection:bg-indigo-600 border border-slate-800"
                  />
                  <span className="absolute bottom-2.5 right-2.5 text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded pointer-events-none">
                    Editable syntax
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
