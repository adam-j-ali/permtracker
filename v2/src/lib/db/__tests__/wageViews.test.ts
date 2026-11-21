import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Precomputed wage selections (wageViews.ts, scripts/build_wage_views.py).
 *
 * The readers must (a) serve a precomputed view with ONE primary-key read and
 * no aggregate, (b) fall back to the live query when there is no view, and
 * (c) never serve bins at a width other than the one the caller asked for.
 * The key normalisation is what makes a view describe the same rows the live
 * query would read, so it is pinned too.
 */

const oneMock = vi.fn();
const rowsMock = vi.fn();

vi.mock("../client", () => ({
  one: (...a: unknown[]) => oneMock(...a),
  rows: (...a: unknown[]) => rowsMock(...a),
}));

const STATS = { n: 120_000, avg: 140_000, p5: 80_000, p25: 110_000, p50: 135_000, p75: 165_000, p95: 220_000 };
const VIEW = {
  stats: STATS,
  binWidth: 10_000,
  histogram: [[80_000, 5], [90_000, 9]],
  minCases: 30,
  byState: [{ state: "CA", ...STATS }],
};

const isViewRead = (sql: unknown) => String(sql).includes("FROM wage_views");

beforeEach(() => {
  vi.clearAllMocks();
  oneMock.mockResolvedValue(null);
  rowsMock.mockResolvedValue([]);
});

describe("wageViewKey", () => {
  it("normalises each part the way the live query normalises its argument", async () => {
    const { wageViewKey } = await import("../wageViews");
    expect(wageViewKey("perm", { socCode: " 15-1252.00 ", state: "CA", fiscalYear: "2026" }))
      .toBe("perm|certified|15-1252|CA|2026");
    expect(wageViewKey("lca", { status: "all", state: "tx", fiscalYear: 2025 }))
      .toBe("lca|all||TX|2025");
    expect(wageViewKey("lca", { status: "denied" })).toBe("lca|denied|||");
  });
});

describe("the PERM readers", () => {
  it("serve stats, bins and the by-state table from a view", async () => {
    oneMock.mockImplementation(async (sql: string) =>
      isViewRead(sql) ? { json: JSON.stringify(VIEW) } : null,
    );
    const { getWageStats, getWageHistogram, getWageByState } = await import("../publicData");
    const f = { socCode: "15-1252", status: "certified" as const };
    expect(await getWageStats(f)).toEqual(STATS);
    expect(await getWageHistogram(f, 10_000)).toEqual([
      { from: 80_000, count: 5 },
      { from: 90_000, count: 9 },
    ]);
    expect(await getWageByState(f, 30)).toEqual(VIEW.byState);
    // Nothing but primary-key reads of wage_views.
    expect(rowsMock).not.toHaveBeenCalled();
    for (const [sql] of oneMock.mock.calls) expect(isViewRead(sql)).toBe(true);
  });

  it("run the live query when there is no view", async () => {
    oneMock.mockImplementation(async (sql: string) =>
      isViewRead(sql) ? null : { n: 42, avg: 1, p5: 1, p25: 1, p50: 1, p75: 1, p95: 1 },
    );
    const { getWageStats } = await import("../publicData");
    expect((await getWageStats({ socCode: "11-9041" })).n).toBe(42);
  });

  it("never serve bins at a width other than the one asked for", async () => {
    oneMock.mockImplementation(async (sql: string) =>
      isViewRead(sql) ? { json: JSON.stringify(VIEW) } : null,
    );
    rowsMock.mockResolvedValue([{ bin: 0, n: 7 }]);
    const { getWageHistogram } = await import("../publicData");
    expect(await getWageHistogram({ socCode: "15-1252" }, 5_000)).toEqual([{ from: 0, count: 7 }]);
    expect(rowsMock).toHaveBeenCalledTimes(1);
  });

  it("do not look up a view for a city or industry narrowing", async () => {
    oneMock.mockResolvedValue({ n: 3, avg: 1, p5: 1, p25: 1, p50: 1, p75: 1, p95: 1 });
    const { getWageStats } = await import("../publicData");
    await getWageStats({ state: "CA", city: "San Jose" });
    for (const [sql] of oneMock.mock.calls) expect(isViewRead(sql)).toBe(false);
  });
});

describe("a year from DOL's older PERM files (FY2008 to FY2023)", () => {
  // The history load precomputes every selection of an older year that holds a case, under the reader's keys and
  // the program value "perm_history" (scripts/build_wage_views.py, HISTORY_PROGRAM). The live query reads
  // perm_cases, FY2024 on, so for those years a missing key is a selection with no cases, and nothing live runs.
  const ROOT = "perm|all|||2015";
  const older = (selection: Record<string, unknown> | null) =>
    rowsMock.mockImplementation(async (sql: string, args: string[]) => {
      if (!isViewRead(sql)) throw new Error(`a live read: ${sql}`);
      const out: Record<string, unknown>[] = [{ key: ROOT, program: "perm_history", json: JSON.stringify(VIEW) }];
      if (selection) out.push({ key: args[0], program: "perm_history", json: JSON.stringify(selection) });
      return out.filter((r) => args.includes(String(r.key)));
    });

  it("serve its view, with its year's marker, in one read", async () => {
    older(VIEW);
    const { getWageStats } = await import("../publicData");
    expect(await getWageStats({ socCode: "15-1132", state: "WA", fiscalYear: "2015" })).toEqual(STATS);
    const [sql, args] = rowsMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/FROM wage_views WHERE key IN \(\?, \?\)/);
    expect(args).toEqual(["perm|certified|15-1132|WA|2015", ROOT]);
    expect(oneMock).not.toHaveBeenCalled();
  });

  it("answer a missing selection as none, with no live query", async () => {
    older(null);
    const { getWageStats, getWageHistogram, getWageByState } = await import("../publicData");
    const f = { socCode: "15-1132", state: "WY", fiscalYear: "2015" };
    expect((await getWageStats(f)).n).toBe(0);
    expect(await getWageHistogram(f, 10_000)).toEqual([]);
    expect(await getWageByState({ socCode: "15-1132", fiscalYear: "2015" }, 30)).toEqual([]);
    expect(oneMock).not.toHaveBeenCalled();
  });

  it("never draw bins at another width, and never ask the live query for them", async () => {
    older(VIEW);
    const { getWageHistogram } = await import("../publicData");
    expect(await getWageHistogram({ state: "WA", fiscalYear: "2015" }, 5_000)).toEqual([]);
    for (const [sql] of rowsMock.mock.calls) expect(isViewRead(sql)).toBe(true);
  });

  it("run the live query for a year the older files don't hold", async () => {
    rowsMock.mockImplementation(async (sql: string) => (isViewRead(sql) ? [] : []));
    oneMock.mockResolvedValue({ n: 42, avg: 1, p5: 1, p25: 1, p50: 1, p75: 1, p95: 1 });
    const { getWageStats } = await import("../publicData");
    expect((await getWageStats({ socCode: "11-9041", fiscalYear: "2025" })).n).toBe(42);
  });

  it("throw when the read fails, rather than answer none or ask the live query", async () => {
    rowsMock.mockRejectedValue(new Error("database query deadline (20000ms)"));
    const { getWageStats } = await import("../publicData");
    await expect(getWageStats({ state: "OR", fiscalYear: "2014" })).rejects.toThrow(/deadline/);
    expect(oneMock).not.toHaveBeenCalled();
  });

  it("run the live query on a database with no views yet", async () => {
    rowsMock.mockRejectedValue(new Error("SQLITE_ERROR: no such table: wage_views"));
    oneMock.mockResolvedValue({ n: 5, avg: 1, p5: 1, p25: 1, p50: 1, p75: 1, p95: 1 });
    const { getWageStats } = await import("../publicData");
    expect((await getWageStats({ state: "WA", fiscalYear: "2025" })).n).toBe(5);
  });

  it("say whether a year is one of them", async () => {
    older(null);
    const { permHistoryYear } = await import("../wageViews");
    expect(await permHistoryYear("2015")).toBe(true);
    rowsMock.mockResolvedValue([]);
    expect(await permHistoryYear("2026")).toBe(false);
  });

  // BLS renumbered jobs in 2018, and the older files carry the 2010 codes: software developers were 15-1132 and
  // 15-1133 before 15-1252. A current job with an older year would read "no cases" with its cases right there.
  const counted = (n: Record<string, number>) =>
    rowsMock.mockImplementation(async (sql: string, args: string[]) => {
      if (!isViewRead(sql)) throw new Error(`a live read: ${sql}`);
      const out: Record<string, unknown>[] = [{ key: ROOT, program: "perm_history", n: 9, json: JSON.stringify(VIEW) }];
      for (const [key, count] of Object.entries(n)) {
        out.push({ key, program: "perm_history", n: count, json: JSON.stringify({ ...VIEW, stats: { ...STATS, n: count } }) });
      }
      return out.filter((r) => args.includes(String(r.key)));
    });

  it("read a renumbered job's 2010 codes in the same statement, and count each on its own", async () => {
    counted({ "perm|certified|15-1132||2015": 8_100, "perm|certified|15-1133||2015": 1_900 });
    const { getWageSelection } = await import("../publicData");
    const got = await getWageSelection({ socCode: "15-1252.00", fiscalYear: "2015" });
    expect(rowsMock).toHaveBeenCalledTimes(1);
    const [sql, args] = rowsMock.mock.calls[0]!;
    expect(String(sql)).toMatch(/FROM wage_views WHERE key IN \(\?, \?, \?, \?\)/);
    expect(args).toEqual([
      "perm|certified|15-1252||2015",
      ROOT,
      "perm|certified|15-1132||2015",
      "perm|certified|15-1133||2015",
    ]);
    expect(got.stats.n).toBe(0);
    expect(got.earlierCodes).toEqual([
      { code: "15-1132", title: "Software Developers, Applications", n: 8_100 },
      { code: "15-1133", title: "Software Developers, Systems Software", n: 1_900 },
    ]);
    expect(got.earlierNote).toBe(
      "15-1132 and 15-1133 also covered 15-1253 (Software Quality Assurance Analysts and Testers).",
    );
    expect(oneMock).not.toHaveBeenCalled();
  });

  it("keep to the selection's own outcome and state, busiest first, and leave out a code with no cases", async () => {
    counted({
      "perm|denied|15-1252|WA|2015": 40,
      "perm|denied|15-1133|WA|2015": 70,
      "perm|certified|15-1132|WA|2015": 5_000,
    });
    const { getWageSelection } = await import("../publicData");
    const got = await getWageSelection({ socCode: "15-1252", state: "WA", fiscalYear: "2015", status: "denied" });
    expect(got.stats.n).toBe(40);
    expect(got.earlierCodes).toEqual([{ code: "15-1133", title: "Software Developers, Systems Software", n: 70 }]);
  });

  it("read no other code for a job that kept its number, or a 2010 code itself", async () => {
    counted({});
    const { getWageSelection } = await import("../publicData");
    expect((await getWageSelection({ socCode: "11-1011", fiscalYear: "2015" })).earlierCodes).toEqual([]);
    expect((await getWageSelection({ socCode: "15-1132", fiscalYear: "2015" })).earlierCodes).toEqual([]);
    for (const [, args] of rowsMock.mock.calls) expect(args).toHaveLength(2);
  });

  it("offer no 2010 code in a year the live query answers", async () => {
    rowsMock.mockImplementation(async (sql: string, args: string[]) =>
      isViewRead(sql) ? args.slice(2).map((key) => ({ key, program: "perm", n: 9_000, json: "{}" })) : [],
    );
    oneMock.mockResolvedValue({ n: 42, avg: 1, p5: 1, p25: 1, p50: 1, p75: 1, p95: 1 });
    const { getWageSelection } = await import("../publicData");
    const got = await getWageSelection({ socCode: "15-1252", fiscalYear: "2025" });
    expect(got.stats.n).toBe(42);
    expect(got.earlierCodes).toEqual([]);
    expect(got.earlierNote).toBeNull();
  });

  it("refuse a city or industry narrowing of one, never answer it from perm_cases", async () => {
    older(null);
    const { getWageStats } = await import("../publicData");
    await expect(getWageStats({ state: "WA", city: "Seattle", fiscalYear: "2015" })).rejects.toThrow(/older files/);
    expect(oneMock).not.toHaveBeenCalled();
  });
});

describe("the LCA readers", () => {
  it("serve a view before the older default-view doc and the live query", async () => {
    oneMock.mockImplementation(async (sql: string) =>
      isViewRead(sql) ? { json: JSON.stringify(VIEW) } : null,
    );
    const { getLcaWageStats, getLcaWageByState } = await import("../lcaWages");
    expect(await getLcaWageStats({ status: "all", socCode: "15-1252" })).toEqual(STATS);
    expect(await getLcaWageByState({ status: "all", socCode: "15-1252", state: "WA" }, 30)).toEqual(VIEW.byState);
    expect(rowsMock).not.toHaveBeenCalled();
  });
});
