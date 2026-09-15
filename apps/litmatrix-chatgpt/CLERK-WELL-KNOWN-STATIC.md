# OAuth discovery routing

The authorization-server metadata is intentionally published as the extensionless static file:
`public/.well-known/oauth-authorization-server`.

Vercel documents `/.well-known` as a reserved path that cannot be redirected or rewritten. The exact route therefore must not be routed through `vercel.json` rewrites. The exact response is given an explicit `application/json` Content-Type in `vercel.json`.

If Clerk metadata changes, update the static metadata file to match the live Clerk authorization-server metadata.
