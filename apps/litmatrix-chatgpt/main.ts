import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import cors from "cors";
import type { Request, Response } from "express";
import { authenticateRequest, AuthError, authConfigured, oauthAuthorizationServerMetadata, oauthProtectedResourceMetadata } from "./auth.js";
import { initStorage, deleteExpiredReviews, pool } from "./storage.js";
import { createServer } from "./server.js";

async function startHttp() {
  await initStorage();
  await deleteExpiredReviews(30);

  const port = Number(process.env.PORT ?? 3001);
  const app = createMcpExpressApp({ host: process.env.HOST ?? "0.0.0.0" });
  const allowedOrigins = (process.env.ALLOWED_ORIGIN ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  app.use(cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "Last-Event-ID"],
    exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
  }));
  app.use((req, res, next) => {
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
      await pool.query("SELECT 1");
      res.json({ ok: true, service: "litmatrix-mcp", version: "0.7.0", authConfigured: authConfigured(), databaseConfigured: true });
    } catch {
      res.status(503).json({ ok: false, service: "litmatrix-mcp", version: "0.7.0", authConfigured: authConfigured(), databaseConfigured: true, databaseHealthy: false });
    }
  });
  app.get("/", (_req: Request, res: Response) => {
    res.json({ service: "LitlMatrix MCP", version: "0.7.0", endpoint: "/mcp", health: "/healthz", authentication: "OAuth/JWT" });
  });

  app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
    const baseUrl = `${req.protocol}://${req.get("host")}/mcp`;
    res.json(oauthProtectedResourceMetadata(baseUrl));
  });
  app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.json(oauthAuthorizationServerMetadata());
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    let owner;
    try {
      owner = await authenticateRequest(req);
    } catch (error) {
      const message = error instanceof AuthError ? error.message : "Invalid access token.";
      const metadataUrl = `${req.protocol}://${req.get("host")}/.well-known/oauth-protected-resource`;
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata=\"${metadataUrl}\"`);
      return res.status(401).json({ error: "unauthorized", message });
    }

    const server = createServer(owner);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  const server = app.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`LitlMatrix MCP server listening on port ${port}`));
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; shutting down.`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

async function startStdio() {
  await initStorage();
  const server: McpServer = createServer({ subject: process.env.STDIO_OWNER_SUBJECT ?? "stdio-local" });
  await server.connect(new StdioServerTransport());
}

if (process.argv.includes("--stdio")) startStdio().catch((error) => { console.error(error); process.exit(1); });
else startHttp().catch((error) => { console.error(error); process.exit(1); });
