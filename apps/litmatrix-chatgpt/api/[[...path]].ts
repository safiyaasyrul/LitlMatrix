import express, {
  type Request,
  type Response,
} from "express";

import cors from "cors";

import {
  clerkMiddleware,
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

const MCP_RESOURCE =
  "https://litl-matrix-api-server.vercel.app/mcp";

/**
 * ---------------------------------------------------------
 * CORS
 * ---------------------------------------------------------
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
 * ---------------------------------------------------------
 * Clerk middleware
 * ---------------------------------------------------------
 *
 * Must be registered before authentication helpers.
 */
app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  })
);

/**
 * ---------------------------------------------------------
 * Body parser
 * ---------------------------------------------------------
 */
app.use(express.json());

/**
 * ---------------------------------------------------------
 * OAuth Protected Resource Metadata
 * ---------------------------------------------------------
 *
 * These endpoints MUST remain public.
 */

/**
 * Current MCP protected-resource metadata.
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
 * Root protected-resource metadata.
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
 * Older OAuth/MCP clients.
 */
app.get(
  "/.well-known/oauth-authorization-server",
  authServerMetadataHandlerClerk,
);

/**
 * ---------------------------------------------------------
 * Health
 * ---------------------------------------------------------
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
        process.env.CLERK_PUBLISHABLE_KEY,
      ),

      databaseConfigured: Boolean(
        process.env.DATABASE_URL,
      ),
    });
  },
);

/**
 * ---------------------------------------------------------
 * MCP POST
 * ---------------------------------------------------------
 *
 * ChatGPT sends OAuth access tokens here.
 *
 * mcpAuthClerk:
 *   - reads Authorization: Bearer ...
 *   - validates the Clerk OAuth token
 *   - rejects unauthorized requests with 401
 *
 * We DO NOT call getAuth() again.
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
       * this request.
       *
       * It attaches authentication information
       * to the request.
       *
       * We only need the Clerk user ID as the
       * LitlMatrix owner identifier.
       */
      const authData = (req as any).auth;

      const userId =
        authData?.extra?.userId ?? authData?.userId;

      if (!userId) {
        console.error(
          "LitlMatrix: Clerk MCP authentication succeeded but userId was not available.",
          {
            hasAuthData: Boolean(authData),
            hasExtra: Boolean(authData?.extra),
          }
        );

        if (!res.headersSent) {
          return res.status(401).json({
            error: "unauthorized",
            message:
              "Authenticated Clerk user could not be identified.",
          });
        }

        return;
      }

      /**
       * LitlMatrix owner.
       */
      const owner = {
        subject: userId,
      };

      console.log(
        "LitlMatrix MCP authenticated user:",
        userId,
      );

      /**
       * Create the existing LitlMatrix MCP server.
       */
      server = createServer(owner);

      /**
       * Existing MCP transport.
       */
      transport =
        new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

      /**
       * Cleanup.
       */
      res.on("close", () => {
        transport?.close().catch(() => {});
        server?.close().catch(() => {});
      });

      /**
       * Connect MCP server.
       */
      await server.connect(transport);

      /**
       * Handle MCP request.
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
 * ---------------------------------------------------------
 * GET /mcp
 * ---------------------------------------------------------
 *
 * A browser GET should NOT return 405.
 *
 * MCP clients performing discovery/smoke tests may
 * expect an OAuth challenge.
 */
app.get(
  ["/mcp", "/api/mcp"],
  (_req: Request, res: Response) => {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${MCP_RESOURCE}/../.well-known/oauth-protected-resource/mcp"`,
    );

    return res.status(401).json({
      error: "unauthorized",
      message: "Authorization required.",
    });
  },
);

/**
 * ---------------------------------------------------------
 * Other unsupported MCP methods
 * ---------------------------------------------------------
 */
app.all(
  ["/mcp", "/api/mcp"],
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
 * ---------------------------------------------------------
 * Export
 * ---------------------------------------------------------
 */
export default app;