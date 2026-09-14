# LitlMatrix ChatGPT App — Phase 7

Phase 7 hardens the ChatGPT/MCP deployment path and adds a repeatable connection smoke test.

## Architecture

- ChatGPT is the AI reasoning host.
- LitlMatrix is the evidence/workflow layer.
- Researcher-supplied Scopus/WoS records are the evidence universe.
- PostgreSQL stores user-scoped review state.
- OAuth/JWT identifies the review owner.
- No researcher AI API key is required for the LitlMatrix workflow.

## Evidence controls

- Up to 200 imported records.
- Up to 100 introduction/context records.
- Up to 50 detailed records for title/results/characteristics/synthesis/discussion.
- Screening is returned in batches of at most 4 unresolved records.
- No external literature is added by the MCP server.

## Phase 7 hardening

- `/healthz` checks PostgreSQL availability.
- CORS is deny-by-default unless `ALLOWED_ORIGIN` is explicitly configured.
- Additional browser security headers are set.
- Graceful shutdown closes the HTTP server and PostgreSQL pool.
- A smoke-test script checks health, OAuth discovery, and unauthenticated MCP rejection.
- A Docker Compose file provides a local PostgreSQL + MCP test environment.
- `PHASE7-CHATGPT-TEST.md` gives the multi-user and ChatGPT connection test sequence.

## Authentication

This service is an OAuth/JWT resource server. It does not issue access tokens. Configure an approved OIDC/OAuth provider and make sure its access tokens are RS256-signed with matching issuer, audience, subject, expiry, and JWKS values.

Do not enable `ALLOW_ANONYMOUS_DEV` on a public deployment.


### Restrict access to specific researchers

Set `LITMATRIX_ALLOWED_EMAILS` to a comma-separated list of exact email addresses. If it is non-empty, only those authenticated email addresses can use the MCP server. Matching is case-insensitive.

## GPT Actions

For a custom GPT, use the GPT Actions REST layer. Import this OpenAPI schema in the GPT editor:

`https://litl-matrix-api-server-bpjcqoa9q-wannurdiyana-5641s-projects.vercel.app/openapi.json`

See `GPT-ACTIONS-SETUP.md` for OAuth and Clerk setup.
