---
name: Narrative-first review workflow
description: Durable scope decision for the review workbench's default methodology and user-facing workflow.
---

The workbench defaults to PRISMA 2020 reporting, clear research questions, PICO/PICOC-style eligibility, database-specific searches, deduplication, title/abstract/metadata screening, explicit criteria, an audit trail, study-characteristics extraction, narrative/thematic synthesis, limitations, references, and evidence-based conclusions. Formal meta-analysis, forest plots, GRADE, sophisticated risk-of-bias tools, elaborate evidence hierarchies, computational benchmarking, exaggerated impact language, and elaborate quality scoring are not forced.

**Why:** Heterogeneous records and citation-level evidence do not support automatic pooled effects, certainty ratings, or quality judgments without explicit, comparable source data and a user-selected method.

**How to apply:** Keep optional quantitative or appraisal data structures only for compatibility when useful, but do not expose them as required workflow stages, generate them automatically, or present them as manuscript conclusions.

Narrative and thematic synthesis must carry every final included record forward; do not impose a record-count subset on the writing pass or silently omit included studies.

**Why:** A capped writing subset can produce themes and conclusions that do not represent the final included evidence set, even when PRISMA counts and references remain complete.

**How to apply:** Preserve complete included-record accounting in synthesis prompts, fallbacks, evidence matrices, manuscript sections, and exports. Use bounded per-record representations or multi-pass processing when request size requires it, never a first-N record cap.