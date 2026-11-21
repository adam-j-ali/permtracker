import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /perm-cases reads DOL's FY2008 to FY2023 decisions too (`perm_cases_history`): a case found by its number, a
 * name search, and the list, which pages through the current table and then the older one in decision order
 * (every current decision is October 2023 or later, every older one before it). Asserts the SQL each step sends.
 */

vi.mock("server-only", () => ({}));

const TABLES: Record<string, Record<string, unknown>[]> = {};
const sent: { sql: string; args: unknown[] }[] = [];

function answer(sql: string, args: unknown[]): Record<string, unknown>[] {
  sent.push({ sql: sql.replace(/\s+/g, " "), args });
  const table = /FROM (\w+)/.exec(sql)?.[1] ?? "";
  const all = TABLES[table] ?? [];
  if (/SELECT rowid/.test(sql)) return all.map((r, i) => ({ rowid: i + 1, ...r }));
  if (/rowid IN/.test(sql)) {
    const ids = new Set(args.filter((a) => typeof a === "number").map(Number));
    return all.filter((_, i) => ids.has(i + 1));
  }
  if (/case_number = \?/.test(sql)) return all.filter((r) => r.case_number === args[0]);
  // LIMIT ? OFFSET ?: the last two arguments.
  if (/LIMIT \? OFFSET \?/.test(sql)) {
    const [limit, offset] = args.slice(-2).map(Number) as [number, number];
    return all.slice(offset, offset + limit);
  }
  return all;
}

vi.mock("../client", () => ({
  rows: async (sql: string, args: unknown[] = []) => answer(sql, args),
  one: async (sql: string, args: unknown[] = []) => answer(sql, args)[0] ?? null,
  rowsPaged: async (sql: string, args: unknown[], take: number) => {
    const read = answer(sql, args);
    return { page: read.slice(0, take), more: read.length > take, consumed: Math.min(read.length, take) };
  },
}));

const { getOlderYears, listCases, lookupByCaseNumber, searchCases } = await import("../cases");

const row = (n: string, decided: string, extra: Record<string, unknown> = {}) => ({
  case_number: n,
  status: "certified",
  received_date: "2015-01-01",
  decision_date: decided,
  days: 300,
  employer_name: "Acme Inc",
  employer_slug: "acme-inc",
  state: "WA",
  job_title: "Engineer",
  soc_code: "15-1132.00",
  soc_title: "Software Developers, Applications",
  attorney_name: null,
  attorney_slug: null,
  wage: 100000,
  ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(TABLES)) delete TABLES[k];
  sent.length = 0;
});

const asked = (table: string) => sent.filter((s) => new RegExp(`FROM ${table}\\b(?!_)`).test(s.sql));

describe("a case by its number", () => {
  it("answers from the older table when the current one has no such case", async () => {
    TABLES.perm_cases_history = [row("A-16001-00001", "2016-05-01")];
    const r = await lookupByCaseNumber("a-16001-00001");
    expect(r?.caseNumber).toBe("A-16001-00001");
    expect(asked("perm_cases_history")).toHaveLength(1);
  });

  it("never reads the older table when the current one holds the case", async () => {
    TABLES.perm_cases = [row("G-100-24001-000001", "2024-05-01")];
    await lookupByCaseNumber("G-100-24001-000001");
    expect(asked("perm_cases_history")).toHaveLength(0);
  });
});

describe("the list", () => {
  it("fills a page from the older table once the current one runs out, and says where it stopped", async () => {
    TABLES.perm_cases = [row("G-1", "2024-02-01"), row("G-2", "2023-10-05")];
    TABLES.perm_cases_history = [row("A-1", "2023-09-30"), row("A-2", "2023-09-01"), row("A-3", "2022-01-01")];
    const p = await listCases({ filter: { slice: { kind: "all" } }, numItems: 4 });
    expect(p.page.map((r) => r.caseNumber)).toEqual(["G-1", "G-2", "A-1", "A-2"]);
    expect(p.isDone).toBe(false);
    expect(p.continueCursor).toBe("h:2");
    const next = await listCases({ filter: { slice: { kind: "all" } }, numItems: 4, cursor: p.continueCursor });
    expect(next.page.map((r) => r.caseNumber)).toEqual(["A-3"]);
    expect(next.isDone).toBe(true);
    const last = sent[sent.length - 1]!;
    expect(last.sql).toContain("FROM perm_cases_history WHERE 1 ORDER BY decision_date DESC LIMIT ? OFFSET ?");
    expect(last.args.slice(-2)).toEqual([5, 2]);
  });

  it("reads only the older table for a fiscal year before FY2024, and only the current one for a later year", async () => {
    TABLES.perm_cases_history = [row("A-1", "2016-03-01")];
    await listCases({ filter: { slice: { kind: "state", state: "WA" }, from: "2015-10-01", to: "2016-09-30" } });
    expect(asked("perm_cases")).toHaveLength(0);
    expect(asked("perm_cases_history")[0]!.sql).toContain("state = ?");
    sent.length = 0;
    await listCases({ filter: { slice: { kind: "all" }, from: "2024-10-01", to: "2025-09-30" } });
    expect(asked("perm_cases_history")).toHaveLength(0);
  });

  it("starts from the older table when the oldest decisions come first", async () => {
    TABLES.perm_cases_history = [row("A-1", "2008-01-01")];
    TABLES.perm_cases = [row("G-1", "2023-10-02")];
    const p = await listCases({ filter: { slice: { kind: "all" } }, order: "oldest", numItems: 5 });
    expect(p.page.map((r) => r.caseNumber)).toEqual(["A-1", "G-1"]);
    expect(sent[0]!.sql).toContain("FROM perm_cases_history");
    expect(sent[0]!.sql).toContain("ORDER BY decision_date ASC");
  });

  it("knows the older table is next when the current one ends exactly at the page's end", async () => {
    TABLES.perm_cases = [row("G-1", "2024-02-01"), row("G-2", "2023-10-05")];
    TABLES.perm_cases_history = [row("A-1", "2023-09-30")];
    const p = await listCases({ filter: { slice: { kind: "all" } }, numItems: 2 });
    expect(p.page.map((r) => r.caseNumber)).toEqual(["G-1", "G-2"]);
    expect(p.isDone).toBe(false);
    expect(p.continueCursor).toBe("h:0");
  });

  it("stops paging the older table at its own depth, where a skip would pass a second", async () => {
    TABLES.perm_cases_history = [row("A-1", "2016-03-01")];
    const p = await listCases({ filter: { slice: { kind: "all" } }, cursor: "h:999999" });
    expect(p.page).toEqual([]);
    expect(p.isDone).toBe(true);
    expect(asked("perm_cases_history")).toHaveLength(0);
  });

  it("reads a cursor from before the older table joined as a place in the current one", async () => {
    TABLES.perm_cases = [row("G-1", "2024-02-01"), row("G-2", "2023-10-05")];
    const p = await listCases({ filter: { slice: { kind: "all" } }, cursor: "1", numItems: 5 });
    expect(p.page.map((r) => r.caseNumber)).toEqual(["G-2"]);
  });
});

describe("the older table's record", () => {
  it("reads the history load's years and states, one point read", async () => {
    const doc = {
      years: [{ fiscalYear: "2016", total: 10, certified: 8, denied: 1, withdrawn: 1 }, { fiscalYear: "bad", total: 1 }],
      byState: [{ state: "WA", total: 4, certified: 4, denied: 0, withdrawn: 0 }],
      from: "2007-10-01",
    };
    TABLES.perm_docs = [{ json: JSON.stringify(doc) }];
    const got = await getOlderYears();
    expect(got).toEqual({
      years: [{ fiscalYear: "2016", total: 10, certified: 8, denied: 1, withdrawn: 1 }],
      byState: [{ state: "WA", total: 4, certified: 4, denied: 0, withdrawn: 0 }],
      from: "2007-10-01",
    });
    expect(sent[0]!.sql).toContain("FROM perm_docs WHERE key = 'perm_history_years'");
  });

  it("is null before the record is built", async () => {
    expect(await getOlderYears()).toBeNull();
  });
});

describe("a name search", () => {
  it("never reads the older table when the current one fills the answer", async () => {
    TABLES.perm_cases = [row("G-1", "2024-02-01"), row("G-2", "2023-10-05")];
    TABLES.perm_cases_history = [row("A-1", "2016-03-01")];
    const r = await searchCases({ field: "employer", text: "acme", limit: 2 });
    expect(r.map((c) => c.caseNumber)).toEqual(["G-1", "G-2"]);
    expect(asked("perm_cases_history")).toHaveLength(0);
  });

  it("adds the older table's newest after the current one's, each case once", async () => {
    TABLES.perm_cases = [row("G-1", "2024-02-01"), row("A-2", "2023-10-05")];
    TABLES.perm_cases_history = [row("A-2", "2023-09-01"), row("A-1", "2016-03-01")];
    const r = await searchCases({ field: "employer", text: "acme", limit: 10 });
    expect(r.map((c) => c.caseNumber)).toEqual(["G-1", "A-2", "A-1"]);
    // Two passes on the older table: the rows' ids off the (slug, decision day) index, then those rows.
    const [ids, fetch] = asked("perm_cases_history");
    expect(ids!.sql).toContain("SELECT rowid FROM perm_cases_history WHERE employer_slug >= ? AND employer_slug < ?");
    expect(fetch!.sql).toContain("FROM perm_cases_history NOT INDEXED WHERE rowid IN");
  });

  it("searches a law firm's older cases by the firm's slug, and carries the outcome and title filters", async () => {
    TABLES.perm_cases_history = [row("A-1", "2016-03-01", { attorney_slug: "fragomen" })];
    await searchCases({ field: "attorney", text: "fragomen", status: "denied", title: "engineer", limit: 10 });
    const [ids, fetch] = asked("perm_cases_history");
    expect(ids!.sql).toContain("attorney_slug >= ? AND attorney_slug < ?");
    expect(fetch!.sql).toContain("status = ?");
    expect(fetch!.sql).toMatch(/job_title LIKE \?/);
  });
});
