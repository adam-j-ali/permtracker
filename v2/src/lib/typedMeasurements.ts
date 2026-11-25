/**
 * Every measurement typed into the code rather than read from data, with where it came from and the day it must be
 * measured again (plan item A23, Batch 11). `typedMeasurements.test.ts` fails once a recheck day has passed, and fails
 * an entry whose constant has left its file, so a typed figure can't quietly outlive its source. A figure typed into
 * page copy is held by the staleness audit instead (scripts/audit_passed_deadlines.py and the dated-figure checks).
 */
export interface TypedMeasurement {
  /** The exported constant. */
  name: string;
  /** The file that defines it, from v2/. */
  file: string;
  /** What it was measured from, and when. */
  source: string;
  /** The Eastern day by which it's measured again: the next publication of its source, or the batch replacing it. */
  recheckBy: string;
  /** What to do on that day. */
  next: string;
}

export const TYPED_MEASUREMENTS: readonly TypedMeasurement[] = [
  {
    name: "PERM_DAYS_BY_DECISION_QUARTER",
    file: "src/lib/greenCardLine.ts",
    source: "medians over perm_cases by decision quarter, FY2024 Q1 to FY2026 Q4, recomputed Nov 25 2026",
    recheckBy: "2027-02-28",
    next: "add FY2027 Q1 from DOL's next disclosure file (due about February 2027)",
  },
  {
    name: "FAMILY_SIZE",
    file: "src/lib/greenCardLine.ts",
    source: "DHS Yearbook of Immigration Statistics, Table 7, FY2023 and FY2024",
    recheckBy: "2026-12-31",
    next: "check for the FY2025 Yearbook's Table 7 and widen the range with it",
  },
  {
    name: "ADJUSTMENT_SHARE",
    file: "src/lib/greenCardLine.ts",
    source: "DHS Yearbook of Immigration Statistics, Table 7, FY2023 and FY2024",
    recheckBy: "2026-12-31",
    next: "check for the FY2025 Yearbook's Table 7 and widen the range with it",
  },
  {
    name: "ESTIMATE_ACCURACY",
    file: "src/lib/wageLevelEstimate.ts",
    source: "the wage-level steps scored on 68,116 DOL decisions, April to September 2026",
    recheckBy: "2027-04-30",
    next: "score the steps again on October 2026 to March 2027 and update the four figures",
  },
  {
    name: "I140_PREP_DAYS_ASSUMED",
    file: "convex/lib/perm/calculators/greenCardPlan.ts",
    source: "a fallback (30 days): the planner uses the reported step cert-to-i140 whenever it holds a median",
    recheckBy: "2026-12-14",
    next: "check the reported step still holds a median; if it does, the fallback can go (Batch 2b)",
  },
  {
    name: "CONSULAR_INTERVIEW_DAYS_ASSUMED",
    file: "convex/lib/perm/calculators/greenCardPlan.ts",
    source: "an assumption (30, 90 and 180 days), stated on the planner",
    recheckBy: "2026-12-14",
    next: "measure it from employment cases only: the reports' nvc-interview step is mostly family visas (Batch 2b)",
  },
];
