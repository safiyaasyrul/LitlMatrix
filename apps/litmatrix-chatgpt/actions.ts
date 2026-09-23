import { Router, type Request, type Response } from "express";
import { authenticateRequest, AuthError } from "./auth.js";
import { selectDetailedRecords, selectIntroductionRecords } from "./evidence.js";
import { loadReview, saveReview } from "./storage.js";

const MAX_RECORDS = 200;

type RecordData = Record<string, unknown>;
type Review = {
  title: string;
  records: RecordData[];
  decisions: RecordData[];
  criteria: string[];
  protocol: RecordData | null;
  characteristics: RecordData[];
};

function createReviewId() {
  return `lm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRecord(record: RecordData, index: number): RecordData {
  return {
    id: String(record.id ?? `record_${index + 1}`),
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

async function requireOwner(req: Request, res: Response) {
  try {
    return await authenticateRequest(req);
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ error: "unauthorized", message: error.message });
      return null;
    }
    throw error;
  }
}

async function getReview(reviewId: string, owner: Awaited<ReturnType<typeof authenticateRequest>>) {
  const state = await loadReview(reviewId, owner);
  if (!state) throw new Error(`Review ${reviewId} not found for this user.`);
  return state as Review;
}

export function createActionsRouter() {
  const router = Router();

  router.post("/start-review", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { title?: string; protocol?: RecordData };
      const reviewId = createReviewId();
      const review: Review = {
        title: body.title?.trim() || "Untitled systematic review",
        records: [],
        decisions: [],
        criteria: [],
        protocol: body.protocol ?? null,
        characteristics: [],
      };
      await saveReview(reviewId, review, owner);
      res.json({ reviewId, title: review.title, recordCount: 0, decisionCount: 0 });
    } catch (error) {
      console.error("Action start-review error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to start review." });
    }
  });

  router.post("/import-records", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { reviewId?: string; records?: RecordData[]; characteristics?: RecordData[]; protocol?: RecordData };
      if (!body.reviewId || !Array.isArray(body.records) || body.records.length < 1 || body.records.length > MAX_RECORDS) {
        return res.status(400).json({ error: "invalid_request", message: "reviewId and 1-200 records are required." });
      }
      const review = await getReview(body.reviewId, owner);
      const normalized = body.records.map(normalizeRecord).filter((r) => String(r.title ?? "").trim());
      const seen = new Set<string>();
      review.records = normalized.filter((record) => {
        const key = String(record.doi ?? "").trim().toLowerCase() || `${String(record.title).trim().toLowerCase()}|${String(record.year ?? "").trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, MAX_RECORDS);
      review.decisions = [];
      if (Array.isArray(body.characteristics)) review.characteristics = body.characteristics.slice(0, MAX_RECORDS);
      if (body.protocol) review.protocol = body.protocol;
      await saveReview(body.reviewId, review, owner);
      return res.json({ reviewId: body.reviewId, recordCount: review.records.length, characteristicCount: review.characteristics.length });
    } catch (error) {
      console.error("Action import-records error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to import records." });
    }
  });

  router.post("/set-criteria", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { reviewId?: string; terms?: string[] };
      if (!body.reviewId || !Array.isArray(body.terms)) return res.status(400).json({ error: "invalid_request", message: "reviewId and terms are required." });
      const review = await getReview(body.reviewId, owner);
      review.criteria = body.terms.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 50);
      await saveReview(body.reviewId, review, owner);
      res.json({ reviewId: body.reviewId, criteria: review.criteria });
    } catch (error) {
      console.error("Action set-criteria error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to save criteria." });
    }
  });

  router.post("/select-evidence", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const { reviewId } = (req.body ?? {}) as { reviewId?: string };
      if (!reviewId) return res.status(400).json({ error: "invalid_request", message: "reviewId is required." });
      const review = await getReview(reviewId, owner);
      const context = { criteria: review.criteria, protocol: review.protocol };
      const introduction = selectIntroductionRecords(review.records, context);
      const detailed = selectDetailedRecords(introduction, review.characteristics, context);
      res.json({ reviewId, allRecordCount: review.records.length, introductionRecordCount: introduction.length, detailedRecordCount: detailed.length, limits: { introduction: 100, detailed: 100 }, introduction, detailed });
    } catch (error) {
      console.error("Action select-evidence error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to select evidence." });
    }
  });

  router.post("/screening-batch", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { reviewId?: string; limit?: number };
      if (!body.reviewId) return res.status(400).json({ error: "invalid_request", message: "reviewId is required." });
      const review = await getReview(body.reviewId, owner);
      const limit = Math.min(4, Math.max(1, Number(body.limit ?? 4)));
      const decidedIds = new Set(review.decisions.map((d) => String(d.id)));
      const unresolved = review.records.filter((r) => !decidedIds.has(String(r.id)));
      res.json({ reviewId: body.reviewId, totalRecords: review.records.length, decided: review.decisions.length, unresolved: unresolved.length, batch: unresolved.slice(0, limit) });
    } catch (error) {
      console.error("Action screening-batch error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to get screening batch." });
    }
  });

  router.post("/save-screening-decisions", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { reviewId?: string; decisions?: Array<{ id: string; score: number; reason: string; decision?: "include" | "exclude"; exclusionReason?: string }> };
      if (!body.reviewId || !Array.isArray(body.decisions) || body.decisions.length > 4) return res.status(400).json({ error: "invalid_request", message: "reviewId and up to 4 decisions are required." });
      const review = await getReview(body.reviewId, owner);
      const allowedIds = new Set(review.records.map((r) => String(r.id)));
      const accepted = body.decisions.filter((d) => allowedIds.has(String(d.id)) && Number.isFinite(Number(d.score)) && Number(d.score) >= 0 && Number(d.score) <= 100 && String(d.reason ?? "").trim());
      const existing = new Map(review.decisions.map((d) => [String(d.id), d]));
      for (const decision of accepted) existing.set(decision.id, { ...decision, score: Number(decision.score), decision: decision.decision ?? (Number(decision.score) >= 50 ? "include" : "exclude") });
      review.decisions = [...existing.values()];
      await saveReview(body.reviewId, review, owner);
      res.json({ reviewId: body.reviewId, saved: accepted.length, decided: review.decisions.length, unresolved: review.records.length - review.decisions.length, total: review.records.length });
    } catch (error) {
      console.error("Action save-screening-decisions error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to save screening decisions." });
    }
  });

  router.post("/synthesis-evidence", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { reviewId?: string; section?: string };
      if (!body.reviewId || !["introduction", "title", "results", "characteristics", "synthesis", "discussion"].includes(String(body.section))) return res.status(400).json({ error: "invalid_request", message: "reviewId and a valid section are required." });
      const review = await getReview(body.reviewId, owner);
      const context = { criteria: review.criteria, protocol: review.protocol };
      
      const introduction = selectIntroductionRecords(review.records, context);
      
      const includedIds = new Set(review.decisions.filter(d => d.decision === "include").map(d => String(d.id)));
      const includedRecords = review.records.filter(r => includedIds.has(String(r.id)));
      
      const detailed = selectDetailedRecords(includedRecords, review.characteristics, context);
      const records = body.section === "introduction" ? introduction : detailed;
      res.json({ reviewId: body.reviewId, section: body.section, recordCount: records.length, records });
    } catch (error) {
      console.error("Action synthesis-evidence error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to get synthesis evidence." });
    }
  });

  router.post("/save-characteristics", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { reviewId?: string; characteristics?: RecordData[] };
      if (!body.reviewId || !Array.isArray(body.characteristics) || body.characteristics.length > 100) return res.status(400).json({ error: "invalid_request", message: "reviewId and up to 100 characteristics are required." });
      const review = await getReview(body.reviewId, owner);
      const allowedIds = new Set(review.records.map((r) => String(r.id)));
      const accepted = body.characteristics.filter((c) => allowedIds.has(String(c.recordId ?? c.id ?? "")));
      const existing = new Map(review.characteristics.map((c) => [String(c.recordId ?? c.id), c]));
      for (const c of accepted) existing.set(String(c.recordId ?? c.id), c);
      review.characteristics = [...existing.values()];
      await saveReview(body.reviewId, review, owner);
      res.json({ reviewId: body.reviewId, saved: accepted.length, characteristicCount: review.characteristics.length });
    } catch (error) {
      console.error("Action save-characteristics error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to save characteristics." });
    }
  });

  router.post("/manuscript-package", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const { reviewId } = (req.body ?? {}) as { reviewId?: string };
      if (!reviewId) return res.status(400).json({ error: "invalid_request", message: "reviewId is required." });
      const review = await getReview(reviewId, owner);
      const context = { criteria: review.criteria, protocol: review.protocol };
      const introductionEvidence = selectIntroductionRecords(review.records, context);
      
      const includedIds = new Set(review.decisions.filter(d => d.decision === "include").map(d => String(d.id)));
      const includedRecords = review.records.filter(r => includedIds.has(String(r.id)));
      
      const detailedEvidence = selectDetailedRecords(includedRecords, review.characteristics, context);
      const included = review.decisions.filter((d) => d.decision === "include" || Number(d.score) >= 50);
      res.json({ reviewId, title: review.title, protocol: review.protocol, totalRecords: review.records.length, decisions: review.decisions, includedDecisionCount: included.length, unresolvedCount: review.records.length - review.decisions.length, introductionEvidence, detailedEvidence, characteristics: review.characteristics, citationStyleOptions: ["APA 7th", "IEEE", "Vancouver", "Harvard"], evidenceLimits: { introduction: 200, title: 200, results: 200, characteristics: 200, synthesis: 200, discussion: 200 }, rules: ["Use only the supplied records and stored study characteristics.", "Do not introduce external papers, citations, authors, findings, statistics, or facts.", "Do not claim to have analyzed records that were not supplied to the current operation.", "If evidence is insufficient, say that it is insufficient rather than inventing support."] });
    } catch (error) {
      console.error("Action manuscript-package error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to build manuscript package." });
    }
  });

  router.post("/prisma", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const body = (req.body ?? {}) as { reviewId?: string; overrides?: Record<string, unknown> };
      if (!body.reviewId) return res.status(400).json({ error: "invalid_request", message: "reviewId is required." });
      const review = await getReview(body.reviewId, owner);

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

      const overrides = body.overrides || {};
      const prismaData = {
        reviewId: body.reviewId,
        identification: {
          databases: (overrides.databases as any) ?? databases,
          otherSources: Number(overrides.otherSources ?? 0),
        },
        removedBeforeScreening: {
          duplicates: Number(overrides.duplicates ?? 0),
          automation: Number(overrides.automation ?? 0),
          otherReasons: Number(overrides.otherReasons ?? 0),
        },
        screening: {
          recordsScreened: Number(overrides.recordsScreened ?? review.records.length),
          recordsExcluded: Number(overrides.recordsExcluded ?? excluded.length),
        },
        eligibility: {
          reportsSought: overrides.reportsSought !== undefined ? (overrides.reportsSought as number | null) : null,
          reportsNotRetrieved: overrides.reportsNotRetrieved !== undefined ? (overrides.reportsNotRetrieved as number | null) : null,
          reportsAssessed: overrides.reportsAssessed !== undefined ? (overrides.reportsAssessed as number | null) : null,
          reportsExcluded: Number(overrides.reportsExcluded ?? 0),
          exclusionReasons: (overrides.exclusionReasons as any) ?? Array.from(reasonsMap.entries()).map(([reason, count]) => ({ reason, count })),
        },
        included: {
          studiesIncluded: Number(overrides.studiesIncluded ?? included.length),
          studiesIncludedInSynthesis: Number(overrides.studiesIncludedInSynthesis ?? Math.min(included.length, review.characteristics.length || included.length, 100)),
        },
        evidenceLimits: {
          maximumEvidencePool: 100,
          maximumCharacteristics: 100,
          maximumThematicAnalysis: 100,
          maximumSynthesis: 100,
        },
      };

      res.json(prismaData);
    } catch (error) {
      console.error("Action prisma error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to calculate PRISMA data." });
    }
  });

  router.post("/next-workflow-action", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const { reviewId } = (req.body ?? {}) as { reviewId?: string };
      if (!reviewId) return res.status(400).json({ error: "invalid_request", message: "reviewId is required." });
      const review = await getReview(reviewId, owner);
      const context = { criteria: review.criteria, protocol: review.protocol };
      const introduction = selectIntroductionRecords(review.records, context);
      const detailed = selectDetailedRecords(introduction, review.characteristics, context);
      const unresolved = review.records.length - review.decisions.length;
      let action: string; let instruction: string;
      if (!review.records.length) { action = "import_records"; instruction = "Import the researcher-supplied Scopus/WoS records before doing AI analysis."; }
      else if (unresolved > 0) { action = "screen_batch"; instruction = "Get a screening batch and screen only the returned records using supplied title/abstract and stored criteria. Save decisions before requesting another batch."; }
      else if (!review.characteristics.length) { action = "extract_characteristics"; instruction = "Use the detailed evidence set (maximum 100 records) to extract study characteristics and save them."; }
      else { action = "draft_manuscript"; instruction = "Get the manuscript evidence package and draft the requested section using only its bounded evidence."; }
      res.json({ reviewId, action, instruction, counts: { records: review.records.length, unresolved, characteristics: review.characteristics.length, introduction: introduction.length, detailed: detailed.length } });
    } catch (error) {
      console.error("Action next-workflow-action error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to determine next workflow action." });
    }
  });

  router.post("/status", async (req, res) => {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    try {
      const { reviewId } = (req.body ?? {}) as { reviewId?: string };
      if (!reviewId) return res.status(400).json({ error: "invalid_request", message: "reviewId is required." });
      const review = await getReview(reviewId, owner);
      const context = { criteria: review.criteria, protocol: review.protocol };
      const introduction = selectIntroductionRecords(review.records, context);
      const detailed = selectDetailedRecords(introduction, review.characteristics, context);
      res.json({ reviewId, title: review.title, recordCount: review.records.length, decisionCount: review.decisions.length, unresolvedCount: review.records.length - review.decisions.length, introductionRecordCount: introduction.length, detailedRecordCount: detailed.length, criteria: review.criteria });
    } catch (error) {
      console.error("Action status error", error);
      res.status(500).json({ error: "internal_error", message: "Unable to get review status." });
    }
  });

  return router;
}
