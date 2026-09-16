import express, { type Request, type Response } from "express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";

import { createServer } from "./server.js";
import {
  authenticateRequest,
  AuthError,
} from "./auth.js";

import {
  ensureStorage,
} from "./storage.js";

const app = express();

/**
 * Body parsing
 */
app.use(express.json());

/**
 * OAuth / MCP protected-resource metadata
 *
 * This endpoint must remain publicly accessible so ChatGPT
 * can discover the authorization server.
 */
app.get(
  "/.well-known/oauth-protected-resource",
  (_req: Request, res: Response) => {
    res.json({
      resource: "https://litl-matrix-api-server.vercel.app/mcp",
      authorization_servers: [
        "https://loyal-gelding-9175.clerk.accounts.dev",
      ],
      token_types_supported: [
        "urn:ietf:params:oauth:token-type:access_token",
      ],
      token_introspection_endpoint:
        "https://loyal-gelding-9175.clerk.accounts.dev/oauth/token",
      token_introspection_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
      ],
      jwks_uri:
        "https://loyal-gelding-9175.clerk.accounts.dev/.well-known/jwks.json",
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
      service_documentation: "https://clerk.com/docs",
      scopes_supported: ["email", "profile"],
    });
  },
);

/**
 * MCP protected-resource metadata with resource path.
 *
 * Some MCP clients request the metadata endpoint with /mcp
 * appended to the well-known path.
 */
app.get(
  "/.well-known/oauth-protected-resource/mcp",
  (_req: Request, res: Response) => {
    res.json({
      resource: "https://litl-matrix-api-server.vercel.app/mcp",
      authorization_servers: [
        "https://loyal-gelding-9175.clerk.accounts.dev",
      ],
      token_types_supported: [
        "urn:ietf:params:oauth:token-type:access_token",
      ],
      token_introspection_endpoint:
        "https://loyal-gelding-9175.clerk.accounts.dev/oauth/token",
      token_introspection_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
      ],
      jwks_uri:
        "https://loyal-gelding-9175.clerk.accounts.dev/.well-known/jwks.json",
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
      service_documentation: "https://clerk.com/docs",
      scopes_supported: ["email", "profile"],
    });
  },
);

/**
 * Health check
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "litmatrix-mcp",
    version: "0.9.1",
    authConfigured: Boolean(
      process.env.AUTH_ISSUER &&
      process.env.AUTH_JWKS_URL,
    ),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  });
});

/**
 * MCP endpoint
 *
 * Authentication is handled by authenticateRequest().
 *
 * IMPORTANT:
 * Do not add clerkMiddleware() here.
 * The current application uses its own authenticateRequest()
 * implementation.
 */
app.post("/mcp", async (req: Request, res: Response) => {
  try {
    await ensureStorage();

    /**
     * Authenticate the ChatGPT OAuth Bearer token.
     */
    const owner = await authenticateRequest(req);

    /**
     * Create an MCP server scoped to the authenticated user.
     */
    const server = createServer(owner);

    /**
     * Streamable HTTP transport.
     *
     * sessionIdGenerator: undefined means stateless MCP requests,
     * which is appropriate for this Vercel deployment.
     */
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    /**
     * Clean up MCP server and transport when the request closes.
     */
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    /**
     * Connect the MCP server to the HTTP transport.
     */
    await server.connect(transport);

    /**
     * Handle the MCP request.
     */
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("LitlMatrix MCP request failed:", error);

    if (error instanceof AuthError) {
      const metadataUrl =
        "https://litl-matrix-api-server.vercel.app/.well-known/oauth-protected-resource/mcp";

      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${metadataUrl}"`,
      );

      if (!res.headersSent) {
        return res.status(401).json({
          error: "unauthorized",
          message: error.message,
        });
      }

      return;
    }

    if (!res.headersSent) {
      return res.status(500).json({
        error: "internal_server_error",
        message:
          error instanceof Error
            ? error.message
            : "Internal server error.",
      });
    }
  }
});

/**
 * Reject unsupported MCP methods cleanly.
 */
app.all("/mcp", (_req: Request, res: Response) => {
  if (!res.headersSent) {
    res.status(405).json({
      error: "method_not_allowed",
      message: "Use POST /mcp.",
    });
  }
});

/**
 * Vercel serverless handler
 */
export default app;