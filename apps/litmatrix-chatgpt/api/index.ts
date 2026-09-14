import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import { authenticateRequest, AuthError, authConfigured, oauthAuthorizationServerMetadata, oauthProtectedResourceMetadata } from "../auth.js";
import { initStorage, deleteExpiredReviews, pool } from "../storage.js";
import { createServer } from "../server.js";

let initPromise: Promise<void> | undefined;
function ensureStorage() {
  if (!initPromise) {
    initPromise = initStorage().then(() => deleteExpiredReviews(30));
  }
  return initPromise;
}

const app = createMcpExpressApp({ host: "0.0.0.0" });
const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean);
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
app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
  res.json(oauthAuthorizationServerMetadata());
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
      const metadataUrl = `${req.protocol}://${req.get("host")}/.well-known/oauth-protected-resource`;
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata=\"${metadataUrl}\"`);
      if (!res.headersSent) res.status(401).json({ error: "unauthorized", message: error.message });
      return;
    }
    console.error("MCP error:", error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

export default app;
