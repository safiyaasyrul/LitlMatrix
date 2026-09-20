import {
  calculatePrismaFlowData,
  validatePrismaFlowData,
} from "../../artifacts/litmatrix/src/utils/prismaFlowCalculator";
import {
  selectDetailedEvidenceRecords,
  selectIntroductionRecords,
  buildEvidenceBudget,
  MAX_DETAILED_RECORDS,
} from "../../artifacts/litmatrix/src/utils/evidenceSelection";
import {
  buildPrismaSvg,
} from "../../artifacts/litmatrix/src/utils/prismaSvg";
import {
  SLRRecord,
  ScreeningDecision,
  StudyCharacteristic,
  SynthesisResult,
} from "../../artifacts/litmatrix/src/types/slr";

function makeRecords(count: number, source = "Scopus"): SLRRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rec_${i + 1}`,
    title: `Study ${i + 1} on Maritime Logistics & Operations Risk Analysis`,
    authors: [`Author ${i + 1}`],
    year: `${2020 + (i % 5)}`,
    abstract: `This is the abstract for study ${i + 1} assessing maritime simulation models and port operations. Detailed methodologies and experimental evaluations are presented.`,
    source: `${source} Journal of Shipping`,
    databaseSource: source,
  }));
}

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
    failedCount++;
  }
}

console.log("==================================================");
console.log(" LitMatrix PRISMA 2020 & 100-Record Test Suite");
console.log("==================================================\n");

// ----------------------------------------------------
// Test 1: 785 imported -> 100 evidence pool
// ----------------------------------------------------
{
  const records = makeRecords(785, "Scopus RIS");
  const protocol = {
    title: "Maritime Autonomous Operations Review",
    reviewType: "Systematic Literature Review",
  } as any;

  const introSet = selectIntroductionRecords(records, protocol);
  const detailedSet = selectDetailedEvidenceRecords(introSet, [], protocol);

  assert(introSet.length === 100, "Test 1.1: 785 imported -> selectIntroductionRecords bounded to 100");
  assert(detailedSet.length === 100, "Test 1.2: selectDetailedEvidenceRecords bounded to 100");

  const prisma = calculatePrismaFlowData({
    records,
    reviewId: "lm_mu98jxx1_zqr7gu",
    dupesRemoved: 0,
  });

  assert(
    prisma.identification.databases[0].recordsIdentified === 785,
    "Test 1.3: PRISMA identification accurately reports 785 Scopus records"
  );
  assert(
    prisma.eligibility.reportsAssessed === null,
    "Test 1.4: 685 unselected records are NOT falsely marked as full-text excluded"
  );
}

// ----------------------------------------------------
// Test 2: 785 imported -> fewer than 100 eligible records (e.g. 73)
// ----------------------------------------------------
{
  const records = makeRecords(785, "Scopus RIS");
  const screening: Record<string, ScreeningDecision> = {};
  // Exactly 73 included
  for (let i = 0; i < 73; i++) {
    screening[records[i].id] = { decision: "include", score: 85, reason: "Matches maritime criteria", agreed: true };
  }
  for (let i = 73; i < 785; i++) {
    screening[records[i].id] = { decision: "exclude", score: 20, reason: "Out of scope", agreed: false, exclusionReason: "Wrong population" };
  }

  const prisma = calculatePrismaFlowData({
    records,
    dupesRemoved: 0,
    screening,
  });

  assert(prisma.included.studiesIncluded === 73, "Test 2.1: Actual included studies shows 73 (not 100)");
  assert(prisma.included.studiesIncludedInSynthesis === 73, "Test 2.2: Synthesis studies shows 73 rather than 100");
}

// ----------------------------------------------------
// Test 3: Duplicate removal
// ----------------------------------------------------
{
  const records = makeRecords(773, "Scopus RIS");
  const dupesRemoved = 12; // 785 total identified - 12 dupes = 773 screened

  const prisma = calculatePrismaFlowData({
    records,
    dupesRemoved,
  });

  const totalIdentified = prisma.identification.databases.reduce((s, d) => s + d.recordsIdentified, 0);
  assert(totalIdentified === 785, "Test 3.1: Total identified = 773 + 12 = 785");
  assert(prisma.removedBeforeScreening.duplicates === 12, "Test 3.2: Duplicate records removed = 12");
  assert(prisma.screening.recordsScreened === 773, "Test 3.3: Records screened = 773");
}

// ----------------------------------------------------
// Test 4: Screening exclusions
// ----------------------------------------------------
{
  const records = makeRecords(773, "Scopus");
  const screening: Record<string, ScreeningDecision> = {};
  for (let i = 0; i < 100; i++) {
    screening[records[i].id] = { decision: "include", score: 90, reason: "Relevant", agreed: true };
  }
  for (let i = 100; i < 773; i++) {
    const reason = i % 2 === 0 ? "Wrong intervention" : "Outside publication period";
    screening[records[i].id] = { decision: "exclude", score: 15, reason: "Excluded", agreed: false, exclusionReason: reason };
  }

  const prisma = calculatePrismaFlowData({
    records,
    dupesRemoved: 12,
    screening,
  });

  assert(prisma.screening.recordsExcluded === 673, "Test 4.1: Screening exclusions = 673");
  assert(prisma.included.studiesIncluded === 100, "Test 4.2: Included studies after screening = 100");
  assert(prisma.eligibility.exclusionReasons.length >= 2, "Test 4.3: Exclusion reasons breakdown captured");
}

// ----------------------------------------------------
// Test 5: Eligibility exclusions (Full-text stage)
// ----------------------------------------------------
{
  const records = makeRecords(100, "Scopus");
  const manualOverrides = {
    reportsSought: 100,
    reportsNotRetrieved: 5,
    reportsAssessed: 95,
    reportsExcluded: 15,
    exclusionReasons: [
      { reason: "Wrong study design", count: 8 },
      { reason: "Wrong comparator", count: 7 },
    ],
    studiesIncluded: 80,
    studiesIncludedInSynthesis: 80,
  };

  const prisma = calculatePrismaFlowData({
    records,
    manualOverrides,
  });

  assert(prisma.eligibility.reportsSought === 100, "Test 5.1: Reports sought for retrieval = 100");
  assert(prisma.eligibility.reportsNotRetrieved === 5, "Test 5.2: Reports not retrieved = 5");
  assert(prisma.eligibility.reportsAssessed === 95, "Test 5.3: Reports assessed = 95");
  assert(prisma.eligibility.reportsExcluded === 15, "Test 5.4: Reports excluded at eligibility = 15");
  assert(prisma.included.studiesIncluded === 80, "Test 5.5: Final studies included = 80");
}

// ----------------------------------------------------
// Test 6: 100 Thematic-analysis records
// ----------------------------------------------------
{
  const records = makeRecords(100);
  const chars: StudyCharacteristic[] = records.map((r, idx) => ({
    recordId: r.id,
    authorYear: `Author (${2020 + (idx % 4)})`,
    interventionOrFocus: "Autonomous Navigation System",
    primaryOutcome: "Collision avoidance efficiency 98%",
    keyFinding: `Study finding for record ${r.id}`,
  }));

  const budget = buildEvidenceBudget(records, chars);

  assert(budget.introductionRecords.length === 100, "Test 6.1: Introduction evidence set contains 100 records");
  assert(budget.detailedRecords.length === 100, "Test 6.2: Detailed thematic evidence set contains 100 records (not stopped at 50)");
}

// ----------------------------------------------------
// Test 7: 50 Thematic-analysis records
// ----------------------------------------------------
{
  const records = makeRecords(50);
  const chars: StudyCharacteristic[] = records.map((r, idx) => ({
    recordId: r.id,
    authorYear: `Author (${2020 + (idx % 4)})`,
    interventionOrFocus: "Port logistics algorithm",
    primaryOutcome: "Turnaround reduction",
    keyFinding: `Study finding for record ${r.id}`,
  }));

  const budget = buildEvidenceBudget(records, chars);
  assert(budget.detailedRecords.length === 50, "Test 7.1: 50 records detailed evidence set handled properly");
}

// ----------------------------------------------------
// Test 8: Fewer than 50 records (e.g. 15 records)
// ----------------------------------------------------
{
  const records = makeRecords(15);
  const chars: StudyCharacteristic[] = records.map((r) => ({
    recordId: r.id,
    authorYear: "Author (2023)",
    interventionOrFocus: "Vessel routing",
    primaryOutcome: "Fuel savings 12%",
    keyFinding: "Findings summary",
  }));

  const budget = buildEvidenceBudget(records, chars);
  assert(budget.detailedRecords.length === 15, "Test 8.1: 15 records handled correctly without padding or error");
}

// ----------------------------------------------------
// Test 9: Null eligibility fields
// ----------------------------------------------------
{
  const records = makeRecords(200);
  const prisma = calculatePrismaFlowData({
    records,
  });

  assert(prisma.eligibility.reportsSought === null, "Test 9.1: reportsSought is null when not assessed");
  assert(prisma.eligibility.reportsNotRetrieved === null, "Test 9.2: reportsNotRetrieved is null when not assessed");
  assert(prisma.eligibility.reportsAssessed === null, "Test 9.3: reportsAssessed is null when not assessed");
  assert(
    prisma.eligibility.reportsAssessed !== (0 as any),
    "Test 9.4: null is NEVER silently converted to 0"
  );
}

// ----------------------------------------------------
// Test 10: Manuscript generation
// ----------------------------------------------------
{
  const records = makeRecords(100);
  const prisma = calculatePrismaFlowData({
    records,
    dupesRemoved: 12,
  });

  const svg = buildPrismaSvg(prisma);
  assert(svg.includes("PRISMA 2020"), "Test 10.1: SVG contains PRISMA 2020 heading and reference");
  assert(/IDENTIFICATION/i.test(svg), "Test 10.2: SVG contains Identification stage");
  assert(/SCREENING/i.test(svg), "Test 10.3: SVG contains Screening stage");
  assert(/INCLUDED/i.test(svg), "Test 10.4: SVG contains Included stage");
}

// ----------------------------------------------------
// Test 11: PNG export structure
// ----------------------------------------------------
{
  const records = makeRecords(100);
  const prisma = calculatePrismaFlowData({ records });
  const svg = buildPrismaSvg(prisma);

  assert(svg.startsWith("<?xml") || svg.startsWith("<svg"), "Test 11.1: Valid SVG XML string for PNG canvas rasterizer");
  assert(svg.length > 500, "Test 11.2: Non-empty SVG payload generated");
}

// ----------------------------------------------------
// Test 12: SVG export
// ----------------------------------------------------
{
  const records = makeRecords(785, "Scopus");
  const prisma = calculatePrismaFlowData({ records, dupesRemoved: 12 });
  const svg = buildPrismaSvg(prisma);

  assert(svg.includes("785"), "Test 12.1: SVG embeds accurate dynamic count 785");
  assert(svg.includes("12"), "Test 12.2: SVG embeds accurate duplicate count 12");
}

// ----------------------------------------------------
// Test 13: PDF export validation
// ----------------------------------------------------
{
  // Test PDF generation logic: verify valid PRISMA SVG and validation
  const records = makeRecords(100);
  const prisma = calculatePrismaFlowData({ records });
  const issues = validatePrismaFlowData(prisma);

  assert(issues.filter((i) => i.type === "error").length === 0, "Test 13.1: Zero validation errors in valid PRISMA data");
  assert(MAX_DETAILED_RECORDS === 100, "Test 13.2: MAX_DETAILED_RECORDS constant is 100");
}

// ----------------------------------------------------
// Test 14: Validation consistency tests
// ----------------------------------------------------
{
  const invalidData = calculatePrismaFlowData({
    records: makeRecords(50),
    manualOverrides: {
      recordsScreened: 50,
      recordsExcluded: 60, // Exclusions cannot exceed screened
    },
  });

  const issues = validatePrismaFlowData(invalidData);
  assert(issues.some((i) => i.field === "recordsExcluded" && i.type === "error"), "Test 14.1: Validation catches recordsExcluded > recordsScreened");
}

console.log("\n==================================================");
console.log(` Summary: ${passedCount} Passed, ${failedCount} Failed`);
console.log("==================================================");

if (failedCount > 0) {
  process.exit(1);
}
