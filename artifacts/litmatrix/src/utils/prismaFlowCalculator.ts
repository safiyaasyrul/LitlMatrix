import {
  SLRRecord,
  ScreeningDecision,
  StudyCharacteristic,
  SynthesisResult,
  PrismaFlowData,
  PrismaDatabaseSource,
  PrismaExclusionReasonItem,
  PrismaAuditTrailEntry,
} from "../types/slr";

export interface ValidationIssue {
  field: string;
  type: "error" | "warning";
  message: string;
}

export interface CalculatePrismaFlowOptions {
  records: SLRRecord[];
  dupesRemoved?: number;
  screening?: Record<string, ScreeningDecision>;
  characteristics?: StudyCharacteristic[];
  synthesis?: SynthesisResult;
  manualOverrides?: PrismaFlowData["manualOverrides"];
  reviewId?: string;
  defaultSource?: string;
}

/**
 * Standard PRISMA 2020 validation rules.
 */
export function validatePrismaFlowData(data: PrismaFlowData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const totalDbRecords = data.identification.databases.reduce(
    (sum, db) => sum + Math.max(0, db.recordsIdentified || 0),
    0
  );
  const otherSources = Math.max(0, data.identification.otherSources || 0);
  const totalIdentified = totalDbRecords + otherSources;

  const duplicates = Math.max(0, data.removedBeforeScreening.duplicates || 0);
  const automation = Math.max(0, data.removedBeforeScreening.automation || 0);
  const otherReasons = Math.max(0, data.removedBeforeScreening.otherReasons || 0);
  const totalRemoved = duplicates + automation + otherReasons;

  const screened = data.screening.recordsScreened;
  const screenedExcluded = data.screening.recordsExcluded;

  // Rule 1: Non-negative numbers
  if (totalIdentified < 0) {
    issues.push({ field: "identification", type: "error", message: "Identified records count cannot be negative." });
  }
  if (totalRemoved < 0) {
    issues.push({ field: "removedBeforeScreening", type: "error", message: "Removed records count cannot be negative." });
  }
  if (screened < 0) {
    issues.push({ field: "recordsScreened", type: "error", message: "Screened records count cannot be negative." });
  }
  if (screenedExcluded < 0) {
    issues.push({ field: "recordsExcluded", type: "error", message: "Excluded records count cannot be negative." });
  }

  // Rule 2: recordsScreened cannot exceed records after deduplication
  const recordsAfterDedup = Math.max(0, totalIdentified - totalRemoved);
  if (screened > recordsAfterDedup && totalIdentified > 0) {
    issues.push({
      field: "recordsScreened",
      type: "error",
      message: `Records screened (${screened}) cannot exceed records after deduplication (${recordsAfterDedup}).`,
    });
  }

  // Rule 3: recordsExcluded cannot exceed recordsScreened
  if (screenedExcluded > screened) {
    issues.push({
      field: "recordsExcluded",
      type: "error",
      message: `Screening exclusions (${screenedExcluded}) cannot exceed screened records (${screened}).`,
    });
  }

  // Rule 4: Eligibility assessments
  const { reportsSought, reportsNotRetrieved, reportsAssessed, reportsExcluded } = data.eligibility;
  if (reportsSought !== null && reportsSought < 0) {
    issues.push({ field: "reportsSought", type: "error", message: "Reports sought for retrieval cannot be negative." });
  }
  if (reportsNotRetrieved !== null && reportsNotRetrieved < 0) {
    issues.push({ field: "reportsNotRetrieved", type: "error", message: "Reports not retrieved cannot be negative." });
  }
  if (reportsAssessed !== null && reportsAssessed < 0) {
    issues.push({ field: "reportsAssessed", type: "error", message: "Reports assessed cannot be negative." });
  }
  if (reportsSought !== null && reportsAssessed !== null && reportsAssessed > reportsSought) {
    issues.push({
      field: "reportsAssessed",
      type: "error",
      message: `Reports assessed for eligibility (${reportsAssessed}) cannot exceed reports sought (${reportsSought}).`,
    });
  }

  // Rule 5: Included studies cannot exceed reports assessed when eligibility assessment is used
  const { studiesIncluded, studiesIncludedInSynthesis } = data.included;
  if (studiesIncluded < 0) {
    issues.push({ field: "studiesIncluded", type: "error", message: "Studies included cannot be negative." });
  }
  if (reportsAssessed !== null && studiesIncluded > reportsAssessed) {
    issues.push({
      field: "studiesIncluded",
      type: "error",
      message: `Studies included (${studiesIncluded}) cannot exceed reports assessed for eligibility (${reportsAssessed}).`,
    });
  }

  // Rule 6: Synthesis count cannot exceed included studies
  if (studiesIncludedInSynthesis < 0) {
    issues.push({ field: "studiesIncludedInSynthesis", type: "error", message: "Synthesis studies cannot be negative." });
  }
  if (studiesIncludedInSynthesis > studiesIncluded) {
    issues.push({
      field: "studiesIncludedInSynthesis",
      type: "error",
      message: `Studies in synthesis (${studiesIncludedInSynthesis}) cannot exceed included studies (${studiesIncluded}).`,
    });
  }

  // Rule 7: Evidence pool and thematic limits
  if (data.evidenceLimits.maximumEvidencePool > 100) {
    issues.push({ field: "maximumEvidencePool", type: "warning", message: "Evidence pool limit exceeds standard maximum of 100." });
  }
  if (data.evidenceLimits.maximumThematicAnalysis > 100) {
    issues.push({ field: "maximumThematicAnalysis", type: "warning", message: "Thematic analysis limit exceeds standard maximum of 100." });
  }

  return issues;
}

/**
 * Deterministically compute the PRISMA 2020 Flow Data from review workspace entities.
 * Preserves true nulls for unperformed stages and establishes complete audit trail traceability.
 */
export function calculatePrismaFlowData(options: CalculatePrismaFlowOptions): PrismaFlowData {
  const {
    records = [],
    dupesRemoved = 0,
    screening = {},
    characteristics = [],
    synthesis,
    manualOverrides,
    reviewId = "lm_review",
    defaultSource = "Scopus",
  } = options;

  const nowIso = new Date().toISOString();
  const auditTrail: Record<string, PrismaAuditTrailEntry> = {};

  // 1. Identification Stage
  // Group records by databaseSource
  const databaseCounts = new Map<string, number>();
  records.forEach((rec) => {
    const rawSources = rec.databaseSources?.length
      ? rec.databaseSources
      : [rec.databaseSource || defaultSource];

    rawSources.forEach((src) => {
      const cleanSrc = src.trim() || defaultSource;
      databaseCounts.set(cleanSrc, (databaseCounts.get(cleanSrc) || 0) + 1);
    });
  });

  // If no records exist yet, provide default zero entry
  let databases: PrismaDatabaseSource[] = [];
  if (databaseCounts.size > 0) {
    databases = Array.from(databaseCounts.entries()).map(([name, count]) => ({
      name,
      recordsIdentified: count + (databases.length === 0 ? dupesRemoved : 0),
    }));
  } else {
    databases = [{ name: defaultSource, recordsIdentified: 0 }];
  }

  // Apply manual database overrides if supplied
  if (manualOverrides?.databases && manualOverrides.databases.length > 0) {
    databases = manualOverrides.databases;
  }

  const otherSources = manualOverrides?.otherSources !== undefined
    ? manualOverrides.otherSources
    : 0;

  const totalIdentifiedDb = databases.reduce((sum, db) => sum + db.recordsIdentified, 0);
  const totalIdentified = totalIdentifiedDb + otherSources;

  auditTrail["identification"] = {
    field: "identification",
    label: "Records Identified from Databases & Registers",
    value: totalIdentified,
    source: "Bibliographic Import",
    details: `${databases.map((d) => `${d.name}: ${d.recordsIdentified}`).join(", ")}${otherSources > 0 ? `, Other Sources: ${otherSources}` : ""}`,
    timestamp: nowIso,
  };

  // 2. Removed Before Screening
  const duplicates = manualOverrides?.duplicates !== undefined
    ? manualOverrides.duplicates
    : dupesRemoved;
  const automation = manualOverrides?.automation !== undefined
    ? manualOverrides.automation
    : 0;
  const otherReasons = manualOverrides?.otherReasons !== undefined
    ? manualOverrides.otherReasons
    : 0;

  auditTrail["duplicatesRemoved"] = {
    field: "duplicatesRemoved",
    label: "Duplicate Records Removed",
    value: duplicates,
    source: "Deduplication Pipeline",
    details: `${duplicates} duplicate citations detected and removed prior to title/abstract screening.`,
    timestamp: nowIso,
  };

  // 3. Screening Stage
  const rawScreened = records.length;
  const recordsScreened = manualOverrides?.recordsScreened !== undefined
    ? manualOverrides.recordsScreened
    : rawScreened;

  // Screening exclusions
  const screeningExcludedRecords = records.filter(
    (rec) => screening[rec.id]?.agreed === false || screening[rec.id]?.decision === "exclude"
  );
  const recordsExcluded = manualOverrides?.recordsExcluded !== undefined
    ? manualOverrides.recordsExcluded
    : screeningExcludedRecords.length;

  // Included after screening
  const screeningIncludedRecords = records.filter(
    (rec) => screening[rec.id]?.agreed === true || (screening[rec.id]?.decision === "include" && screening[rec.id]?.agreed !== false)
  );

  const unresolved = Math.max(0, recordsScreened - (screeningIncludedRecords.length + recordsExcluded));

  auditTrail["recordsScreened"] = {
    field: "recordsScreened",
    label: "Records Screened (Title / Abstract)",
    value: recordsScreened,
    source: "Screening Ledger",
    details: `${recordsScreened} records evaluated against protocol eligibility criteria.`,
    timestamp: nowIso,
  };

  auditTrail["recordsExcluded"] = {
    field: "recordsExcluded",
    label: "Records Excluded at Screening",
    value: recordsExcluded,
    source: "Screening Decisions",
    details: `${recordsExcluded} records marked as ineligible during title/abstract review.`,
    timestamp: nowIso,
  };

  // Aggregate exclusion reasons from actual screening decisions
  const reasonsMap = new Map<string, number>();
  screeningExcludedRecords.forEach((rec) => {
    const reason = screening[rec.id]?.exclusionReason || "Other / Out of scope";
    reasonsMap.set(reason, (reasonsMap.get(reason) || 0) + 1);
  });

  const exclusionReasons: PrismaExclusionReasonItem[] = manualOverrides?.exclusionReasons !== undefined
    ? manualOverrides.exclusionReasons
    : Array.from(reasonsMap.entries()).map(([reason, count]) => ({ reason, count }));

  // 4. Eligibility Stage
  // Methodological rule: distinguish between evidence budget capping vs actual full-text eligibility screening
  const reportsSought = manualOverrides?.reportsSought !== undefined
    ? manualOverrides.reportsSought
    : null;
  const reportsNotRetrieved = manualOverrides?.reportsNotRetrieved !== undefined
    ? manualOverrides.reportsNotRetrieved
    : null;
  const reportsAssessed = manualOverrides?.reportsAssessed !== undefined
    ? manualOverrides.reportsAssessed
    : null;
  const reportsExcluded = manualOverrides?.reportsExcluded !== undefined
    ? manualOverrides.reportsExcluded
    : (manualOverrides?.reportsAssessed !== null && manualOverrides?.reportsAssessed !== undefined
        ? Math.max(0, (manualOverrides.reportsAssessed || 0) - (manualOverrides.studiesIncluded || 0))
        : 0);

  auditTrail["eligibility"] = {
    field: "eligibility",
    label: "Eligibility & Full-Text Retrieval",
    value: reportsAssessed,
    source: reportsAssessed !== null ? "Full-Text Eligibility Ledger" : "Not Performed / Title-Abstract Bounded",
    details: reportsAssessed !== null
      ? `Reports sought: ${reportsSought}, Not retrieved: ${reportsNotRetrieved}, Assessed: ${reportsAssessed}, Excluded: ${reportsExcluded}`
      : "Full-text retrieval was not separately conducted; screening was completed at title/abstract level.",
    timestamp: nowIso,
  };

  // 5. Included Stage
  const studiesIncluded = manualOverrides?.studiesIncluded !== undefined
    ? manualOverrides.studiesIncluded
    : screeningIncludedRecords.length;

  // Up to 100 studies in qualitative / thematic synthesis
  const maximumEvidenceLimit = 100;
  const actualSynthesisCount = Math.min(
    studiesIncluded,
    maximumEvidenceLimit,
    manualOverrides?.studiesIncludedInSynthesis !== undefined
      ? manualOverrides.studiesIncludedInSynthesis
      : (synthesis?.keyFindingsTable?.length || characteristics.length || studiesIncluded)
  );

  const studiesIncludedInSynthesis = manualOverrides?.studiesIncludedInSynthesis !== undefined
    ? manualOverrides.studiesIncludedInSynthesis
    : actualSynthesisCount;

  const hasMetaAnalysis = Boolean(
    synthesis?.forestPlotEstimates?.length || synthesis?.pooledEffectEstimate
  );
  const studiesIncludedInMetaAnalysis = manualOverrides?.studiesIncludedInMetaAnalysis !== undefined
    ? manualOverrides.studiesIncludedInMetaAnalysis
    : (hasMetaAnalysis ? (synthesis?.forestPlotEstimates?.length ?? null) : null);

  auditTrail["studiesIncluded"] = {
    field: "studiesIncluded",
    label: "Studies Included in Systematic Review",
    value: studiesIncluded,
    source: "Inclusion Criteria & Final Screening Set",
    details: `${studiesIncluded} unique studies met all inclusion criteria.`,
    timestamp: nowIso,
  };

  auditTrail["studiesIncludedInSynthesis"] = {
    field: "studiesIncludedInSynthesis",
    label: "Studies in Thematic / Qualitative Synthesis",
    value: studiesIncludedInSynthesis,
    source: "Synthesis Evidence Pool (Max 100)",
    details: `${studiesIncludedInSynthesis} studies selected into the bounded qualitative synthesis set.`,
    timestamp: nowIso,
  };

  return {
    reviewId,
    identification: {
      databases,
      otherSources,
    },
    removedBeforeScreening: {
      duplicates,
      automation,
      otherReasons,
    },
    screening: {
      recordsScreened,
      recordsExcluded,
      unresolved,
    },
    eligibility: {
      reportsSought,
      reportsNotRetrieved,
      reportsAssessed,
      reportsExcluded,
      exclusionReasons,
    },
    included: {
      studiesIncluded,
      studiesIncludedInSynthesis,
      studiesIncludedInMetaAnalysis,
    },
    evidenceLimits: {
      maximumEvidencePool: 100,
      maximumCharacteristics: 100,
      maximumThematicAnalysis: 100,
      maximumSynthesis: 100,
    },
    manualOverrides,
    auditTrail,
  };
}
