---
name: Citation and PRISMA export contract
description: Manuscript citation styles and adapted PRISMA exports share one derived evidence/count model across preview and downloads.
---

Use a single persisted citation-style setting for APA 7th, IEEE, Vancouver, and Harvard. Keep evidence relationships record-ID based and apply citation formatting only at render/export time; numeric reference order follows the final included-record order, and references never include excluded or unresolved records.

Use one adapted PRISMA SVG generator for the on-screen diagram, downloadable image/SVG, Markdown representation, print view, and embedded DOCX image. The flow must reconcile deduplicated records as included + excluded + unresolved and must not add full-text stages when the app does not perform them.

**Why:** Citation style changes must not trigger AI regeneration, and duplicated export-specific formatting or flow arithmetic can drift between preview and downloaded manuscripts.

**How to apply:** When adding manuscript sections or export formats, consume the central citation formatter and shared PRISMA SVG/count utilities rather than recreating author-year strings, reference lists, or diagram counts locally.