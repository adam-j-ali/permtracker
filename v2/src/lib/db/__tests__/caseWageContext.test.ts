import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The case page's wage ladder for a case DOL decided before FY2024 (sweep item 21, Nov 21 2026). Its row is in the
 * older table, and its peers are its own fiscal year's certified cases in the same occupation, read from the cells
 * the history load counts once (perm_history_wage_cells), never from the older table itself.
 */

vi.mock("server-only", () => ({}));

const sent: { sql: string; args: unknown[] }[] = [];
const answers: { match: RegExp; rows: Record<string, unknown>[] | Error }[] = [];

async function answer(sql: string, args: unknown[] = []) {
  sent.push({ sql: sql.replace(/\s+/g, " "), args });
  const hit = answers.find((a) => a.match.test(sql));
  if (!hit) return [];
  if (hit.rows instanceof Error) throw hit.rows;
  return hit.rows;
}

vi.mock("../client", () => ({
  rows: (sql: string, args?: unknown[]) => answer(sql, args),
  one: async (sql: string, args?: unknown[]) => (await answer(sql, args))[0] ?? null,
}));
const getWageStats = vi.fn();
vi.mock("../publicData", () => ({ getWageStats: (...a: unknown[]) => getWageStats(...a) }));

const { getCaseWageContext } = await import("../caseContext");

const cell = (state: string, n: number) => ({ state, n, avg: 101000, p5: 70000, p25: 90000, p50: 100000, p75: 115000, p95: 140000 });

beforeEach(() => {
  sent.length = 0;
  answers.length = 0;
  getWageStats.mockReset();
});

describe("an older case's wage ladder", () => {
  it("places it among its own year's certified peers, nationally and in its state", async () => {
    answers.push(
      { match: /FROM perm_cases WHERE/, rows: [] },
      {
        match: /FROM perm_cases_history WHERE/,
        rows: [{ soc_code: "15-1132.00", soc_title: "Software Developers, Applications", state: "WA", wage: 105000, fiscal_year: "2016" }],
      },
      { match: /FROM perm_history_wage_cells/, rows: [cell("", 4000), cell("WA", 600)] },
    );
    const w = await getCaseWageContext("A-15300-00001");
    expect(w).toMatchObject({ socCode: "15-1132.00", state: "WA", wage: 105000, fiscalYear: "2016" });
    expect(w?.occupation).toMatchObject({ n: 4000, p50: 100000 });
    expect(w?.inState).toMatchObject({ n: 600 });
    const read = sent.find((s) => s.sql.includes("perm_history_wage_cells"))!;
    expect(read.sql).toContain("WHERE fy = ? AND soc = ? AND state IN ('', ?)");
    expect(read.args).toEqual([2016, "15-1132", "WA"]);
    // The pooled FY2024-on statistics are never asked for an older case.
    expect(getWageStats).not.toHaveBeenCalled();
    expect(sent.some((s) => /FROM perm_cases_history/.test(s.sql) && !/case_number = \?/.test(s.sql))).toBe(false);
  });

  it("draws no ladder when its year's occupation has no cell (too few peers)", async () => {
    answers.push(
      { match: /FROM perm_cases WHERE/, rows: [] },
      { match: /FROM perm_cases_history WHERE/, rows: [{ soc_code: "15-1132", soc_title: null, state: "WA", wage: 105000, fiscal_year: "2016" }] },
      { match: /FROM perm_history_wage_cells/, rows: [cell("WA", 40)] },
    );
    expect(await getCaseWageContext("A-15300-00001")).toBeNull();
  });

  it("keeps the national ladder when the state's cell is missing", async () => {
    answers.push(
      { match: /FROM perm_cases WHERE/, rows: [] },
      { match: /FROM perm_cases_history WHERE/, rows: [{ soc_code: "15-1132", soc_title: null, state: "WY", wage: 99000, fiscal_year: "2019" }] },
      { match: /FROM perm_history_wage_cells/, rows: [cell("", 3000)] },
    );
    const w = await getCaseWageContext("A-18300-00001");
    expect(w?.occupation.n).toBe(3000);
    expect(w?.inState).toBeNull();
  });

  it("reads the current files' pooled ladder for a case they hold, as before", async () => {
    answers.push({ match: /FROM perm_cases WHERE/, rows: [{ soc_code: "15-1252.00", soc_title: "Software Developers", state: "CA", wage: 180000 }] });
    getWageStats.mockResolvedValue({ n: 5000, avg: 1, p5: 1, p25: 2, p50: 3, p75: 4, p95: 5 });
    const w = await getCaseWageContext("G-100-25001-000001");
    expect(w?.fiscalYear).toBeNull();
    expect(sent.some((s) => s.sql.includes("perm_cases_history"))).toBe(false);
  });

  it("draws nothing before the cells are built, and throws on any other failed read", async () => {
    answers.push(
      { match: /FROM perm_cases WHERE/, rows: [] },
      { match: /FROM perm_cases_history WHERE/, rows: [{ soc_code: "15-1132", soc_title: null, state: "WA", wage: 105000, fiscal_year: "2016" }] },
      { match: /FROM perm_history_wage_cells/, rows: new Error("SQLite error: no such table: perm_history_wage_cells") },
    );
    expect(await getCaseWageContext("A-15300-00001")).toBeNull();
    answers[2] = { match: /FROM perm_history_wage_cells/, rows: new Error("database query deadline") };
    await expect(getCaseWageContext("A-15300-00001")).rejects.toThrow("deadline");
  });
});
