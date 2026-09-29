import type { VercelRequest, VercelResponse } from "@vercel/node";

const CLERK_ISSUER = "https://loyal-gelding-9175.clerk.accounts.dev";
const RESOURCE = "https://litl-matrix-api-server.vercel.app/mcp";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  return res.status(200).json({
    resource: RESOURCE,
    authorization_servers: [CLERK_ISSUER],
    token_types_supported: [
      "urn:ietf:params:oauth:token-type:access_token"
    ],
    token_introspection_endpoint: `${CLERK_ISSUER}/oauth/token`,
    token_introspection_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic"
    ],
    jwks_uri: `${CLERK_ISSUER}/.well-known/jwks.json`,
    authorization_data_types_supported: ["oauth_scope"],
    authorization_data_locations_supported: ["header", "body"],
    key_challenges_supported: [
      {
        challenge_type: "urn:ietf:params:oauth:pkce:code_challenge",
        challenge_algs: ["S256"]
      }
    ],
    service_documentation: "https://clerk.com/docs",
    scopes_supported: ["email", "profile"]
  });
}
