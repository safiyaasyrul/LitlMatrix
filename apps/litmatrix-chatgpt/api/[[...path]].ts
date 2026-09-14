import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import { authenticateRequest, AuthError, authConfigured, oauthAuthorizationServerMetadata, oauthProtectedResourceMetadata } from "../auth.js";
import { initStorage, deleteExpiredReviews, pool } from "../storage.js";
import { createServer } from "../server.js";
import { createActionsRouter } from "../actions.js";
import express from "express";

let initPromise: Promise<void> | undefined;
function ensureStorage() {
  if (!initPromise) {
    initPromise = initStorage().then(() => deleteExpiredReviews(30));
  }
  return initPromise;
}

const app = createMcpExpressApp({ host: "0.0.0.0" });

// Vercel invokes this file through the /api serverless function.
// Normalize the function prefix so Express routes remain /, /healthz, /mcp, and /.well-known/*
// regardless of whether the request arrived directly at /api/* or through a Vercel rewrite.
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.url === "/api" || req.url.startsWith("/api/")) {
    req.url = req.url.slice(4) || "/";
  }
  next();
});
const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean);
app.use(express.json({ limit: "5mb" }));

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "Last-Event-ID"],
  exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
}));
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  next();
});

app.get("/healthz", async (_req: Request, res: Response) => {
  try {
    await ensureStorage();
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "litmatrix-mcp", version: "0.9.0", authConfigured: authConfigured(), databaseConfigured: true });
  } catch {
    res.status(503).json({ ok: false, service: "litmatrix-mcp", version: "0.9.0", authConfigured: authConfigured(), databaseConfigured: Boolean(process.env.DATABASE_URL), databaseHealthy: false });
  }
});

app.get("/", (_req: Request, res: Response) => {
  res.json({ service: "LitlMatrix MCP", version: "0.9.0", endpoint: "/mcp", health: "/healthz", authentication: "OAuth/JWT" });
});

app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get("host")}/mcp`;
  res.json(oauthProtectedResourceMetadata(baseUrl));
});
app.get("/.well-known/oauth-protected-resource/mcp", (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get("host")}/mcp`;
  res.json(oauthProtectedResourceMetadata(baseUrl));
});
app.get("/.well-known/oauth-authorization-server", async (_req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(await oauthAuthorizationServerMetadata());
});

app.get("/openapi.json", (_req: Request, res: Response) => {
  res.json({
    openapi: "3.1.0",
    info: { title: "LitlMatrix GPT Actions API", version: "1.0.0", description: "Evidence-bounded systematic literature review operations for researcher-supplied Scopus/WoS records." },
    servers: [{ url: "https://litl-matrix-api-server-bpjcqoa9q-wannurdiyana-5641s-projects.vercel.app" }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/actions/start-review": { post: { operationId: "startReview", summary: "Start a LitlMatrix review", requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" }, protocol: { type: "object", additionalProperties: true } } } } } }, responses: { "200": { description: "Review created" } } } },
      "/actions/import-records": { post: { operationId: "importRecords", summary: "Import up to 200 researcher-supplied records", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ImportRecordsRequest" } } } }, responses: { "200": { description: "Records imported" } } } },
      "/actions/set-criteria": { post: { operationId: "setCriteria", summary: "Set deterministic review criteria", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CriteriaRequest" } } } }, responses: { "200": { description: "Criteria saved" } } } },
      "/actions/select-evidence": { post: { operationId: "selectEvidence", summary: "Select bounded evidence locally", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ReviewIdRequest" } } } }, responses: { "200": { description: "Evidence selected" } } } },
      "/actions/screening-batch": { post: { operationId: "getScreeningBatch", summary: "Get up to four unresolved screening records", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reviewId"], properties: { reviewId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 4 } } } } } }, responses: { "200": { description: "Screening batch" } } } },
      "/actions/save-screening-decisions": { post: { operationId: "saveScreeningDecisions", summary: "Save up to four screening decisions", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reviewId", "decisions"], properties: { reviewId: { type: "string" }, decisions: { type: "array", maxItems: 4, items: { $ref: "#/components/schemas/ScreeningDecision" } } } } } } }, responses: { "200": { description: "Decisions saved" } } } },
      "/actions/synthesis-evidence": { post: { operationId: "getSynthesisEvidence", summary: "Get bounded evidence for a manuscript section", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reviewId", "section"], properties: { reviewId: { type: "string" }, section: { type: "string", enum: ["introduction", "title", "results", "characteristics", "synthesis", "discussion"] } } } } } }, responses: { "200": { description: "Evidence records" } } } },
      "/actions/save-characteristics": { post: { operationId: "saveCharacteristics", summary: "Save up to 50 study characteristics", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reviewId", "characteristics"], properties: { reviewId: { type: "string" }, characteristics: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: true } } } } } } }, responses: { "200": { description: "Characteristics saved" } } } },
      "/actions/manuscript-package": { post: { operationId: "getManuscriptPackage", summary: "Get the evidence-bounded manuscript package", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ReviewIdRequest" } } } }, responses: { "200": { description: "Manuscript evidence package" } } } },
      "/actions/next-workflow-action": { post: { operationId: "getNextWorkflowAction", summary: "Get the next LitlMatrix workflow action", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ReviewIdRequest" } } } }, responses: { "200": { description: "Next workflow action" } } } },
      "/actions/status": { post: { operationId: "getStatus", summary: "Get review status and evidence counts", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ReviewIdRequest" } } } }, responses: { "200": { description: "Review status" } } } }
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        ReviewIdRequest: { type: "object", required: ["reviewId"], properties: { reviewId: { type: "string" } } },
        CriteriaRequest: { type: "object", required: ["reviewId", "terms"], properties: { reviewId: { type: "string" }, terms: { type: "array", maxItems: 50, items: { type: "string" } } } },
        ImportRecordsRequest: { type: "object", required: ["reviewId", "records"], properties: { reviewId: { type: "string" }, records: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", additionalProperties: true } }, characteristics: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: true } }, protocol: { type: "object", additionalProperties: true } } },
        ScreeningDecision: { type: "object", required: ["id", "score", "reason"], properties: { id: { type: "string" }, score: { type: "number", minimum: 0, maximum: 100 }, reason: { type: "string" }, decision: { type: "string", enum: ["include", "exclude"] }, exclusionReason: { type: "string" } } }
      }
    }
  });
});

app.use("/actions", createActionsRouter());

// MCP OAuth challenge must be emitted at the HTTP boundary before authentication.
// This guarantees that MCP clients can discover the Protected Resource Metadata URL from the 401 response.
app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
  if (!req.header("authorization")) {
    const metadataUrl = `${req.protocol}://${req.get("host")}/.well-known/oauth-protected-resource/mcp`;
    res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`);
    return res.status(401).json({ error: "unauthorized", message: "Authorization required." });
  }
  next();
});

app.all("/mcp", async (req: Request, res: Response) => {
  try {
    await ensureStorage();
    const owner = await authenticateRequest(req);
    const server = createServer(owner);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (error instanceof AuthError) {
      const metadataUrl = `${req.protocol}://${req.get("host")}/.well-known/oauth-protected-resource/mcp`;
      if (!res.headersSent) {
        res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${metadataUrl}"`);
        res.status(401).json({ error: "unauthorized", message: error.message });
      }
      return;
    }
    console.error("MCP error:", error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

export default app;
