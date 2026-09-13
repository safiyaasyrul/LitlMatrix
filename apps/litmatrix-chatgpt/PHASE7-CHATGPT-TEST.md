# LitlMatrix Phase 7 — ChatGPT connection test

Phase 7 hardens the deployment/test path. It does not invent an identity provider or issue OAuth tokens. Configure an approved OAuth 2.1/OIDC provider.

## 1. Start PostgreSQL + MCP locally

```bash
docker compose up --build -d
```

Do not expose a public service with `ALLOW_ANONYMOUS_DEV=true`.

## 2. Configure OAuth

Set the values in `.env` for `DATABASE_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_AUTHORIZATION_SERVER`, `AUTH_AUTHORIZATION_ENDPOINT`, `AUTH_TOKEN_ENDPOINT`, `AUTH_SCOPES`, and `ALLOWED_ORIGIN`.

The access token must be RS256-signed and contain valid `iss`, `aud`, `sub`, and `exp` claims. The matching public key must be published through the configured JWKS URL.

## 3. Smoke test

```bash
node scripts-smoke-test.mjs https://YOUR-DOMAIN
```

Expected:
- `/healthz` → 200
- `/.well-known/oauth-protected-resource` → 200
- `/.well-known/oauth-authorization-server` → 200
- `/mcp` without a token → 401

## 4. Ownership isolation

Use two different test identities. With identity A, create a review and note its `reviewId`. With identity B, attempt to use identity A's `reviewId`.

Expected: `Review <id> not found for this user.`

Identity B must never receive A's records, decisions, characteristics, protocol, or manuscript evidence package.

## 5. Connect to ChatGPT

Use the current ChatGPT developer/app tooling to add:

`https://YOUR-DOMAIN/mcp`

Complete the OAuth consent flow when ChatGPT requests authorization.

## 6. First end-to-end test

Start with 5–10 Scopus/WoS records and verify:

1. LitlMatrix opens inside ChatGPT.
2. CSV/RIS/BibTeX upload works.
3. A review is created for the authenticated user.
4. Records persist in PostgreSQL.
5. Evidence selection is deterministic.
6. Screening batches contain at most 4 unresolved records.
7. No external literature is introduced.
8. The manuscript package reports the evidence limits.
9. Restarting the MCP container does not delete the review.
10. A second user cannot access the first user's review.

Only after these checks pass should you test a 200-record review.
