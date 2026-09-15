# LitlMatrix MCP — Clerk official metadata helpers

This version uses Clerk's official `@clerk/mcp-tools/express` handlers for OAuth metadata discovery.

Required Vercel environment variable:

```text
CLERK_PUBLISHABLE_KEY=your Clerk publishable key
```

The `.well-known` endpoints are intentionally public. Do not put authentication middleware in front of them.

The MCP endpoint remains:

```text
https://litl-matrix-api-server.vercel.app/mcp
```

For ChatGPT manual OAuth settings, use Clerk's actual authorization and token endpoints because Clerk is the authorization server:

```text
https://loyal-gelding-9175.clerk.accounts.dev/oauth/authorize
https://loyal-gelding-9175.clerk.accounts.dev/oauth/token
```

The Clerk Dashboard should keep Public, Publish DCR support, and Require PKCE enabled.
