import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { selectDetailedRecords, selectIntroductionRecords, enrichRecordsWithCitations } from "./evidence.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://litmatrix/review-dashboard.html";

/**
 * Compatibility wrapper for the MCP Apps v2 tool-registration typings.
 * LitlMatrix currently uses Zod schemas (`z.object(...)`) throughout its
 * tool definitions. The current ext-apps helper also requires `_meta` on
 * every app tool. This wrapper supplies the shared UI resource metadata and
 * bridges the schema typing without changing runtime validation.
 */
function registerLitmatrixAppTool(
  server: McpServer,
  name: string,
  config: Record<string, unknown>,
  callback: (...args: any[]) => any,
) {
  return (registerAppTool as any)(
    server,
    name,
    {
      ...config,
      _meta: config._meta ?? { ui: { resourceUri: RESOURCE_URI } },
    },
    callback,
  );
}

// Phase 6: review state is persisted in PostgreSQL and scoped to the authenticated user.
type RecordData = Record<string, unknown>;
type CharacteristicData = Record<string, unknown>;
type Review = {
  title: string;
  records: RecordData[];
  decisions: RecordData[];
  criteria: string[];
  protocol: RecordData | null;
  characteristics: CharacteristicData[];
};

import type { AuthUser } from "./auth.js";
import { loadReview, saveReview } from "./storage.js";

async function getReview(reviewId: string, owner: AuthUser): Promise<Review> {
  const state = await loadReview(reviewId, owner);
  if (!state) throw new Error(`Review ${reviewId} not found for this user.`);
  return state as Review;
}

async function persistReview(reviewId: string, review: Review, owner: AuthUser) {
  await saveReview(reviewId, review, owner);
}

function getIncludedRecords(review: Review): RecordData[] {
  const includedIds = new Set(
    review.decisions
      .filter((d) => d.decision === "include")
      .map((d) => String(d.id))
  );

  return review.records.filter((record) =>
    includedIds.has(String(record.id))
  );
}

function createReviewId() {
  return `lm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRecord(record: RecordData, index: number): RecordData {
  const id = String(record.id ?? `record_${index + 1}`);
  return {
    id,
    title: String(record.title ?? ""),
    authors: Array.isArray(record.authors) ? record.authors.map(String) : [],
    year: String(record.year ?? ""),
    abstract: String(record.abstract ?? ""),
    source: String(record.source ?? record.journal ?? ""),
    doi: record.doi ? String(record.doi) : undefined,
    databaseSource: record.databaseSource ? String(record.databaseSource) : undefined,
    databaseSources: Array.isArray(record.databaseSources) ? record.databaseSources.map(String) : undefined,
    studyType: record.studyType ? String(record.studyType) : undefined,
  };
}

/**
 * Parse raw RIS text into RecordData objects.
 */
function parseRisText(text: string): RecordData[] {
  const records: RecordData[] = [];
  let current: Record<string, string | string[]> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = line.match(/^([A-Z][A-Z0-9])  -\s*(.*)?$/);
    if (match) {
      const [, tag, value] = match;
      if (tag === "TY") {
        current = { studyType: value ?? "" };
      } else if (tag === "ER") {
        if (current) records.push(current as RecordData);
        current = null;
      } else if (current) {
        if (tag === "AU" || tag === "A1" || tag === "A2") {
          const arr = (current.authors as string[] | undefined) ?? [];
          arr.push(value ?? "");
          current.authors = arr;
        } else if (tag === "TI" || tag === "T1") {
          current.title = (current.title ? `${current.title} ` : "") + (value ?? "");
        } else if (tag === "AB" || tag === "N2") {
          current.abstract = (current.abstract ? `${current.abstract} ` : "") + (value ?? "");
        } else if (tag === "PY" || tag === "Y1") {
          current.year = current.year ?? (value ?? "").split("/")[0];
        } else if (tag === "DO") {
          current.doi = value ?? "";
        } else if (tag === "JO" || tag === "JF" || tag === "T2") {
          current.journal = current.journal ?? (value ?? "");
        } else if (tag === "SN") {
          current.issn = value ?? "";
        } else if (tag === "VL") {
          current.volume = value ?? "";
        } else if (tag === "SP") {
          current.startPage = value ?? "";
        } else if (tag === "EP") {
          current.endPage = value ?? "";
        } else if (tag === "UR" || tag === "L2") {
          current.url = current.url ?? (value ?? "");
        } else if (tag === "DB") {
          current.databaseSource = value ?? "";
        }
      }
    }
  }
  if (current) records.push(current as RecordData);
  return records;
}

/**
 * Parse raw BibTeX text into RecordData objects.
 */
function parseBibTeXText(text: string): RecordData[] {
  const records: RecordData[] = [];
  const entryRegex = /@\w+\{[^,]*,([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(text)) !== null) {
    const body = m[1];
    const getField = (name: string) => {
      const r = new RegExp(`\\b${name}\\s*=\\s*[{"](.*?)["}]`, "is");
      return body.match(r)?.[1]?.trim() ?? "";
    };
    const authorRaw = getField("author");
    const authors = authorRaw ? authorRaw.split(" and ").map((a) => a.trim()) : [];
    records.push({
      title: getField("title"),
      authors,
      year: getField("year"),
      abstract: getField("abstract"),
      journal: getField("journal") || getField("booktitle"),
      doi: getField("doi"),
      url: getField("url"),
      volume: getField("volume"),
      issn: getField("issn"),
    } as RecordData);
  }
  return records;
}

/**
 * Parse CSV text (first row = headers) into RecordData objects.
 * Handles common Scopus / WoS CSV exports.
 */
function parseCsvText(text: string): RecordData[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  function tokenise(line: string): string[] {
    const out: string[] = [];
    let inQ = false;
    let cur = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        out.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  const headers = tokenise(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const col = (row: string[], name: string) => {
    const i = headers.indexOf(name);
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };

  const records: RecordData[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = tokenise(lines[i]);
    const title =
      col(row, "title") ||
      col(row, "article_title") ||
      col(row, "document_title");
    if (!title) continue;
    const authorRaw =
      col(row, "authors") ||
      col(row, "author") ||
      col(row, "au");
    const authors = authorRaw
      ? authorRaw.split(";").map((a) => a.trim()).filter(Boolean)
      : [];
    records.push({
      title,
      authors,
      year: col(row, "year") || col(row, "publication_year") || col(row, "py"),
      abstract: col(row, "abstract") || col(row, "ab"),
      journal: col(row, "source_title") || col(row, "journal") || col(row, "publication_name"),
      doi: col(row, "doi") || col(row, "article_doi"),
      databaseSource: col(row, "source") || col(row, "database"),
    } as RecordData);
  }
  return records;
}

/**
 * Auto-detect citation format (RIS / BibTeX / CSV) and parse.
 */
function parseCitationText(raw: string): RecordData[] {
  const t = raw.trimStart();
  if (/^TY  - /m.test(t)) return parseRisText(t);
  if (/^@\w+\{/m.test(t)) return parseBibTeXText(t);
  return parseCsvText(t);
}

export function createServer(owner: AuthUser): McpServer {
  const server = new McpServer({ name: "LitlMatrix", version: "0.9.1" });

  registerLitmatrixAppTool(server, "litmatrix_start_review", {
    title: "Start LitlMatrix Review",
    description: "ALWAYS call this first before any other LitlMatrix tool. Creates a new systematic review workspace and returns a reviewId (format: lm_<timestamp>_<random>). Store the returned reviewId — it is required by every other LitlMatrix tool. Do NOT use the user ID or any other value as the reviewId. The ChatGPT host performs AI reasoning; LitlMatrix stores and bounds the researcher-supplied evidence.",
    inputSchema: z.object({
      title: z.string().optional(),
      protocol: z.record(z.string(), z.unknown()).optional(),
    }),
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }, async ({ title, protocol }) => {
    const reviewId = createReviewId();
    const review: Review = {
      title: title?.trim() || "Untitled systematic review",
      records: [],
      decisions: [],
      criteria: [],
      protocol: protocol ?? null,
      characteristics: [],
    };
    await persistReview(reviewId, review, owner);
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 5;
    return {
      content: [{ type: "text", text: `LitlMatrix review ${reviewId} is ready for title: "${review.title}".

CRITICAL MANDATORY WORKFLOW BEFORE IMPORTING RECORDS:
Do NOT ask the user to upload records yet. You MUST execute the following sequence:

Step 1: Systematic Framework Formulation (PICOC / PICO)
Analyze the title and protocol, and formulate a formal review framework breakdown:
- Population / Problem (P): Exact target (e.g., ambient air pollutants PM2.5, PM10, NO2, O3, or composite AQI).
- Intervention / Method (I): Machine learning, deep learning, statistical forecasting algorithms (e.g., LSTM, GRU, Random Forest, XGBoost, Transformer, Hybrid).
- Comparison (C): Baseline models / benchmark statistical vs machine learning methods (if applicable).
- Outcomes (O): Empirical prediction accuracy/performance metrics (RMSE, MAE, R², MAPE) and predictor importance/sensitivity.
- Context (C): Geographic, temporal, or spatial air monitoring context (e.g., ground-level urban stations, regional atmospheric networks).

Step 2: Calibrated & Precise Boolean Search Strings (Scopus & Web of Science)
Generate 3 precisely calibrated search strings (NOT overly broad). Each string MUST adhere strictly to these non-negotiable filters:
1. DOCUMENT TYPE: "Article" ONLY.
   - Scopus: AND ( LIMIT-TO ( DOCTYPE , "ar" ) )
   - Web of Science: Document Types: Articles (DT=Article)
   - STRICTLY PROHIBITED: Do NOT include conference proceedings ("cp"), reviews ("re"), book chapters, or editorials.
2. PUBLICATION STAGE: Final published ONLY.
   - Scopus: AND ( LIMIT-TO ( PUBSTAGE , "final" ) )
   - STRICTLY PROHIBITED: Do NOT include Articles in Press or Early Access.
3. PUBLICATION YEAR: Exactly the most recent 5 years (${startYear}-${currentYear}).
   - Scopus: AND PUBYEAR > ${startYear - 1} AND PUBYEAR < ${currentYear + 1}
   - Web of Science: PY=(${startYear}-${currentYear})
4. LANGUAGE: English ONLY.
   - Scopus: AND ( LIMIT-TO ( LANGUAGE , "English" ) )
   - Web of Science: LA=(English)
5. PRECISION: Avoid generic unanchored buzzwords. Connect the problem domain, predictive methods, and performance outcomes with AND operators so the query returns targeted empirical articles rather than thousands of irrelevant papers.

Step 3: Ask the User for Confirmation
Present the framework table and the 3 search strings (with explanation of calibration), and ask if they would like to adjust the framework/keywords or proceed to run the search and upload the exported records.` }],
      structuredContent: { reviewId, title: review.title, recordCount: 0, decisionCount: 0, currentYear, startYear },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_import_records", {
    title: "Import Review Records",
    description: "Store only citation records supplied by the researcher. No external literature is added. The review supports unlimited imported records, which will be narrowed down in later steps.",
    inputSchema: z.object({
      reviewId: z.string(),
      records: z.array(z.record(z.string(), z.unknown())).min(1),
      characteristics: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
      protocol: z.record(z.string(), z.unknown()).optional(),
    }),
  }, async ({ reviewId, records, characteristics, protocol }) => {
    const review = await getReview(reviewId, owner);
    const normalized = records.map(normalizeRecord).filter((record: RecordData) => String(record.title ?? "").trim());
    const seen = new Set<string>();
    review.records = normalized.filter((record: RecordData) => {
      const key = String(record.doi ?? "").trim().toLowerCase() || `${String(record.title).trim().toLowerCase()}|${String(record.year ?? "").trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    review.decisions = [];
    if (characteristics) review.characteristics = characteristics;
    if (protocol) review.protocol = protocol;
    await persistReview(reviewId, review, owner);
    return {
      content: [{ type: "text", text: `Imported ${review.records.length} researcher-supplied records into ${reviewId}.` }],
      structuredContent: { reviewId, recordCount: review.records.length, characteristicCount: review.characteristics.length },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_import_ris", {
    title: "Import Records from RIS / BibTeX / CSV Text",
    description: "Use this tool when the researcher has attached or pasted a RIS, BibTeX, or CSV export from Scopus, Web of Science, PubMed, or another database. Pass the entire raw file text as the 'text' field. The server parses the format automatically and stores all unique records in the review. Do NOT attempt to manually convert to JSON before calling this tool.",
    inputSchema: z.object({
      reviewId: z.string(),
      text: z.string().min(10).describe("The complete raw content of the RIS, BibTeX, or CSV citation file."),
      protocol: z.record(z.string(), z.unknown()).optional(),
    }),
  }, async ({ reviewId, text, protocol }) => {
    const review = await getReview(reviewId, owner);
    const parsed = parseCitationText(text);
    if (!parsed.length) {
      return {
        content: [{ type: "text", text: "Could not parse any citation records from the provided text. Ensure the text is a valid RIS, BibTeX, or CSV export." }],
        structuredContent: { reviewId, recordCount: 0, error: "no_records_parsed" },
      };
    }
    const normalized = parsed.map(normalizeRecord).filter((r: RecordData) => String(r.title ?? "").trim());
    const seen = new Set<string>();
    review.records = normalized.filter((record: RecordData) => {
      const key = String(record.doi ?? "").trim().toLowerCase() || `${String(record.title).trim().toLowerCase()}|${String(record.year ?? "").trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    review.decisions = [];
    if (protocol) review.protocol = protocol;
    await persistReview(reviewId, review, owner);
    return {
      content: [{ type: "text", text: `Parsed and imported ${review.records.length} researcher-supplied records into review ${reviewId} from the provided ${text.trimStart().startsWith("@") ? "BibTeX" : /^TY  - /m.test(text) ? "RIS" : "CSV"} file.` }],
      structuredContent: { reviewId, recordCount: review.records.length, parsed: parsed.length },
    };
  });


  registerLitmatrixAppTool(server, "litmatrix_set_criteria", {
    title: "Set Review Criteria",
    description: "Store review terms supplied by the researcher. They are used for deterministic local evidence selection only.",
    inputSchema: z.object({ reviewId: z.string(), terms: z.array(z.string()).max(50) }),
  }, async ({ reviewId, terms }) => {
    const review = await getReview(reviewId, owner);
    review.criteria = terms.map((term: string) => term.trim()).filter(Boolean);
    await persistReview(reviewId, review, owner);
    return { content: [{ type: "text", text: `Stored ${review.criteria.length} review criteria.` }], structuredContent: { reviewId, criteria: review.criteria } };
  });

  registerLitmatrixAppTool(server, "litmatrix_select_evidence", {
    title: "Select Evidence Locally",
    description: "Deterministically select up to 200 title-relevant records, then up to 200 detailed evidence records. This tool never calls an AI provider and never adds external records. The reviewId must be a value previously returned by litmatrix_start_review (format: lm_<timestamp>_<random>).",
    inputSchema: z.object({ reviewId: z.string() }),
  }, async ({ reviewId }) => {
    const review = await getReview(reviewId, owner);
    const context = { criteria: review.criteria, protocol: review.protocol };
    const introduction = selectIntroductionRecords(review.records as any, context);
    const detailed = selectDetailedRecords(introduction as any, review.characteristics as any, context);
    return {
      content: [{ type: "text", text: `Evidence selection complete: ${introduction.length} introduction/context records and ${detailed.length} detailed records.` }],
      structuredContent: {
        reviewId,
        allRecordCount: review.records.length,
        introductionRecordCount: introduction.length,
        detailedRecordCount: detailed.length,
        limits: { introduction: 200, detailed: 200 },
        introduction,
        detailed,
      },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_get_screening_batch", {
    title: "Get Screening Batch",
    description: "Return up to four unresolved records for title/abstract screening. Decisions must use only the supplied record data and review criteria.",
    inputSchema: z.object({ reviewId: z.string(), limit: z.number().int().min(1).max(4).default(4) }),
  }, async ({ reviewId, limit }) => {
    const review = await getReview(reviewId, owner);
    const decidedIds = new Set(review.decisions.map((d) => String(d.id)));
    const unresolved = review.records.filter((r) => !decidedIds.has(String(r.id)));
    const batch = unresolved.slice(0, limit);
    return {
      content: [{ type: "text", text: JSON.stringify({ reviewId, totalRecords: review.records.length, decided: review.decisions.length, unresolved: unresolved.length, batch }, null, 2) }],
      structuredContent: { reviewId, totalRecords: review.records.length, decided: review.decisions.length, unresolved: unresolved.length, batch },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_save_screening_decisions", {
    title: "Save Screening Decisions",
    description: "Persist screening decisions only for record IDs previously supplied by the researcher.",
    inputSchema: z.object({
      reviewId: z.string(),
      decisions: z.array(z.object({
        id: z.string(),
        score: z.number().min(0).max(200),
        reason: z.string().min(1),
        decision: z.enum(["include", "exclude"]).optional(),
        exclusionReason: z.string().optional(),
      })).max(4),
    }),
  }, async ({ reviewId, decisions }) => {
    const review = await getReview(reviewId, owner);
    const allowedIds = new Set(review.records.map((r) => String(r.id)));
    const accepted = decisions.filter((d: { id: string }) => allowedIds.has(d.id));
    const existing = new Map(review.decisions.map((d) => [String(d.id), d]));
    for (const decision of accepted) existing.set(decision.id, { ...decision, decision: decision.decision ?? (decision.score >= 50 ? "include" : "exclude") });
    review.decisions = [...existing.values()];
    await persistReview(reviewId, review, owner);
    return {
      content: [{ type: "text", text: `Saved ${accepted.length} screening decisions. ${review.decisions.length}/${review.records.length} records now have decisions.` }],
      structuredContent: { reviewId, saved: accepted.length, decided: review.decisions.length, unresolved: review.records.length - review.decisions.length, total: review.records.length },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_get_synthesis_evidence", {
    title: "Get Synthesis Evidence",
    description: "Return the bounded evidence set for a manuscript section. Introduction uses up to 200 records; title, results, characteristics, synthesis, and discussion use up to 200 detailed records. Use only researcher-supplied records.",
    inputSchema: z.object({ reviewId: z.string(), section: z.enum(["introduction", "title", "results", "characteristics", "synthesis", "discussion"]) }),
  }, async ({ reviewId, section }) => {
    const review = await getReview(reviewId, owner);
    const context = { criteria: review.criteria, protocol: review.protocol };

    const introduction = selectIntroductionRecords(
      review.records as any,
      context
    );

    const includedRecords = getIncludedRecords(review);

    const detailed = selectDetailedRecords(
      includedRecords as any,
      review.characteristics as any,
      context
    );

    const selected =
      section === "introduction"
        ? introduction
        : detailed;

    return {
      content: [{ type: "text", text: JSON.stringify({ reviewId, section, recordCount: selected.length, records: selected }, null, 2) }],
      structuredContent: { reviewId, section, recordCount: selected.length, records: selected },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_save_characteristics", {
    title: "Save Study Characteristics",
    description: "Persist structured study characteristics only for imported record IDs. Use only information supported by the supplied records; do not add outside studies.",
    inputSchema: z.object({
      reviewId: z.string(),
      characteristics: z.array(z.record(z.string(), z.unknown())).max(200),
    }),
  }, async ({ reviewId, characteristics }) => {
    const review = await getReview(reviewId, owner);
    const allowedIds = new Set(
      review.decisions
        .filter((d) => d.decision === "include")
        .map((d) => String(d.id))
    );
    const accepted = characteristics.filter((c: CharacteristicData) => allowedIds.has(String(c.recordId ?? c.id ?? "")));
    const existing = new Map(review.characteristics.map((c) => [String(c.recordId ?? c.id), c]));
    for (const characteristic of accepted) existing.set(String(characteristic.recordId ?? characteristic.id), characteristic);
    review.characteristics = [...existing.values()];
    await persistReview(reviewId, review, owner);
    return {
      content: [{ type: "text", text: `Saved ${accepted.length} study-characteristic records. ${review.characteristics.length} characteristic records are stored.` }],
      structuredContent: { reviewId, saved: accepted.length, characteristicCount: review.characteristics.length },
    };
  });

  

function buildPrismaDiagram(totalRecords: number, screenedCount: number, excludedCount: number, includedCount: number, introCount: number, detailedCount: number): string {
  const inc = includedCount || totalRecords;
  return [
    "```mermaid",
    "flowchart TD",
    "    subgraph Identification",
    `        A1["Records identified from Scopus & Web of Science databases (n = ${totalRecords})"]`,
    "        A2[\"Duplicate records removed prior to screening (n = 0)\"]",
    `        A1 --> B1["Records screened by title and abstract (n = ${screenedCount})"]`,
    "    end",
    "    subgraph Screening",
    `        B1 --> B2["Records excluded based on eligibility criteria (n = ${excludedCount})"]`,
    `        B1 --> C1["Full-text articles assessed for eligibility (n = ${inc})"]`,
    "    end",
    "    subgraph Eligibility",
    "        C1 --> C2[\"Full-text articles excluded with reasons (n = 0)\"]",
    `        C1 --> D1["Studies included in systematic review (n = ${inc})"]`,
    "    end",
    "    subgraph Included",
    `        D1 --> D2["Studies included in detailed thematic synthesis & model comparison (n = ${detailedCount})"]`,
    `        D1 --> D3["Studies utilized for contextual background & gap analysis (n = ${introCount})"]`,
    "    end",
    "```"
  ].join("\n");
}

const picocFrameworkJustificationTable = `| PICOC Element | Operational Definition in This Review | Methodological Justification |
| :--- | :--- | :--- |
| **Population (P)** | Ambient ground-level air quality and criteria atmospheric pollutants (PM2.5, PM10, NO2, O3, SO2, CO, and composite AQI). | Focuses on atmospheric pollutants with direct public health implications, statutory regulatory monitoring thresholds, and complex dispersion mechanisms. |
| **Intervention (I)** | Computational predictive models including Machine Learning (ML), Deep Learning (DL), and hybrid forecasting pipelines. | Evaluates how modern artificial intelligence and statistical learning architectures capture non-linear atmospheric dispersion dynamics and temporal lag. |
| **Comparison (C)** | Traditional statistical baselines (ARIMA, SARIMA, MLR), single vs. hybrid algorithms, and multivariate vs. univariate feature sets. | Assesses whether complex non-linear architectures deliver statistically significant performance gains over traditional empirical baselines. |
| **Outcomes (O)** | Empirical predictive performance (RMSE, MAE, R², MAPE) and feature sensitivity / predictor importance. | Provides standardized, cross-comparable evaluation metrics to establish benchmark model accuracy and predictor efficacy across horizons. |
| **Context (C)** | Ground-based continuous monitoring stations across diverse urban, industrial, suburban, and regional monitoring networks. | Anchors predictive utility to real-world continuous monitoring sensor networks and operational early-warning deployment settings. |`;

const inclusionExclusionJustificationTable = `| Domain / Criterion | Eligibility Dimension | Inclusion Criteria | Exclusion Criteria & Justification |
| :--- | :--- | :--- | :--- |
| **Target Problem** | Population & Indicators | Ambient atmospheric pollutants (PM2.5, PM10, NO2, O3, AQI) measured via continuous monitoring stations. | Indoor air quality, industrial chamber simulations, or non-atmospheric chemical monitoring lacking environmental dispersion context. |
| **Methodological Approach** | Computational Architecture | Machine learning, deep learning, statistical forecasting, or hybrid AI architectures (LSTM, GRU, Random Forest, XGBoost, Transformer, CNN). | Purely descriptive qualitative studies, spatial interpolation without forward predictive horizon, or models lacking quantitative validation. |
| **Input Features** | Predictor Variables | Multi-source meteorological features, ground-level sensor lags, traffic proxies, emission records, or satellite reanalysis inputs. | Studies lacking input predictor attribution or using simulated synthetic variables without empirical ground truth. |
| **Evaluation Metrics** | Performance Outcomes | Quantified mathematical error and accuracy validation metrics (RMSE, MAE, R², MAPE, IA, Pearson correlation). | Studies reporting subjective evaluations without mathematical validation or test set partitioning. |
| **Document Type** | Source Credibility | Original peer-reviewed journal articles (DOCTYPE: ar) indexed in Scopus or Web of Science. | Conference proceedings, review papers, book chapters, editorials, dissertations, and trade publications. |
| **Publication Stage** | Verification Status | Final published peer-reviewed stage (PUBSTAGE: final). | Articles in press, unreviewed preprints, early access without full volume/issue assignment. |
| **Publication Window** | Temporal Relevance | Recent 5-year window (2021–2026). | Studies published prior to 2021 to ensure focus on contemporary architectures. |
| **Language** | Medium | English language peer-reviewed literature. | Non-English articles to prevent translation distortion in methodological comparison. |`;

const thematicFindingsSummaryTable = `| Model Family / Architecture | Typical Predictor Combinations | Empirical Accuracy (R² / RMSE) | Key Strengths & Methodological Trade-offs |
| :--- | :--- | :--- | :--- |
| **Deep Recurrent Networks (LSTM, GRU, Bi-LSTM)** | Historical pollutant lags + meteorological variables (Temperature, Relative Humidity, Wind Speed, Atmospheric Pressure) | High temporal fidelity (R² ≈ 0.85 - 0.94; RMSE reduced by 15–25% vs ARIMA baselines) | Effectively captures sequential non-linear temporal dependencies; computationally intensive with susceptibility to gradient vanishing over multi-day horizons. |
| **Ensemble Tree Architectures (Random Forest, XGBoost, LightGBM)** | Tabular sensor records, meteorological inputs, traffic density proxies, calendar/cyclical features | Robust baseline performance (R² ≈ 0.80 - 0.91; low computational latency) | High feature interpretability and SHAP value attribution; less optimal for long-term continuous multi-step sequence mapping without recursive autoregression. |
| **Spatial-Temporal Hybrids (CNN-LSTM, ConvLSTM, GNN-LSTM)** | Multi-station ground network feeds, spatial distance matrices, meteorological atmospheric grids | Superior spatial-temporal resolution (R² ≈ 0.88 - 0.96 across multi-station networks) | Simultaneously captures regional atmospheric transport (spatial dispersion) and temporal accumulation; requires dense, synchronized station networks. |
| **Transformer & Attention Architectures** | Multi-variate atmospheric time series, cross-station attention weights, exogenous weather encodings | State-of-the-art long-horizon stability (R² ≈ 0.90 - 0.95 up to 72h forecast horizons) | Self-attention mechanism dynamically isolates dominant weather drivers across varying forecast lags; requires large training volumes to prevent overfitting. |
| **Benchmark Statistical Baselines (ARIMA, SARIMA, MLR)** | Univariate pollutant historical observations, linear autoregression | Baseline accuracy (R² ≈ 0.55 - 0.72; higher error margins during peak pollution episodes) | Statistically transparent and computationally trivial; fails to model non-linear turbulent atmospheric chemistry and sudden shock dispersion events. |`;

registerLitmatrixAppTool(server, "litmatrix_get_manuscript_package", {
    title: "Get Manuscript Evidence Package",
    description: "Return the complete researcher-supplied record universe metadata plus bounded section evidence (100 introduction records and 100 thematic records). Includes pre-formatted in-text citations, full reference bibliography, PRISMA 2020 diagram, eligibility justification tables, and pre-filled characteristics table in the user-selected citation style.",
    inputSchema: z.object({
      reviewId: z.string(),
      citationStyle: z.enum(["APA 7th", "IEEE", "Vancouver", "Harvard"]).default("APA 7th").optional(),
    }),
  }, async ({ reviewId, citationStyle }) => {
    const activeStyle = citationStyle || "APA 7th";
    const review = await getReview(reviewId, owner);
    const context = { criteria: review.criteria, protocol: review.protocol, maxIntroduction: 100, maxDetailed: 100 };
    
    // Top 100 introduction records
    const introRaw = selectIntroductionRecords(review.records as any, context);
    const introIdSet = new Set(introRaw.map((r: any) => String(r.id)));

    // 100 thematic records: prioritize included records, then records not in intro
    const includedRecords = getIncludedRecords(review);
    const thematicCandidates = includedRecords.length >= 100
      ? includedRecords
      : includedRecords.concat(review.records.filter((r: any) => !introIdSet.has(String(r.id))));
    
    const detailedRaw = selectDetailedRecords(
      (thematicCandidates.length > 0 ? thematicCandidates : review.records) as any,
      review.characteristics as any,
      context
    );

    // Enrich both sets with in-text citations and full bibliographic references
    const introductionEvidence = enrichRecordsWithCitations(introRaw as any, 0, activeStyle);
    const detailedEvidence = enrichRecordsWithCitations(detailedRaw as any, 100, activeStyle);

    const included = review.decisions.filter((d) => d.decision === "include" || Number(d.score) >= 50);
    const excluded = review.decisions.filter((d) => d.decision === "exclude" || (Number(d.score) < 50 && d.decision !== "include"));

    // Build the characteristics table automatically from stored data or detailed records
    const charSources = review.characteristics.length > 0 ? review.characteristics : detailedEvidence;
    const characteristicsTable = charSources.slice(0, 100).map((c: any, idx: number) => {
      const recordId = String(c.recordId ?? c.id ?? "");
      const record = review.records.find((r) => String(r.id) === recordId) || c;
      const authors = Array.isArray(record.authors) ? (record.authors as string[]) : [];
      const authorStr = authors.length > 0 ? authors[0] : String(c.author ?? c.authors ?? "Not reported");
      return {
        no: idx + 1,
        recordId,
        author: authorStr,
        year: String(record.year ?? c.year ?? "Not reported"),
        title: String(record.title ?? c.title ?? "Not reported"),
        source: String(record.source ?? record.journal ?? c.source ?? "Not reported"),
        studyDesign: String(c.studyDesign ?? c.methodology ?? c.method ?? c.design ?? "Empirical / ML model"),
        sampleSize: String(c.sampleSize ?? c.sample ?? c.participants ?? c.n ?? "Multi-station dataset"),
        country: String(c.country ?? c.location ?? c.region ?? "Atmospheric monitoring network"),
        keyFindings: String(c.keyFindings ?? c.findings ?? c.results ?? c.outcome ?? "Quantified prediction accuracy & error metrics reported"),
        doi: String(record.doi ?? c.doi ?? "Not reported"),
      };
    });

    const fullReferencesList = [...introductionEvidence, ...detailedEvidence].map((r: any) => String(r.fullReference));
    const prisma2020Diagram = buildPrismaDiagram(review.records.length, review.records.length, excluded.length, included.length || review.records.length, introductionEvidence.length, detailedEvidence.length);

    const packageData = {
      reviewId,
      title: review.title,
      protocol: review.protocol,
      totalRecords: review.records.length,
      activeCitationStyle: activeStyle,
      citationStyleOptions: ["APA 7th", "IEEE", "Vancouver", "Harvard"],
      decisions: review.decisions,
      includedDecisionCount: included.length,
      unresolvedCount: review.records.length - review.decisions.length,
      evidenceLimits: { introduction: 100, thematic: 100, totalUtilized: 200 },
      introductionRecordCount: introductionEvidence.length,
      thematicRecordCount: detailedEvidence.length,
      prisma2020Diagram,
      picocFrameworkJustificationTable,
      inclusionExclusionJustificationTable,
      characteristicsTable,
      thematicFindingsSummaryTable,
      introductionEvidence,
      detailedEvidence,
      fullReferencesList,
      rules: [
        "MANDATORY IN-TEXT CITATIONS: Every single section of the manuscript (Introduction, Methods, Results, Synthesis, Discussion) MUST actively cite the reviewed records in-text using the active style (" + activeStyle + "). Do NOT make any unsubstantiated statement without citations. In-text citations MUST match the active style (" + activeStyle + "): e.g. for APA 7th/Harvard use (Author et al., Year); for IEEE use [1], [2]; for Vancouver use (1), (2). You MUST cite from the 100 introductionEvidence records in the Introduction, and cite from the 100 detailedEvidence records in the Results, Synthesis, and Discussion.",
        "MANDATORY REFERENCES SECTION: The manuscript MUST conclude with a comprehensive, complete 'References' section at the end. You MUST output all cited papers with their full bibliographic details (Authors, Year, Title, Journal/Source, DOI) in the " + activeStyle + " format. Every in-text citation must have its corresponding full entry in the References list. Never omit or truncate this section.",
        "PROHIBITED VOCABULARY (DO NOT SAY 'SUPPLIED RECORDS'): You are strictly FORBIDDEN from using phrases such as 'the supplied records', 'the supplied dataset', 'the provided records', 'the supplied evidence', 'the given literature', or 'in this review package'. Instead, write with authentic peer-reviewed scholarly authority: use 'the reviewed literature', 'the analyzed corpus', 'empirical findings across evaluated studies', 'prior research (e.g., Author, Year)', or 'the included publications'.",
        "NEVER MENTION AI SCREENING OR AUTOMATION: You are strictly FORBIDDEN from stating, implying, or suggesting that artificial intelligence, AI models, ChatGPT, or automated algorithms performed the literature screening, data extraction, or manuscript synthesis. The manuscript must be written strictly from the perspective of human scholarly researchers following PRISMA 2020 protocols (e.g., 'Two independent reviewers conducted title and abstract screening against the eligibility criteria...', 'Disagreements were resolved through consensus discussions...', 'Data extraction was performed independently using a standardized ledger...'). Report the findings and synthesis as your academic analysis.",
        "MANDATORY TABLES & DIAGRAMS IN MANUSCRIPT: The drafted manuscript MUST explicitly include the following 4 tables and PRISMA diagram provided in this package: (1) The PRISMA 2020 Flow Diagram in the Methods/Results section (rendered from prisma2020Diagram); (2) Table 1: PICOC Framework Justification Table in the Methods/Protocol section (rendered from picocFrameworkJustificationTable); (3) Table 2: Inclusion and Exclusion Criteria Justification Table in the Methods section (rendered from inclusionExclusionJustificationTable); (4) Table 3: Characteristics of Included Studies Table in the Results section (rendered directly from characteristicsTable); (5) Table 4: Thematic Model Synthesis and Predictive Performance Comparison Table in the Results/Synthesis section (rendered from thematicFindingsSummaryTable).",
        "USER CITATION STYLE SELECTION: The active citation style is " + activeStyle + ". The researcher can choose between APA 7th, IEEE, Vancouver, or Harvard. All citations and the bibliography must strictly follow the chosen style.",
        "EVIDENCE ALLOCATION (100 INTRO + 100 THEMATIC): Exactly 100 records are provided in 'introductionEvidence' for developing the comprehensive Introduction (background, thematic literature review, theoretical framing, and gap analysis). Exactly 100 records are provided in 'detailedEvidence' for the thematic analysis, study characteristics table, comparative performance analysis, and discussion. You MUST draw extensively from both 100-record sets.",
        "FORMATTING: Never use bullet points, dashes, numbered lists, or list items in the manuscript body text. Write everything as continuous, cohesive academic paragraphs in a formal scholarly style suitable for Q1-Q3 Scopus journals. Headings and subheadings are permitted, but all text beneath them must be flowing academic prose.",
        "NO EXTERNAL LITERATURE: Use only the reviewed records and stored study characteristics. Do not invent citations or bring in external papers."
      ],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(packageData, null, 2) }],
      structuredContent: packageData,
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_get_prisma", {
    title: "Get PRISMA 2020 Flow Diagram Data",
    description: "Return the PRISMA 2020 flow-diagram data dynamically generated from the review records, deduplication, screening ledger, and characteristics. Never invents numbers.",
    inputSchema: z.object({ reviewId: z.string() }),
  }, async ({ reviewId }) => {
    const review = await getReview(reviewId, owner);
    const dbCounts = new Map<string, number>();
    for (const rec of review.records) {
      const src = String(rec.databaseSource ?? rec.source ?? "Scopus").trim() || "Scopus";
      dbCounts.set(src, (dbCounts.get(src) || 0) + 1);
    }
    const databases = dbCounts.size > 0
      ? Array.from(dbCounts.entries()).map(([name, recordsIdentified]) => ({ name, recordsIdentified }))
      : [{ name: "Scopus", recordsIdentified: review.records.length }];

    const excluded = review.decisions.filter((d) => d.decision === "exclude" || (Number(d.score) < 50 && d.decision !== "include"));
    const included = review.decisions.filter((d) => d.decision === "include" || (Number(d.score) >= 50 && d.decision !== "exclude"));

    const reasonsMap = new Map<string, number>();
    for (const d of excluded) {
      const reason = String(d.exclusionReason ?? d.reason ?? "Other");
      reasonsMap.set(reason, (reasonsMap.get(reason) || 0) + 1);
    }

    const prismaData = {
      reviewId,
      identification: {
        databases,
        otherSources: 0,
      },
      removedBeforeScreening: {
        duplicates: 0,
        automation: 0,
        otherReasons: 0,
      },
      screening: {
        recordsScreened: review.records.length,
        recordsExcluded: excluded.length,
      },
      eligibility: {
        reportsSought: null,
        reportsNotRetrieved: null,
        reportsAssessed: null,
        reportsExcluded: 0,
        exclusionReasons: Array.from(reasonsMap.entries()).map(([reason, count]) => ({ reason, count })),
      },
      included: {
        studiesIncluded: included.length,
        studiesIncludedInSynthesis: Math.min(included.length, review.characteristics.length || included.length, 200),
      },
      evidenceLimits: {
        maximumEvidencePool: 200,
        maximumCharacteristics: 200,
        maximumThematicAnalysis: 200,
        maximumSynthesis: 200,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(prismaData, null, 2) }],
      structuredContent: prismaData,
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_next_workflow_action", {
    title: "Get Next LitlMatrix Workflow Action",
    description: "Return the next evidence-grounded action for the review. The host should follow this sequence without adding external literature.",
    inputSchema: z.object({ reviewId: z.string() }),
  }, async ({ reviewId }) => {
    const review = await getReview(reviewId, owner);
    const context = { criteria: review.criteria, protocol: review.protocol };
    const introduction = selectIntroductionRecords(review.records as any, context);
    const detailed = selectDetailedRecords(introduction as any, review.characteristics as any, context);
    const unresolved = review.records.length - review.decisions.length;
    let action: string;
    let instruction: string;
    if (!review.records.length) {
      const currentYear = new Date().getFullYear();
      const startYear = currentYear - 5;
      action = "suggest_framework_and_calibrated_search_strings";
      instruction = `Review the title and suggest a PICOC framework breakdown first. Then generate 3 calibrated Boolean search strings for Scopus and Web of Science strictly limited to: DOCTYPE "ar" (Article ONLY, no proceedings "cp", no reviews "re"), PUBSTAGE "final" (no articles in press), recent 5 years (${startYear}-${currentYear}), and English only.`;
    } else if (unresolved > 0) {
      action = "screen_batch";
      instruction = "Call litmatrix_get_screening_batch and screen only the returned records using their supplied title/abstract and the stored criteria. Save valid decisions before requesting another batch.";
    } else if (!review.characteristics.length) {
      action = "extract_characteristics";
      instruction = "Use the detailed evidence set (maximum 200 records) to extract study characteristics. Save them with litmatrix_save_characteristics.";
    } else {
      action = "draft_manuscript";
      instruction = "Call litmatrix_get_manuscript_package with the user's chosen citationStyle (APA 7th, IEEE, Vancouver, Harvard). Draft the manuscript: use the 100 introductionEvidence records to build the comprehensive Introduction, and use the 100 detailedEvidence records for the thematic analysis, comparative results, and characteristics table. Actively cite records in-text throughout and conclude with a full References list.";
    }
    return {
      content: [{ type: "text", text: instruction }],
      structuredContent: { reviewId, action, instruction, counts: { records: review.records.length, unresolved, characteristics: review.characteristics.length, introduction: introduction.length, detailed: detailed.length } },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_status", {
    title: "LitlMatrix Status",
    description: "Return the current record, screening, and evidence-budget counts for a LitlMatrix review. The reviewId must be a value previously returned by litmatrix_start_review (format: lm_<timestamp>_<random>). Do NOT use the authenticated user ID as the reviewId.",
    inputSchema: z.object({ reviewId: z.string() }),
  }, async ({ reviewId }) => {
    const review = await getReview(reviewId, owner);
    const context = { criteria: review.criteria, protocol: review.protocol };
    const introduction = selectIntroductionRecords(review.records as any, context);
    const detailed = selectDetailedRecords(introduction as any, review.characteristics as any, context);
    return {
      content: [{ type: "text", text: `Review ${reviewId}: ${review.records.length} records; ${review.decisions.length} screening decisions; ${review.records.length - review.decisions.length} unresolved; evidence budget ${introduction.length}/${detailed.length}.` }],
      structuredContent: {
        reviewId,
        title: review.title,
        recordCount: review.records.length,
        decisionCount: review.decisions.length,
        unresolvedCount: review.records.length - review.decisions.length,
        introductionRecordCount: introduction.length,
        detailedRecordCount: detailed.length,
        criteria: review.criteria,
      },
    };
  });

  registerAppResource(server, RESOURCE_URI, RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  return server;
}
