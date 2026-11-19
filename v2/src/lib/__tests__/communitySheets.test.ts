import { describe, expect, it } from "vitest";

import { SHEETS, sheetFor, transferCohorts, type SheetCase } from "../communitySheets";

const base: SheetCase = {
  source: "sfv-filers",
  rowNo: 1,
  category: "EB-3",
  visaAvailability: "Visa available",
  visaStatus: null,
  chargeability: "row",
  country: "ROW",
  priorityDate: null,
  priorityNote: null,
  receiptDate: "2026-05-01",
  biometricsDate: null,
  transferDate: "2026-09-24",
  approvalDate: null,
  cardDate: null,
  validAsOf: null,
};

describe("transferCohorts", () => {
  it("counts each transfer day's cases and approvals, newest day first, with the median days to approval", () => {
    const rows: SheetCase[] = [
      { ...base, rowNo: 1, transferDate: "2026-06-06", approvalDate: "2026-07-26" }, // 50 days
      { ...base, rowNo: 2, transferDate: "2026-06-06", approvalDate: "2026-07-16" }, // 40 days
      { ...base, rowNo: 3, transferDate: "2026-06-06", approvalDate: "2026-08-05" }, // 60 days
      { ...base, rowNo: 4, transferDate: "2026-09-24" },
      { ...base, rowNo: 5, transferDate: "2026-09-24", visaAvailability: "Not available" },
      { ...base, rowNo: 6, transferDate: null },
    ];
    expect(transferCohorts(rows)).toEqual([
      { transferDate: "2026-09-24", cases: 2, approved: 0, medianDays: null, waitingAvailable: 1 },
      { transferDate: "2026-06-06", cases: 3, approved: 3, medianDays: 50, waitingAvailable: 0 },
    ]);
  });

  it("gives a median only from three approvals, and never counts an approval dated before its transfer", () => {
    const rows: SheetCase[] = [
      { ...base, rowNo: 1, transferDate: "2026-08-11", approvalDate: "2026-09-01" },
      { ...base, rowNo: 2, transferDate: "2026-08-11", approvalDate: "2026-10-01" },
      { ...base, rowNo: 3, transferDate: "2026-08-11", approvalDate: "2026-07-01" },
    ];
    const [c] = transferCohorts(rows);
    expect(c?.approved).toBe(3);
    expect(c?.medianDays).toBeNull();
  });
});

describe("the sheets this site reads", () => {
  it("names each sheet with its office, its link and the day it was shared", () => {
    const sfv = sheetFor("sfv-filers");
    expect(sfv?.office).toBe("SFV");
    expect(sfv?.url).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/htmlview$/);
    expect(SHEETS.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.shared))).toBe(true);
  });
});
