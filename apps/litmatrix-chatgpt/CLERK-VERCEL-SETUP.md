# Clerk + Vercel setup

The LitlMatrix MCP server uses Clerk as the OAuth authorization server and Neon PostgreSQL for persistent review state.

## Vercel environment variables

Add these to **Production** and **Preview**:

- `DATABASE_URL` = your Neon connection string
- `AUTH_ISSUER` = `https://YOUR-CLERK-DOMAIN.clerk.accounts.dev`
- `AUTH_JWKS_URL` = `https://YOUR-CLERK-DOMAIN.clerk.accounts.dev/.well-known/jwks.json`
- `AUTH_AUTHORIZATION_SERVER` = `https://YOUR-CLERK-DOMAIN.clerk.accounts.dev`
- `AUTH_AUTHORIZATION_ENDPOINT` = `https://YOUR-CLERK-DOMAIN.clerk.accounts.dev/oauth/authorize`
- `AUTH_TOKEN_ENDPOINT` = `https://YOUR-CLERK-DOMAIN.clerk.accounts.dev/oauth/token`
- `AUTH_SCOPES` = `openid profile email offline_access`
- `PUBLIC_MCP_BASE_URL` = `https://litl-matrix-api-server.vercel.app`
- `ALLOW_ANONYMOUS_DEV` = `false`
- `ALLOWED_ORIGIN` = your public Vercel origin (for example `https://litmatrix-chatgpt.vercel.app`)

Do **not** add `AUTH_AUDIENCE` unless you have deliberately configured an OAuth audience and want strict audience checking. The server always validates the token issuer, signature, expiry and not-before claims.

## Clerk settings

- Dynamic Client Registration: enabled if ChatGPT requires DCR.
- Consent screen: enabled.
- Default scopes: `openid profile email`.
- `offline_access` may remain selected; Clerk may include it automatically for some OAuth client configurations.

## After deployment

1. Open `/healthz` and confirm `ok: true`, `databaseHealthy: true`, and `authConfigured: true`.
2. Open `/.well-known/oauth-protected-resource` and verify that the authorization server points to your Clerk domain.
3. Open `/.well-known/oauth-authorization-server` and verify Clerk authorize/token endpoints.
4. Connect the HTTPS `/mcp` endpoint from ChatGPT's MCP/developer connection UI.
5. Complete the Clerk consent flow.
6. Call `litmatrix_start_review` and confirm a review is stored under the authenticated Clerk `sub`.


## Exact email allowlist

LitlMatrix can be restricted to specific authenticated email addresses. Set the Vercel environment variable `LITMATRIX_ALLOWED_EMAILS` to a comma-separated list of exact email addresses, for example:

```text
researcher1@umt.edu.my,researcher2@umt.edu.my
```

Email matching is case-insensitive and whitespace is ignored. When this variable contains one or more addresses, an authenticated user must have an `email` claim in the access token and that exact normalized address must be present in the allowlist. Users who are not on the list receive HTTP 401. Leave the variable empty only if you intentionally want any authenticated Clerk user to access the service.

For Vercel, add `LITMATRIX_ALLOWED_EMAILS` under Production and Preview. Do not put secrets or passwords in this variable.

## OAuth facade for ChatGPT MCP

LitlMatrix exposes an RFC 8414 authorization-server facade on its own production origin. The facade advertises `code_challenge_methods_supported: ["S256"]` and proxies `/oauth/authorize`, `/oauth/token`, `/oauth/register`, and `/oauth/revoke` to the Clerk authorization service. This keeps the issuer and discovery metadata on the same origin, while Clerk remains the identity and OAuth provider.
