import express, { type Request, type Response } from "express";
import cors from "cors";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

import { clerkMiddleware } from "@clerk/express";

import {
  mcpAuthClerk,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/express";

import { createServer } from "../server.js";
import { initStorage } from "../storage.js";

const app = express();

app.use(clerkMiddleware());

app.use(express.json());
app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: [
      "WWW-Authenticate",
      "Mcp-Session-Id",
    ],
  }),
);

const CLERK_ISSUER =
  "https://loyal-gelding-9175.clerk.accounts.dev";

const MCP_RESOURCE =
  "https://litl-matrix-api-server.vercel.app/mcp";

/**
 * OAuth Protected Resource Metadata
 *
 * Clerk MCP middleware provides the metadata.
 */
app.get(
  "/.well-known/oauth-protected-resource",
  protectedResourceHandlerClerk({
    scopesSupported: ["openid", "profile", "email"],
  }),
);

app.get(
  "/.well-known/oauth-protected-resource/mcp",
  protectedResourceHandlerClerk({
    scopesSupported: ["openid", "profile", "email"],
  }),
);

/**
 * Health check
 */
app.get(
  "/health",
  (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "litmatrix-mcp",
      version: "0.9.1",
      authConfigured: Boolean(
        process.env.CLERK_SECRET_KEY,
      ),
      databaseConfigured: Boolean(
        process.env.DATABASE_URL,
      ),
    });
  },
);

/**
 * MCP endpoint
 *
 * mcpAuthClerk validates the Clerk OAuth
 * access token before the handler runs.
 */
app.post(
  "/mcp",
  mcpAuthClerk,
  async (req: Request, res: Response) => {
    let server:
      | ReturnType<typeof createServer>
      | undefined;

    let transport:
      | NodeStreamableHTTPServerTransport
      | undefined;

    try {
      await initStorage();

      /**
       * mcpAuthClerk has already authenticated
       * the request.
       *
       * Clerk places the authenticated subject
       * on req.auth.
       */
      const auth = (req as any).auth;

      const subject =
        auth?.subject ||
        auth?.userId;

      if (!subject) {
        return res.status(401).json({
          error: "unauthorized",
          message:
            "Authenticated Clerk request has no subject.",
        });
      }

      const owner = {
        subject,
      };

      /**
       * Create the existing LitlMatrix MCP server
       * for this authenticated user.
       */
      server = createServer(owner);

      /**
       * Preserve your existing MCP transport.
       */
      transport =
        new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

      res.on("close", () => {
        transport?.close().catch(() => {});
        server?.close().catch(() => {});
      });

      await server.connect(transport);

      await transport.handleRequest(
        req,
        res,
      );

    } catch (error) {
      console.error(
        "LitlMatrix MCP request failed:",
        error,
      );

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      if (!res.headersSent) {
        return res.status(500).json({
          error: "internal_server_error",
          message,
        });
      }
    }
  },
);

/**
 * Reject unsupported MCP methods.
 */
app.all(
  "/mcp",
  (_req: Request, res: Response) => {
    if (!res.headersSent) {
      res.status(405).json({
        error: "method_not_allowed",
        message: "Use POST /mcp.",
      });
    }
  },
);

export default app;