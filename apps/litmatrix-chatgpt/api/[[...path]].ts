import express, {
  type Request,
  type Response,
} from "express";

import cors from "cors";

import {
  clerkMiddleware,
  getAuth,
} from "@clerk/express";

import {
  mcpAuthClerk,
  protectedResourceHandlerClerk,
  authServerMetadataHandlerClerk,
} from "@clerk/mcp-tools/express";

import {
  NodeStreamableHTTPServerTransport,
} from "@modelcontextprotocol/node";

import { createServer } from "../server.js";
import { initStorage } from "../storage.js";

const app = express();

/**
 * CORS
 *
 * Required so ChatGPT and other public MCP clients
 * can access the MCP endpoint and read the
 * WWW-Authenticate header.
 */
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

/**
 * Clerk middleware
 *
 * IMPORTANT:
 * This MUST be registered before mcpAuthClerk
 * or getAuth().
 */
app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  })
);

/**
 * JSON body parser
 */
app.use(express.json());

/**
 * =========================================================
 * OAuth Protected Resource Metadata
 * =========================================================
 *
 * These endpoints must remain publicly accessible.
 */

/**
 * Current MCP protected-resource metadata endpoint.
 */
app.get(
  ["/.well-known/oauth-protected-resource/mcp", "/api/.well-known/oauth-protected-resource/mcp"],
  protectedResourceHandlerClerk({
    scopes_supported: [
      "email",
      "profile",
    ],
  }),
);

/**
 * Older MCP clients may use this endpoint.
 */
app.get(
  "/.well-known/oauth-authorization-server",
  authServerMetadataHandlerClerk,
);

/**
 * Keep the non-/mcp protected-resource endpoint
 * available as well.
 */
app.get(
  ["/.well-known/oauth-protected-resource", "/api/.well-known/oauth-protected-resource"],
  protectedResourceHandlerClerk({
    scopes_supported: [
      "email",
      "profile",
    ],
  }),
);

/**
 * =========================================================
 * Health check
 * =========================================================
 */
app.get(
  ["/health", "/healthz", "/api/healthz"],
  (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "litmatrix-mcp",
      version: "0.9.1",

      authConfigured: Boolean(
        process.env.CLERK_SECRET_KEY &&
        (
          process.env.CLERK_PUBLISHABLE_KEY ||
          process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
        ),
      ),

      databaseConfigured: Boolean(
        process.env.DATABASE_URL,
      ),
    });
  },
);

/**
 * =========================================================
 * MCP endpoint
 * =========================================================
 *
 * mcpAuthClerk validates the incoming Clerk OAuth
 * access token before this handler executes.
 */
app.post(
  ["/mcp", "/api/mcp"],
  mcpAuthClerk,
  async (
    req: Request,
    res: Response,
  ) => {
    let server:
      | ReturnType<typeof createServer>
      | undefined;

    let transport:
      | NodeStreamableHTTPServerTransport
      | undefined;

    try {
      /**
       * Initialize database/storage.
       */
      await initStorage();

      /**
       * mcpAuthClerk has already authenticated
       * the OAuth access token.
       *
       * Read the authenticated Clerk user ID.
       *
       * acceptsToken: "oauth_token" is important
       * because ChatGPT is using a Clerk OAuth token,
       * not a normal browser session token.
       */
      const auth = getAuth(
        req,
        {
          acceptsToken: "oauth_token",
        },
      );

      const userId = auth.userId;

      if (!auth.isAuthenticated || !userId) {
        if (!res.headersSent) {
          return res.status(401).json({
            error: "unauthorized",
            message:
              "Authenticated Clerk user could not be determined.",
          });
        }

        return;
      }

      /**
       * LitlMatrix owner.
       *
       * server.ts expects an AuthUser with a
       * stable subject identifier.
       */
      const owner = {
        subject: userId,
      };

      /**
       * Create a separate LitlMatrix MCP server
       * for this authenticated user.
       */
      server = createServer(owner);

      /**
       * Existing LitlMatrix transport.
       *
       * Keep the transport already used by this
       * project rather than changing the MCP SDK.
       */
      transport =
        new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

      /**
       * Clean up resources when the request closes.
       */
      res.on("close", () => {
        transport?.close().catch(() => {});
        server?.close().catch(() => {});
      });

      /**
       * Connect LitlMatrix MCP server to transport.
       */
      await server.connect(transport);

      /**
       * Process the MCP request.
       */
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
 * =========================================================
 * Unsupported MCP methods
 * =========================================================
 *
 * MCP clients should use POST /mcp.
 */
app.all(
  ["/mcp", "/api/mcp"],
  mcpAuthClerk,
  (_req: Request, res: Response) => {
    if (!res.headersSent) {
      return res.status(405).json({
        error: "method_not_allowed",
        message: "Use POST /mcp.",
      });
    }
  },
);

/**
 * Export Vercel serverless application.
 */
export default app;