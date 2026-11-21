import { describe, expect, it } from "vitest";

import {
  LCA_KINDS,
  hasLcaDetail,
  newVersusTransfer,
  percent,
  shapeLcaProfile,
  type LcaOlderRow,
  type LcaProfileRow,
} from "../lcaProfile";

/**
 * The pure half of the employer page's LCA panel. The read layer's SQL names
 * its columns; this module turns them into the panel's figures. The two
 * failure modes worth a test: a figure the file didn't carry turning into a
 * confident zero or a share, and the panel drawing itself over an employer
 * with nothing to add to the program ledger above it.
 */

const row = (over: Partial<LcaProfileRow> = {}): LcaProfileRow => ({
  filings: 10,
  detail_rows: 8,
  positions: 12,
  new_employment: 4,
  change_employer: 5,
  continued_employment: 2,
  change_previous_employment: 0,
  new_concurrent_employment: 1,
  amended_petition: 0,
  level_1: 3,
  level_2: 2,
  level_3: 0,
  level_4: 0,
  level_blank: 3,
  dependent_rows: 10,
  dependent_yes: 10,
  violator_rows: 10,
  violator_yes: 0,
  visa_h1b: 9,
  visa_e3: 1,
  visa_h1b1_chile: 0,
  visa_h1b1_singapore: 0,
  ...over,
});

describe("shapeLcaProfile", () => {
  it("returns null with no row or no filings, so the panel can't draw over nothing", () => {
    expect(shapeLcaProfile(null, null)).toBeNull();
    expect(shapeLcaProfile(row({ filings: 0 }), null)).toBeNull();
  });

  it("reads libSQL's string numbers and keeps the form's order with new hires and transfers first", () => {
    const p = shapeLcaProfile(row({ filings: "10", new_employment: "4", positions: "12" }), null)!;
    expect(p.filings).toBe(10);
    expect(p.positions).toBe(12);
    expect(p.kinds.map((k) => k.kind.item)).toEqual(["7a", "7e", "7b", "7c", "7d", "7f"]);
    expect(p.kinds[0]).toMatchObject({ n: 4 });
    expect(p.levels.map((l) => [l.level, l.n])).toEqual([["I", 3], ["II", 2], ["III", 0], ["IV", 0]]);
  });

  it("treats the columns a reduced query never named as zero, not as missing data", () => {
    // Before the backfill the read layer asks only for filings and the visa line.
    const reduced = { filings: 5, visa_h1b: 5 } as unknown as LcaProfileRow;
    const p = shapeLcaProfile(reduced, null)!;
    expect(p.detailRows).toBe(0);
    expect(p.dependent).toEqual({ yes: 0, of: 0 });
    expect(hasLcaDetail(p)).toBe(false);
  });

  it("keeps the newest filing's answers, and drops a newest row that answered neither", () => {
    const yes = shapeLcaProfile(row(), { h1b_dependent: "1", willful_violator: 0, filed: "2026-03-05" })!;
    expect(yes.newest).toEqual({ dependent: true, violator: false, filed: "2026-03-05" });
    const none = shapeLcaProfile(row(), { h1b_dependent: null, willful_violator: null, filed: "2026-03-05" })!;
    expect(none.newest).toBeNull();
  });

  it("counts filings under a visa class it doesn't name, so the visa line still adds up", () => {
    const p = shapeLcaProfile(row({ filings: 12, visa_h1b: 9, visa_e3: 1 }), null)!;
    expect(p.otherVisa).toBe(2);
  });
});

/**
 * DOL's FY2008 to FY2019 files, counted at their load (scripts/lca_history_totals.py), add to the newer files'
 * figures. They print the worker breakdown and the wage level in some years only, so their level count comes with its
 * own denominator (`level_rows`: certified LCAs in the years that name a level), never the breakdown's rows.
 */
describe("shapeLcaProfile with the older files", () => {
  const older = (over: Partial<LcaOlderRow> = {}): LcaOlderRow => ({
    filings: 40, certified: 30, detail_rows: 6, positions: 9,
    new_employment: 5, change_employer: 3, continued_employment: 1,
    change_previous_employment: 0, new_concurrent_employment: 0, amended_petition: 0,
    level_1: 4, level_2: 2, level_3: 1, level_4: 0, level_rows: 20,
    dependent_rows: 12, dependent_yes: 0, violator_rows: 12, violator_yes: 0,
    visa_h1b: 38, visa_e3: 2, visa_h1b1_chile: 0, visa_h1b1_singapore: 0, fy_from: "2011",
    ...over,
  });

  it("adds every figure to the newer files' own", () => {
    const p = shapeLcaProfile(row({ fy_from: 2021 }), null, older())!;
    expect(p.filings).toBe(50);
    expect(p.detailRows).toBe(14);
    expect(p.positions).toBe(21);
    expect(p.kinds.find((k) => k.kind.key === "newEmployment")?.n).toBe(9);
    expect(p.levels.map((l) => l.n)).toEqual([7, 4, 1, 0]);
    expect(p.dependent).toEqual({ yes: 10, of: 22 });
    expect(p.visas.find((v) => v.key === "e3")?.n).toBe(3);
    expect(p.olderFilings).toBe(40);
  });

  it("takes the level's blank share over the years that name a level, never over the breakdown's rows", () => {
    const p = shapeLcaProfile(row(), null, older())!;
    // Newer: 3 blank of 8. Older: 20 certified in the years that name a level, 7 of them named.
    expect(p.levelRows).toBe(28);
    expect(p.levelBlank).toBe(16);
  });

  it("names the first fiscal year the figures reach", () => {
    expect(shapeLcaProfile(row({ fy_from: "2021" }), null, older())!.fyFrom).toBe(2011);
    expect(shapeLcaProfile(row({ fy_from: 2021 }), null, null)!.fyFrom).toBe(2021);
    expect(shapeLcaProfile(row(), null, null)!.fyFrom).toBeNull();
  });

  it("draws for an employer whose LCAs are all in the older files", () => {
    const p = shapeLcaProfile({ filings: 0 } as unknown as LcaProfileRow, null, older())!;
    expect(p.filings).toBe(40);
    expect(p.levelRows).toBe(20);
    expect(hasLcaDetail(p)).toBe(true);
    expect(shapeLcaProfile(null, null, older())?.filings).toBe(40);
  });

  it("keeps the newer files' own figures when the older files hold nothing for it", () => {
    const p = shapeLcaProfile(row(), null, null)!;
    expect(p.levelRows).toBe(8);
    expect(p.levelBlank).toBe(3);
    expect(p.olderFilings).toBe(0);
  });
});

describe("hasLcaDetail", () => {
  it("draws for the breakdown, for a declaration, or for a visa other than H-1B", () => {
    const base = row({ detail_rows: 0, dependent_rows: 0, violator_rows: 0, filings: 9, visa_h1b: 9, visa_e3: 0 });
    expect(hasLcaDetail(shapeLcaProfile(base, null))).toBe(false);
    expect(hasLcaDetail(shapeLcaProfile({ ...base, detail_rows: 1 }, null))).toBe(true);
    expect(hasLcaDetail(shapeLcaProfile({ ...base, violator_rows: 1 }, null))).toBe(true);
    expect(hasLcaDetail(shapeLcaProfile({ ...base, filings: 10, visa_e3: 1 }, null))).toBe(true);
    expect(hasLcaDetail(null)).toBe(false);
  });
});

describe("percent and newVersusTransfer", () => {
  it("never rounds a nonzero share to 0 and has no share of nothing", () => {
    expect(percent(1, 1000)).toBe(1);
    expect(percent(0, 1000)).toBe(0);
    expect(percent(5, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });

  it("names the two boxes it compares by their form items, and withholds when neither was ticked", () => {
    expect(LCA_KINDS.find((k) => k.key === "newEmployment")?.item).toBe("7a");
    expect(LCA_KINDS.find((k) => k.key === "changeEmployer")?.item).toBe("7e");
    expect(newVersusTransfer(shapeLcaProfile(row(), null)!)).toEqual({ newN: 4, transferN: 5 });
    expect(newVersusTransfer(shapeLcaProfile(row({ new_employment: 0, change_employer: 0 }), null)!)).toBeNull();
  });
});
