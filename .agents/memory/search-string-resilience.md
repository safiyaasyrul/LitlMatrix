---
name: Search-string resilience
description: Reliability rules for generating database-specific systematic-review search queries.
---

Database search-string generation must not depend entirely on a correctly formatted AI response. Accept common wrapped JSON shapes, normalize supported database names, fill missing strategies, and provide deterministic database-specific queries when AI output is malformed or unavailable.

**Why:** AI requests can succeed at the transport level while returning empty, wrapped, partial, or unparsable content. Silently ignoring that response leaves users with no search strings and no explanation.

**How to apply:** Always produce editable queries from accepted keywords and selected limits, preserve valid AI-generated entries where possible, and show whether the result came from AI or the deterministic fallback.