import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wage bands by fiscal year reach back past FY2024 (the Nov 20 2026 sweep, item 34).
 *
 * perm_cases holds FY2024 on; the older years' bands are counted once at the history load into
 * perm_history_wage_bands (scripts/ingest_perm_history.py, build_places_and_wages), so the page adds one read of
 * that small table and never reads perm_cases_history.
 */

const rowsMock = vi.fn();
vi.mock("../client", () => ({
  rows: (...a: unknown[]) => rowsMock(...a),
  one: vi.fn(),
}));

const CURRENT = [
  { fy: "2024", band: 0, decided: 100, denied: 9 },
  { fy: "2024", band: 40_000, decided: 50, denied: 4 },
  { fy: "2025", band: 0, decided: 120, denied: 7 },
];
const OLDER = [
  { fy: "2015", band: 0, decided: 300, denied: 30 },
  { fy: "2015", band: 160_000, decided: 80, denied: 1 },
  { fy: "2016", band: 0, decided: 310, denied: 25 },
];

const isHistory = (sql: unknown) => String(sql).includes("perm_history_wage_bands");

beforeEach(() => {
  rowsMock.mockReset();
  rowsMock.mockImplementation(async (sql: string) => (isHistory(sql) ? OLDER : CURRENT));
});

describe("getWageBandRatesByYear", () => {
  it("adds the older years from their small table, oldest first, each marked as the older files'", async () => {
    const { getWageBandRatesByYear } = await import("../wages");
    const got = await getWageBandRatesByYear();
    expect(got.map((s) => s.fiscalYear)).toEqual(["2015", "2016", "2024", "2025"]);
    expect(got.map((s) => Boolean(s.history))).toEqual([true, true, false, false]);
    const fy2015 = got[0]!.bands;
    expect(fy2015.find((b) => b.from === 0)).toMatchObject({ decided: 300, denied: 30 });
    expect(fy2015.find((b) => b.from === 160_000)).toMatchObject({ decided: 80, denied: 1 });
    // Every band is drawn for every year, empty ones too.
    expect(fy2015).toHaveLength(11);
  });

  it("reads the small table, never the older case table", async () => {
    const { getWageBandRatesByYear } = await import("../wages");
    await getWageBandRatesByYear();
    const sqls = rowsMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("perm_cases_history"))).toBe(false);
    expect(sqls.filter(isHistory)).toHaveLength(1);
  });

  it("a year in both is the current table's (the older table ends at FY2023)", async () => {
    rowsMock.mockImplementation(async (sql: string) =>
      isHistory(sql) ? [...OLDER, { fy: "2024", band: 0, decided: 1, denied: 1 }] : CURRENT,
    );
    const { getWageBandRatesByYear } = await import("../wages");
    const got = await getWageBandRatesByYear();
    const fy2024 = got.filter((s) => s.fiscalYear === "2024");
    expect(fy2024).toHaveLength(1);
    expect(fy2024[0]!.history).toBeFalsy();
    expect(fy2024[0]!.bands.find((b) => b.from === 0)).toMatchObject({ decided: 100 });
  });

  it("before the first history build, the current years alone", async () => {
    rowsMock.mockImplementation(async (sql: string) => {
      if (isHistory(sql)) throw new Error("SQLITE_ERROR: no such table: perm_history_wage_bands");
      return CURRENT;
    });
    const { getWageBandRatesByYear } = await import("../wages");
    expect((await getWageBandRatesByYear()).map((s) => s.fiscalYear)).toEqual(["2024", "2025"]);
  });

  it("any other failed read of the older years throws, never shows them as missing", async () => {
    rowsMock.mockImplementation(async (sql: string) => {
      if (isHistory(sql)) throw new Error("database query deadline (20000ms)");
      return CURRENT;
    });
    const { getWageBandRatesByYear } = await import("../wages");
    await expect(getWageBandRatesByYear()).rejects.toThrow(/deadline/);
  });
});
