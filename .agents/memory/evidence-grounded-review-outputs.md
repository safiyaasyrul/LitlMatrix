---
name: Evidence-grounded review outputs
description: Guardrails for generated systematic-review claims and calculations.
---

Review outputs must distinguish imported citation metadata, recorded screening decisions, and verified full-text evidence. Never auto-include imported records or invent reviewer activity, full-text assessment, study characteristics, quality judgments, effect sizes, confidence intervals, heterogeneity, or significance. AI transport failures, malformed responses, and quota limits must leave affected records unresolved; they are not evidence for exclusion.

**Why:** Citation metadata and abstracts cannot establish those facts, and invented values can make a manuscript internally inconsistent and academically invalid.

**How to apply:** Derive counts from stored records and explicit decisions. Count only explicit negative decisions as exclusions, and preserve completed decisions when an AI batch stops. Use “not reported” for absent fields. Default heterogeneous evidence to narrative synthesis and require explicit comparable effect data before quantitative pooling.