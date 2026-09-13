# LitlMatrix ChatGPT App — Phase 5 deployment

## What Phase 5 adds

- `/healthz` health endpoint.
- Root service metadata at `/`.
- Configurable host/port and browser CORS origin.
- Basic HTTP security headers.
- 24-hour in-process review expiry to prevent unbounded memory growth.
- Duplicate record suppression during import using DOI or title/year.
- Dockerfile for a long-running MCP service.

## Architecture

The ChatGPT host is the AI reasoning layer. LitlMatrix is the evidence/workflow layer. The MCP server does not call Gemini, OpenAI, OpenRouter, or another model provider on behalf of the researcher.

## Testing deployment

The MCP endpoint must be publicly reachable over HTTPS for a hosted ChatGPT integration. Use:

`https://YOUR-DOMAIN/mcp`

Health check:

`https://YOUR-DOMAIN/healthz`

## Security before public release

The Phase 5 server is suitable for controlled development/testing but should **not** be treated as a public multi-user production service yet. The current review store is process memory. It is deliberately bounded by a 24-hour TTL, but it is not durable or user-isolated across multiple server instances.

Before public release:

1. Add OAuth 2.1 / MCP authorization and validate the authenticated user on every protected tool.
2. Replace the in-memory Map with durable, user-scoped storage.
3. Bind every review ID to the authenticated user.
4. Add request size/rate limits at the hosting layer.
5. Add audit logging without storing unnecessary manuscript content.
6. Use HTTPS only.

MCP Apps authorization documentation describes per-server and per-tool OAuth approaches and requires protected-resource metadata and token verification for protected servers.

## ChatGPT testing

For development, expose `/mcp` through an HTTPS development endpoint and add that MCP server using the current ChatGPT developer/app tooling. Do not publish an unauthenticated production endpoint.


## Phase 6: Authentication + persistent storage

Phase 6 requires a PostgreSQL database and an OAuth/JWT identity provider. The `/mcp` endpoint returns HTTP 401 when a Bearer token is missing or invalid. The service exposes MCP authorization discovery metadata at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

Configure `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URL` to match the access tokens issued for this MCP resource. Configure the authorization and token endpoint variables so the MCP host can discover the OAuth flow.

Each review is stored with the authenticated token subject and can only be loaded by that same subject. The service no longer relies on the process-memory review `Map`, so a restart or a second application instance does not erase review state.

Before public launch, verify:

1. The identity provider signs access tokens with RS256 and publishes the matching JWKS.
2. The `aud` claim is the LitlMatrix MCP resource audience.
3. `ALLOW_ANONYMOUS_DEV=false`.
4. PostgreSQL backups and encryption-at-rest meet your institutional requirements.
5. HTTPS is enforced at the deployment/proxy layer.
6. Two different test users cannot read each other's `reviewId`.
