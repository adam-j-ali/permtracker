import { describe, expect, it } from "vitest";

import { mergeOlderYears, type OlderYears, type PermCasesMeta } from "@/lib/permCasesMeta";

/**
 * /perm-cases' coverage figures with DOL's FY2008 to FY2023 decisions added (src/lib/permCasesMeta.ts): the
 * headline total, the year list, the outcome counts and the state counts all describe the list beside them, which
 * reads both tables.
 */

const META: PermCasesMeta = {
  sourceFiles: ["PERM_Disclosure_Data_FY2026_Q3.xlsx"],
  totalCases: 1000,
  firstDecisionDate: "2023-10-02",
  lastDecisionDate: "2026-06-30",
  firstReceivedDate: "2021-01-04",
  lastReceivedDate: "2026-06-29",
  byStatus: [
    { status: "certified", count: 900 },
    { status: "denied", count: 60 },
    { status: "withdrawn", count: 40 },
  ],
  byFiscalYear: [
    { fiscalYear: "2026", total: 600, certified: 540, denied: 36, withdrawn: 24 },
    { fiscalYear: "2025", total: 400, certified: 360, denied: 24, withdrawn: 16 },
  ],
  byState: [
    { state: "CA", total: 300, certified: 270, denied: 20, withdrawn: 10 },
    { state: "", total: 12, certified: 10, denied: 1, withdrawn: 1 },
  ],
  computedAt: 1,
};

const OLDER: OlderYears = {
  years: [
    { fiscalYear: "2016", total: 80, certified: 70, denied: 6, withdrawn: 4 },
    { fiscalYear: "2008", total: 20, certified: 15, denied: 3, withdrawn: 2 },
  ],
  byState: [
    { state: "CA", total: 50, certified: 45, denied: 3, withdrawn: 2 },
    { state: "TX", total: 400, certified: 390, denied: 5, withdrawn: 5 },
  ],
  from: "2007-10-01",
};

describe("mergeOlderYears", () => {
  it("adds the older years to every count the list's figures read", () => {
    const m = mergeOlderYears(META, OLDER);
    expect(m.totalCases).toBe(1100);
    expect(m.firstDecisionDate).toBe("2007-10-01");
    expect(m.byStatus).toEqual([
      { status: "certified", count: 985 },
      { status: "denied", count: 69 },
      { status: "withdrawn", count: 46 },
    ]);
    expect(m.byFiscalYear.map((y) => y.fiscalYear)).toEqual(["2026", "2025", "2016", "2008"]);
    expect(m.olderYearsCounted).toBe(true);
  });

  it("sums each state across both tables, the busiest first", () => {
    const m = mergeOlderYears(META, OLDER);
    expect(m.byState).toEqual([
      { state: "TX", total: 400, certified: 390, denied: 5, withdrawn: 5 },
      { state: "CA", total: 350, certified: 315, denied: 23, withdrawn: 12 },
      { state: "", total: 12, certified: 10, denied: 1, withdrawn: 1 },
    ]);
  });

  it("says the older years aren't counted when their record hasn't been built, and changes nothing else", () => {
    const m = mergeOlderYears(META, null);
    expect(m.olderYearsCounted).toBe(false);
    expect(m.totalCases).toBe(1000);
    expect(m.byFiscalYear).toEqual(META.byFiscalYear);
  });

  it("never lists a year twice when both tables hold it", () => {
    const m = mergeOlderYears(META, { ...OLDER, years: [{ fiscalYear: "2025", total: 5, certified: 5, denied: 0, withdrawn: 0 }] });
    expect(m.byFiscalYear.find((y) => y.fiscalYear === "2025")?.total).toBe(405);
    expect(m.byFiscalYear.filter((y) => y.fiscalYear === "2025")).toHaveLength(1);
  });
});
