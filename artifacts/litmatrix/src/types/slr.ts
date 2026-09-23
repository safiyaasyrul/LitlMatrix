export interface SLRRecord {
  id: string;
  title: string;
  authors: string[];
  year: string;
  abstract: string;
  source: string;
  doi?: string;
  databaseSource?: "Scopus" | "Web of Science" | "PubMed" | "Google Scholar" | "IEEE Xplore" | "Cochrane" | "Other" | string;
  databaseSources?: string[];
  studyType?: string;
}

export type CitationStyle = "apa7" | "ieee" | "vancouver" | "harvard";

export interface ScreeningDecision {
  score: number | null; // 0 - 100
  reason: string;
  decision: "include" | "exclude";
  agreed?: boolean; // human confirmation
  exclusionReason?:
    | "Secondary literature / Review paper"
    | "Out of scope / Keyword mismatch"
    | "Wrong population"
    | "Wrong population/system"
    | "Wrong intervention"
    | "Wrong intervention / exposure"
    | "Wrong comparator"
    | "Wrong outcome"
    | "Wrong study design"
    | "Outside publication period"
    | "Not relevant to research question"
    | "Not accessible / full text unavailable"
    | "Duplicate"
    | "Duplicate / non-original"
    | "Language barrier"
    | "Other"
    | (string & {});
  exclusionNotes?: string;
}

export interface StudyCharacteristic {
  recordId: string;
  authorYear: string;
  category?: string; // e.g. Architecture, Domain, Algorithm Type
  country?: string;
  sampleSize?: string;
  population?: string;
  interventionOrFocus: string;
  comparator?: string;
  primaryOutcome: string;
  studyDesign?: string;
  keyFinding: string;
  acceptanceJustification?: string;
}

export type QualityAssessmentFrameworkType =
  | "engineering_rigor"
  | "threats_to_validity"
  | "clinical_rob2"
  | "custom_checklist";

export interface EngineeringQualityItem {
  recordId: string;
  authorYear: string;
  q1DesignSetup: "Met" | "Partially Met" | "Not Met" | "Low" | "Some concerns" | "High";
  q2DataAdequacy: "Met" | "Partially Met" | "Not Met" | "Low" | "Some concerns" | "High";
  q3MeasurementMethodology: "Met" | "Partially Met" | "Not Met" | "Low" | "Some concerns" | "High";
  q4BaselineValidation: "Met" | "Partially Met" | "Not Met" | "Low" | "Some concerns" | "High";
  q5RepeatabilityReproducibility: "Met" | "Partially Met" | "Not Met" | "Low" | "Some concerns" | "High";
  q6ModelAssumptionsValidity: "Met" | "Partially Met" | "Not Met" | "Low" | "Some concerns" | "High";
  q7ReportingCompleteness: "Met" | "Partially Met" | "Not Met" | "Low" | "Some concerns" | "High";
  overallQuality: "High Rigor" | "Moderate Rigor" | "Low Rigor" | "Low" | "Some concerns" | "High";
  justification: string;
}

export interface RiskOfBiasItem {
  recordId: string;
  authorYear: string;
  d1Selection: "Low" | "Some concerns" | "High" | "Met" | "Partially Met" | "Not Met";
  d2Performance: "Low" | "Some concerns" | "High" | "Met" | "Partially Met" | "Not Met";
  d3Attrition: "Low" | "Some concerns" | "High" | "Met" | "Partially Met" | "Not Met";
  d4Detection: "Low" | "Some concerns" | "High" | "Met" | "Partially Met" | "Not Met";
  d5Reporting: "Low" | "Some concerns" | "High" | "Met" | "Partially Met" | "Not Met";
  overall: "Low" | "Some concerns" | "High" | "High Rigor" | "Moderate Rigor" | "Low Rigor";
  justification: string;
}

export interface SynthesisCategory {
  name: string;
  recordIds: string[];
  summaryProse?: string;
  tableRows?: {
    authorYear: string;
    focus: string;
    keyFinding: string;
    method: string;
    effectEstimate?: string;
  }[];
  references?: string[];
  metaAnalysisData?: {
    pooledEstimate: string;
    ci95: string;
    iSquared: string;
    pVal: string;
    heterogeneityInterpretation: string;
    studies: { name: string; estimate: number; ciLow: number; ciHigh: number; weight: number }[];
  };
}

export interface SynthesisResult {
  suggestedTitle?: string;
  titleCandidates?: string[];
  titleCandidateEvidenceKey?: string;
  subtopics: {
    title: string;
    prose: string;
    supportingRecordIds?: string[];
  }[];
  keyFindingsTable: {
    topic: string;
    summary: string;
    consistency: string;
    evidenceBase: string;
  }[];
  forestPlotEstimates: {
    study: string;
    effectMeasure: string;
    effectSize: number;
    ciLower: number;
    ciUpper: number;
    weight?: number;
  }[];
  pooledEffectEstimate?: {
    effectMeasure: string;
    effectSize: number;
    ciLower: number;
    ciUpper: number;
    heterogeneityI2: string;
    tau2?: string;
  };
  heterogeneityDiscussion: string;
}

export interface GradeCertaintyItem {
  outcome: string;
  numStudies: number | string;
  studyDesign?: string;
  riskOfBias: "Not serious" | "Serious" | "Very serious" | string;
  inconsistency: "Not serious" | "Serious" | "Very serious" | string;
  indirectness: "Not serious" | "Serious" | "Very serious" | string;
  imprecision: "Not serious" | "Serious" | "Very serious" | string;
  publicationBias: "Undetected" | "Suspected" | "Strongly suspected" | string;
  overallCertainty: "High" | "Moderate" | "Low" | "Very Low" | string;
  importance: "Critical" | "Important" | "Not critical" | string;
  summaryOfFindings?: string;
  explanation: string;
}

export interface DiscussionSections {
  item23aGeneralInterpretation: string;
  item23bLimitationsOfEvidence: string;
  item23cLimitationsOfReviewProcess: string;
  item23dImplications: string;
}

export interface PrismaChecklistItem {
  section: "TITLE" | "ABSTRACT" | "INTRODUCTION" | "METHODS" | "RESULTS" | "DISCUSSION" | "OTHER";
  itemNumber: string; // e.g. "5", "6", "10a", "13b", "16a", "23a"
  topic: string;
  checklistDescription: string;
  appStageMapping: string;
  status: "Reported" | "Partially reported" | "Not reported" | "Not applicable";
  locationInReview: string;
  userNotes: string;
}

export interface PrismaSChecklistItem {
  domain: "INFORMATION_SOURCES" | "SEARCH_METHODS" | "MANAGING_RECORDS" | "REPRODUCIBILITY";
  itemNumber: string; // "1" to "16"
  topic: string;
  checklistDescription: string;
  appStageMapping: string;
  status: "Reported" | "Partially reported" | "Not reported" | "Not applicable";
  locationInReview: string;
  userNotes: string;
}

export interface RosesChecklistItem {
  section: "TITLE" | "ABSTRACT" | "INTRODUCTION" | "METHODS" | "RESULTS" | "DISCUSSION" | "FUNDING";
  itemNumber: string;
  topic: string;
  checklistDescription: string;
  rosesEmphasis: string; // e.g. "Environmental context", "Policy relevance", "Stakeholder implications", "Evidence mapping", "Quality appraisal across diverse study designs"
  appStageMapping: string;
  status: "Reported" | "Partially reported" | "Not reported" | "Not applicable";
  locationInReview: string;
  userNotes: string;
}

export type FormulationFrameworkType = "PICO" | "PICOC" | "PEO" | "SPIDER" | "SPICE" | "CIMO" | "CUSTOM" | "NONE";

export interface ObjectivesPICO {
  population: string;
  intervention: string;
  comparator: string;
  outcomes: string;
  studyDesigns: string;
}

export interface ObjectivesPICOC {
  population: string;
  intervention: string;
  comparison: string;
  outcomes: string;
  context: string;
  studyDesigns?: string;
}

export interface ObjectivesPEO {
  population: string;
  exposure: string;
  outcomes: string;
  setting?: string;
  studyDesigns?: string;
}

export interface ObjectivesSPIDER {
  sample: string;
  phenomenonOfInterest: string;
  design: string;
  evaluation: string;
  researchType: string;
}

export interface ObjectivesSPICE {
  setting: string;
  perspective: string;
  intervention: string;
  comparison: string;
  evaluation: string;
}

export interface ObjectivesCIMO {
  context: string;
  intervention: string;
  mechanisms: string;
  outcomes: string;
}

export interface ObjectivesCUSTOM {
  customFrameworkName: string;
  element1: string;
  element2: string;
  element3: string;
  element4: string;
  element5: string;
}

export interface SLRProtocol {
  // Items 1, 3 & 4 (Title, Rationale & Objectives)
  title: string;
  reviewType: string;
  formulationFramework?: FormulationFrameworkType;
  introductionRationale?: string;
  backgroundContext?: string;
  knowledgeGap?: string;
  primaryResearchQuestions?: string[];
  secondaryObjectives?: string[];
  protocolRegistration?: string;
  objectivesPICO: ObjectivesPICO;
  objectivesPICOC?: ObjectivesPICOC;
  objectivesPEO?: ObjectivesPEO;
  objectivesSPIDER?: ObjectivesSPIDER;
  objectivesSPICE?: ObjectivesSPICE;
  objectivesCIMO?: ObjectivesCIMO;
  objectivesCUSTOM?: ObjectivesCUSTOM;
  // Item 5 Eligibility
  eligibilityCriteria: {
    inclusion: string[];
    exclusion: string[];
    timeframe: string;
    language: string;
    groupingForSynthesis: string;
  };
  // Item 6 Information sources
  informationSources: {
    name: string;
    lastSearchedDate: string;
    urlOrHost: string;
    recordsRetrieved: number;
  }[];
  // Item 7 Search strategy
  searchStrategies: {
    database: string;
    query: string;
    filters: string;
  }[];
  // Item 8 Selection process
  selectionProcess: {
    numReviewers: number;
    independentScreening: boolean;
    disputeResolution: string;
    automationTools: string;
    screeningThreshold: number;
  };
  // Item 9 Data collection
  dataCollectionProcess: {
    numReviewers: number;
    independentExtraction: boolean;
    authorContactProcess: string;
    automationTools: string;
  };
  // Item 10 Data items
  dataItems: {
    outcomesSought: string;
    otherVariables: string;
    missingDataAssumptions: string;
  };
  // Item 11 RoB methods
  riskOfBiasMethods: {
    toolName: string;
    numReviewers: number;
    domainsAssessed: string;
    automationTools: string;
  };
  // Item 12 Effect measures
  effectMeasures: string;
  // Item 13 Synthesis methods
  synthesisMethods: {
    criteriaForEligibility: string;
    dataPreparation: string;
    visualDisplays: string;
    synthesisModel: string;
    heterogeneityExploration: string;
    sensitivityAnalysis: string;
  };
  // Item 14 Reporting bias
  reportingBiasMethods: string;
  // Item 15 Certainty assessment
  certaintyMethods: string;
}

export interface PrismaDatabaseSource {
  name: string;
  recordsIdentified: number;
}

export interface PrismaExclusionReasonItem {
  reason: string;
  count: number;
}

export interface PrismaEvidenceLimits {
  maximumEvidencePool: number;
  maximumCharacteristics: number;
  maximumThematicAnalysis: number;
  maximumSynthesis: number;
}

export interface PrismaAuditTrailEntry {
  field: string;
  label: string;
  value: number | string | null;
  source: string;
  details: string;
  timestamp?: string;
}

export interface PrismaFlowData {
  reviewId: string;
  identification: {
    databases: PrismaDatabaseSource[];
    otherSources: number;
  };
  removedBeforeScreening: {
    duplicates: number;
    automation: number;
    otherReasons: number;
  };
  screening: {
    recordsScreened: number;
    recordsExcluded: number;
    unresolved?: number;
  };
  eligibility: {
    reportsSought: number | null;
    reportsNotRetrieved: number | null;
    reportsAssessed: number | null;
    reportsExcluded: number;
    exclusionReasons: PrismaExclusionReasonItem[];
  };
  included: {
    studiesIncluded: number;
    studiesIncludedInSynthesis: number;
    studiesIncludedInMetaAnalysis?: number | null;
  };
  evidenceLimits: PrismaEvidenceLimits;
  manualOverrides?: Partial<{
    databases: PrismaDatabaseSource[];
    otherSources: number;
    duplicates: number;
    automation: number;
    otherReasons: number;
    recordsScreened: number;
    recordsExcluded: number;
    reportsSought: number | null;
    reportsNotRetrieved: number | null;
    reportsAssessed: number | null;
    reportsExcluded: number;
    exclusionReasons: PrismaExclusionReasonItem[];
    studiesIncluded: number;
    studiesIncludedInSynthesis: number;
    studiesIncludedInMetaAnalysis: number | null;
  }>;
  auditTrail?: Record<string, PrismaAuditTrailEntry>;
}
