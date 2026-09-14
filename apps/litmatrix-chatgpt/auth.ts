import type { Request } from "express";
import { createPublicKey, verify as verifySignature } from "node:crypto";

export type AuthUser = { subject: string; email?: string; name?: string };

type Jwk = { kid?: string; kty: string; alg?: string; use?: string; [key: string]: unknown };
type Jwks = { keys: Jwk[] };

const issuer = process.env.AUTH_ISSUER?.trim();
const audience = process.env.AUTH_AUDIENCE?.trim();
const jwksUrl = process.env.AUTH_JWKS_URL?.trim();
const allowAnonymousDev = process.env.ALLOW_ANONYMOUS_DEV === "true";
const allowedEmails = new Set(
  (process.env.LITMATRIX_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
let cachedJwks: { value: Jwks; expiresAt: number } | null = null;

export function authConfigured() { return Boolean(issuer && jwksUrl); }

export async function authenticateRequest(req: Request): Promise<AuthUser> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    if (allowAnonymousDev && !authConfigured()) return { subject: "dev-anonymous" };
    throw new AuthError("Authorization required.");
  }
  if (!authConfigured()) throw new AuthError("MCP authentication is not configured.");
  const token = header.slice("Bearer ".length).trim();
  const claims = await verifyJwt(token);
  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject) throw new AuthError("Access token has no subject.");
  const email = stringClaim(claims.email)?.trim().toLowerCase();
  if (allowedEmails.size > 0) {
    if (!email) throw new AuthError("This account does not have an email address available for LitlMatrix access.");
    if (!allowedEmails.has(email)) throw new AuthError("This email address is not authorized to use LitlMatrix.");
  }
  return { subject, email, name: stringClaim(claims.name) ?? stringClaim(claims.preferred_username) };
}

async function verifyJwt(token: string): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Malformed access token.");
  const header = JSON.parse(base64urlDecode(parts[0])) as { alg?: string; kid?: string };
  if (!header.kid || header.alg !== "RS256") throw new AuthError("Unsupported access-token signing configuration.");
  const jwks = await getJwks();
  const jwk = jwks.keys.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new AuthError("Signing key not found.");
  const publicKey = createPublicKey({ key: jwk as any, format: "jwk" });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  if (!verifySignature("RSA-SHA256", signed, publicKey, signature)) throw new AuthError("Invalid access token signature.");
  const claims = JSON.parse(base64urlDecode(parts[1])) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new AuthError("Access token is expired.");
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new AuthError("Access token is not active yet.");
  if (claims.iss !== issuer) throw new AuthError("Invalid token issuer.");
  if (audience) {
    const aud = claims.aud;
    const validAudience = Array.isArray(aud) ? aud.includes(audience) : aud === audience;
    if (!validAudience) throw new AuthError("Invalid token audience.");
  }
  return claims;
}

async function getJwks(): Promise<Jwks> {
  if (cachedJwks && cachedJwks.expiresAt > Date.now()) return cachedJwks.value;
  const response = await fetch(jwksUrl!);
  if (!response.ok) throw new AuthError("Unable to retrieve authentication signing keys.");
  const value = await response.json() as Jwks;
  if (!Array.isArray(value.keys)) throw new AuthError("Invalid JWKS response.");
  cachedJwks = { value, expiresAt: Date.now() + 10 * 60 * 1000 };
  return value;
}

function base64urlDecode(value: string) { return Buffer.from(value, "base64url").toString("utf8"); }
function stringClaim(value: unknown) { return typeof value === "string" ? value : undefined; }

export class AuthError extends Error { status = 401 as const; }

export function oauthProtectedResourceMetadata(baseUrl: string) {
  const authorizationServer = process.env.AUTH_AUTHORIZATION_SERVER?.trim() || issuer;
  return { resource: baseUrl, authorization_servers: authorizationServer ? [authorizationServer] : [], scopes_supported: (process.env.AUTH_SCOPES ?? "openid profile email").split(/\s+/).filter(Boolean), bearer_methods_supported: ["header"] };
}

export async function oauthAuthorizationServerMetadata() {
  const authorizationServer = process.env.AUTH_AUTHORIZATION_SERVER?.trim() || issuer || "";
  const authorizationEndpoint = process.env.AUTH_AUTHORIZATION_ENDPOINT?.trim() || `${authorizationServer}/oauth/authorize`;
  const tokenEndpoint = process.env.AUTH_TOKEN_ENDPOINT?.trim() || `${authorizationServer}/oauth/token`;
  const fallback = {
    issuer: authorizationServer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: (process.env.AUTH_SCOPES ?? "openid profile email").split(/\s+/).filter(Boolean),
  };

  // Prefer Clerk's live authorization-server metadata. This prevents our MCP
  // server from becoming stale when Clerk changes OAuth capabilities and, most
  // importantly, ensures clients can discover PKCE S256 directly from Clerk.
  if (!authorizationServer) return fallback;
  try {
    const response = await fetch(`${authorizationServer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return fallback;
    const metadata = await response.json() as Record<string, unknown>;
    const methods = Array.isArray(metadata.code_challenge_methods_supported)
      ? metadata.code_challenge_methods_supported.filter((value): value is string => typeof value === "string")
      : [];
    // ChatGPT requires an explicit S256 declaration for PKCE. Never pass through
    // incomplete upstream metadata without guaranteeing that declaration.
    return {
      ...fallback,
      ...metadata,
      code_challenge_methods_supported: methods.includes("S256") ? methods : ["S256", ...methods],
    };
  } catch {
    return fallback;
  }
}
