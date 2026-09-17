import express, { type Request, type Response } from "express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createServer } from "../server.js";
import { authenticateRequest, AuthError } from "../auth.js";
import { ensureStorage } from "../storage.js";

const app = express();

app.use(express.json());

const CLERK_ISSUER =
  "https://loyal-gelding-9175.clerk.accounts.dev";

const MCP_RESOURCE =
  "https://litl-matrix-api-server.vercel.app/mcp";

const METADATA_URL =
  "https://litl-matrix-api-server.vercel.app/.well-known/oauth-protected-resource/mcp";

function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,

    authorization_servers: [
      CLERK_ISSUER,
    ],

    token_types_supported: [
      "urn:ietf:params:oauth:token-type:access_token",
    ],

    token_introspection_endpoint:
      `${CLERK_ISSUER}/oauth/token`,

    token_introspection_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],

    jwks_uri:
      `${CLERK_ISSUER}/.well-known/jwks.json`,

    authorization_data_types_supported: [
      "oauth_scope",
    ],

    authorization_data_locations_supported: [
      "header",
      "body",
    ],

    key_challenges_supported: [
      {
        challenge_type:
          "urn:ietf:params:oauth:pkce:code_challenge",
        challenge_algs: ["S256"],
      },
    ],

    service_documentation:
      "https://clerk.com/docs",

    scopes_supported: [
      "email",
      "profile",
    ],
  };
}

/**
 * OAuth Protected Resource Metadata
 */
app.get(
  "/.well-known/oauth-protected-resource",
  (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata());
  },
);

app.get(
  "/.well-known/oauth-protected-resource/mcp",
  (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata());
  },
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
 */
app.post(
  "/mcp",
  async (req: Request, res: Response) => {
    try {
      await ensureStorage();

      /**
       * Authenticate the ChatGPT OAuth access token.
       */
      const owner =
        await authenticateRequest(req);

      /**
       * Create an MCP server for this authenticated owner.
       */
      const server =
        createServer(owner);

      /**
       * Streamable HTTP transport.
       *
       * LitlMatrix currently uses stateless
       * MCP requests, therefore no session ID.
       */
      const transport =
        new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

      /**
       * Clean up when the HTTP response closes.
       */
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      /**
       * Connect MCP server to transport.
       */
      await server.connect(transport);

      /**
       * Handle the MCP request.
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

      /**
       * IMPORTANT:
       * Authentication failures must return 401,
       * not 500, so ChatGPT can correctly process
       * the OAuth challenge.
       */
      if (error instanceof AuthError) {

        if (!res.headersSent) {
          res.setHeader(
            "WWW-Authenticate",
            `Bearer resource_metadata="${METADATA_URL}"`,
          );

          return res.status(401).json({
            error: "unauthorized",
            message: error.message,
          });
        }

        return;
      }

      /**
       * Handle unexpected server errors.
       */
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