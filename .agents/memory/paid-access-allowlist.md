---
name: Paid access by email allowlist
description: The chosen access model for paid PRISMA Workbench customers.
---

Grant paid-app access through an owner-managed allowlist matched against each signed-in user's verified primary email. Keep non-allowlisted accounts pending.

**Why:** The owner chose to confirm payment separately and manually add or remove each permitted customer instead of connecting an automatic billing provider.

**How to apply:** Preserve server-side allowlist enforcement for the workbench, stored review data, and managed-AI endpoints. Do not replace it with client-only checks or automatic payment entitlements unless the owner changes the sales process.