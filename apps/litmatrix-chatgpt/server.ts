import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { selectDetailedRecords, selectIntroductionRecords } from "./evidence.js";

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

export function createServer(owner: AuthUser): McpServer {
  const server = new McpServer({ name: "LitlMatrix", version: "0.9.1" });

  registerLitmatrixAppTool(server, "litmatrix_start_review", {
    title: "Start LitlMatrix Review",
    description: "Create a LitlMatrix systematic review workspace. The ChatGPT host performs AI reasoning; LitlMatrix stores and bounds the researcher-supplied evidence.",
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
    return {
      content: [{ type: "text", text: `LitlMatrix review ${reviewId} is ready. Import the researcher-supplied Scopus/WoS records next.` }],
      structuredContent: { reviewId, title: review.title, recordCount: 0, decisionCount: 0 },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_import_records", {
    title: "Import Review Records",
    description: "Store only citation records supplied by the researcher. No external literature is added. The review supports up to 200 records in the evidence workflow.",
    inputSchema: z.object({
      reviewId: z.string(),
      records: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
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
    }).slice(0, 200);
    review.decisions = [];
    if (characteristics) review.characteristics = characteristics;
    if (protocol) review.protocol = protocol;
    await persistReview(reviewId, review, owner);
    return {
      content: [{ type: "text", text: `Imported ${review.records.length} researcher-supplied records into ${reviewId}.` }],
      structuredContent: { reviewId, recordCount: review.records.length, characteristicCount: review.characteristics.length },
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
    description: "Deterministically select up to 100 title-relevant records, then up to 50 detailed evidence records. This tool never calls an AI provider and never adds external records.",
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
        limits: { introduction: 100, detailed: 50 },
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
        score: z.number().min(0).max(100),
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
    description: "Return the bounded evidence set for a manuscript section. Introduction uses up to 100 records; title, results, characteristics, synthesis, and discussion use up to 50 detailed records. Use only researcher-supplied records.",
    inputSchema: z.object({ reviewId: z.string(), section: z.enum(["introduction", "title", "results", "characteristics", "synthesis", "discussion"]) }),
  }, async ({ reviewId, section }) => {
    const review = await getReview(reviewId, owner);
    const context = { criteria: review.criteria, protocol: review.protocol };
    const introduction = selectIntroductionRecords(review.records as any, context);
    const detailed = selectDetailedRecords(introduction as any, review.characteristics as any, context);
    const selected = section === "introduction" ? introduction : detailed;
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
      characteristics: z.array(z.record(z.string(), z.unknown())).max(50),
    }),
  }, async ({ reviewId, characteristics }) => {
    const review = await getReview(reviewId, owner);
    const allowedIds = new Set(review.records.map((r) => String(r.id)));
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

  registerLitmatrixAppTool(server, "litmatrix_get_manuscript_package", {
    title: "Get Manuscript Evidence Package",
    description: "Return the complete researcher-supplied record universe metadata plus bounded section evidence. This package is for evidence-grounded manuscript drafting and must not be supplemented with external literature.",
    inputSchema: z.object({ reviewId: z.string() }),
  }, async ({ reviewId }) => {
    const review = await getReview(reviewId, owner);
    const context = { criteria: review.criteria, protocol: review.protocol };
    const introduction = selectIntroductionRecords(review.records as any, context);
    const detailed = selectDetailedRecords(introduction as any, review.characteristics as any, context);
    const included = review.decisions.filter((d) => d.decision === "include" || Number(d.score) >= 50);
    const packageData = {
      reviewId,
      title: review.title,
      protocol: review.protocol,
      totalRecords: review.records.length,
      decisions: review.decisions,
      includedDecisionCount: included.length,
      unresolvedCount: review.records.length - review.decisions.length,
      introductionEvidence: introduction,
      detailedEvidence: detailed,
      characteristics: review.characteristics,
      citationStyleOptions: ["APA 7th", "IEEE", "Vancouver", "Harvard"],
      evidenceLimits: { introduction: 100, title: 50, results: 50, characteristics: 50, synthesis: 50, discussion: 50 },
      rules: [
        "Use only the supplied records and stored study characteristics.",
        "Do not introduce external papers, citations, authors, findings, statistics, or facts.",
        "Do not claim to have analyzed records that were not supplied to the current operation.",
        "If evidence is insufficient, say that it is insufficient rather than inventing support.",
      ],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(packageData, null, 2) }],
      structuredContent: packageData,
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
      action = "import_records";
      instruction = "Import the researcher-supplied Scopus/WoS records before doing AI analysis.";
    } else if (unresolved > 0) {
      action = "screen_batch";
      instruction = "Call litmatrix_get_screening_batch and screen only the returned records using their supplied title/abstract and the stored criteria. Save valid decisions before requesting another batch.";
    } else if (!review.characteristics.length) {
      action = "extract_characteristics";
      instruction = "Use the detailed evidence set (maximum 50 records) to extract study characteristics. Save them with litmatrix_save_characteristics.";
    } else {
      action = "draft_manuscript";
      instruction = "Call litmatrix_get_manuscript_package and draft the requested manuscript section using only its bounded evidence. Title, results, characteristics, synthesis, and discussion each use at most 50 detailed records; introduction/context uses at most 100.";
    }
    return {
      content: [{ type: "text", text: instruction }],
      structuredContent: { reviewId, action, instruction, counts: { records: review.records.length, unresolved, characteristics: review.characteristics.length, introduction: introduction.length, detailed: detailed.length } },
    };
  });

  registerLitmatrixAppTool(server, "litmatrix_status", {
    title: "LitlMatrix Status",
    description: "Return the current record, screening, and evidence-budget counts for a LitlMatrix review.",
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
