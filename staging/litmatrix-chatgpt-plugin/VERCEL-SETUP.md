# Vercel deployment

Root Directory: `apps/litmatrix-chatgpt`

Build Command: `npm run build`
Output Directory: `dist`
Install Command: `npm install`

Required runtime environment variables before production use:
- `DATABASE_URL`
- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_JWKS_URL`
- `AUTH_AUTHORIZATION_SERVER`
- `AUTH_AUTHORIZATION_ENDPOINT`
- `AUTH_TOKEN_ENDPOINT`
- `AUTH_SCOPES` (optional)
- `ALLOWED_ORIGIN` (optional; comma-separated allowed origins)
- `ALLOW_ANONYMOUS_DEV=false`

The MCP endpoint is `/mcp`. Health check is `/healthz`.
