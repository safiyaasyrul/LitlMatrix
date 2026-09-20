# LitlMatrix GPT Actions setup

This adds a REST/OpenAPI layer for a custom GPT while keeping the existing MCP endpoint intact.

## 1. Deploy

Use the existing Vercel project with root directory `apps/litmatrix-chatgpt`.

The deployment must keep these environment variables:
- `DATABASE_URL`
- `AUTH_ISSUER`
- `AUTH_JWKS_URL`
- `AUTH_AUTHORIZATION_SERVER`
- `AUTH_AUTHORIZATION_ENDPOINT`
- `AUTH_TOKEN_ENDPOINT`
- `AUTH_SCOPES`
- `LITMATRIX_ALLOWED_EMAILS`
- `ALLOW_ANONYMOUS_DEV=false`

## 2. OpenAPI URL

After deployment, the action schema is public at:

`https://litl-matrix-api-server-bpjcqoa9q-wannurdiyana-5641s-projects.vercel.app/openapi.json`

The API operations are under `/actions/*`.

## 3. Create the GPT Action

In the GPT editor:
1. Open the GPT you created.
2. Go to **Configure**.
3. Find **Actions**.
4. Choose **Create new action**.
5. Import the OpenAPI schema from the URL above, or paste its JSON.
6. Choose **OAuth** authentication.
7. Enter the Clerk OAuth application's Client ID and Client Secret.
8. Authorization URL:
   `https://loyal-gelding-9175.clerk.accounts.dev/oauth/authorize`
9. Token URL:
   `https://loyal-gelding-9175.clerk.accounts.dev/oauth/token`
10. Scope:
    `openid profile email offline_access`
11. Use the token exchange method required by the GPT editor (normally the standard authorization-code flow).

## 4. Clerk callback URL

The GPT Action editor will display a callback/redirect URL. Add that exact URL to the allowed redirect URIs for the Clerk OAuth application. Do not guess the callback URL.

## 5. GPT behavior

The GPT should:
- use LitlMatrix actions for review state and evidence operations;
- use only researcher-supplied Scopus/WoS records;
- never add external papers or fabricated citations;
- use deterministic LitlMatrix evidence selection;
- respect 100-record introduction/context and 100-record detailed evidence limits;
- never claim to have analyzed more records than an action actually returned;
- use the four supported citation styles: APA 7th, IEEE, Vancouver, Harvard.

## Important

A GPT cannot use Apps and Actions at the same time. This route is specifically for the custom GPT Action path.
