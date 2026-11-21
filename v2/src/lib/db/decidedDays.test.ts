import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What DOL decided in a range, read across the published tables.
 *
 * The client is faked at the SQL level so each assertion is about the query
 * the module actually issues: which tables it asks, which filters reach the
 * WHERE, and what it does when a table lacks a column.
 */

const SCHEMA: Record<string, string[]> = {
  perm_cases: [
    "case_number", "status", "decision_date", "received_date", "employer_name", "employer_slug",
    "job_title", "soc_code", "soc_title", "state", "wage", "attorney_name", "attorney_slug",
    "naics", "worksite_city", "citizenship", "visa_class", "education",
  ],
  perm_cases_history: [
    "case_number", "status", "decision_date", "received_date", "employer_name", "employer_slug",
    "job_title", "soc_code", "soc_title", "state", "wage", "attorney_name", "attorney_slug",
    "naics", "worksite_city",
  ],
  pwd_cases: [
    "case_number", "case_status", "decision_date", "received_date", "employer_name", "employer_slug",
    "job_title", "soc_code", "soc_title", "worksite_state", "wage", "wage_unit", "visa_class",
    "attorney_name", "attorney_slug",
  ],
  lca_cases: [
    "case_number", "case_status", "decision_date", "received_date", "employer_name", "employer_slug",
    "job_title", "soc_code", "soc_title", "worksite_state", "wage", "wage_unit", "visa_class",
    "attorney_name", "attorney_slug",
  ],
  // DOL's FY2008 to FY2019 LCA files: the same layout as lca_cases.
  lca_cases_history: [
    "case_number", "case_status", "decision_date", "received_date", "employer_name", "employer_slug",
    "job_title", "soc_code", "soc_title", "worksite_state", "wage", "wage_unit", "visa_class",
    "attorney_name", "attorney_slug",
  ],
};

const DATA: Record<string, Record<string, unknown>[]> = {};
const asked: string[] = [];

vi.mock("./client", () => ({
  rows: async (sql: string) => {
    const pragma = /PRAGMA table_info\((\w+)\)/.exec(sql);
    if (pragma) return (SCHEMA[pragma[1]!] ?? []).map((name) => ({ name }));
    if (/FROM perm_docs/.test(sql)) {
      return [{ json: JSON.stringify({ files: { a: { fy: 2016, caseRows: 10 }, b: { fy: 2010, caseRows: 0 } } }) }];
    }
    const table = /FROM (\w+)/.exec(sql)?.[1] ?? "";
    asked.push(sql.replace(/\s+/g, " "));
    // A select naming a column the table lacks would fail in SQLite.
    const named = [...sql.matchAll(/\b(citizenship|visa_class|education)\b(?! AS)/g)].map((m) => m[1]!);
    for (const c of named) {
      if (!new RegExp(`NULL AS ${c}`).test(sql) && !(SCHEMA[table] ?? []).includes(c)) {
        throw new Error(`no such column: ${c}`);
      }
    }
    if (/COUNT\(\*\)/.test(sql)) return [{ n: (DATA[table] ?? []).length }];
    return DATA[table] ?? [];
  },
}));

vi.mock("./flagCases", () => ({
  slugRange: (s: string) => (s.length >= 2 ? { lo: s, hi: `${s}~` } : null),
}));

import { getCoverageWindows, getDecidedFeed } from "./decidedDays";
import { forgetTableColumns } from "./tableColumns";

function row(n: string, date: string, extra: Record<string, unknown> = {}) {
  return { case_number: n, status: "certified", case_status: "Certified", decision_date: date, ...extra };
}

beforeEach(() => {
  asked.length = 0;
  forgetTableColumns();
  for (const k of Object.keys(DATA)) delete DATA[k];
});

describe("getDecidedFeed across PERM's two tables", () => {
  it("reads perm_cases_history for a range before FY2024 and merges it newest first", async () => {
    DATA.perm_cases = [row("G-100-1", "2023-10-02")];
    DATA.perm_cases_history = [row("A-1", "2023-09-29"), row("A-2", "2023-09-30")];
    const f = await getDecidedFeed({ range: { from: "2023-09-28", to: "2023-10-03" }, programs: ["perm"] });
    expect(f.cases.map((c) => c.caseNumber)).toEqual(["G-100-1", "A-2", "A-1"]);
    expect(asked.some((q) => q.includes("FROM perm_cases_history"))).toBe(true);
  });

  it("never asks the history table for a range after FY2023", async () => {
    await getDecidedFeed({ range: { from: "2025-03-01", to: "2025-03-01" }, programs: ["perm"] });
    expect(asked.some((q) => q.includes("perm_cases_history"))).toBe(false);
  });

  it("caps PERM across both tables, not per table", async () => {
    DATA.perm_cases = [row("G-1", "2023-10-02"), row("G-2", "2023-10-01")];
    DATA.perm_cases_history = [row("A-1", "2023-09-30"), row("A-2", "2023-09-29")];
    const f = await getDecidedFeed({ range: { from: "2023-09-01", to: "2023-10-05" }, programs: ["perm"], cap: 3 });
    expect(f.cases.map((c) => c.caseNumber)).toEqual(["G-1", "G-2", "A-1"]);
    expect(f.capped).toBe(true);
  });
});

describe("getDecidedFeed and DOL's FY2008 to FY2019 LCA files", () => {
  it("reads lca_cases_history for a range before FY2020, on its decision-date index, and merges it newest first", async () => {
    DATA.lca_cases = [row("I-200-19275-1", "2019-10-01")];
    DATA.lca_cases_history = [row("I-200-19270-2", "2019-09-27"), row("I-200-19273-3", "2019-09-30")];
    const f = await getDecidedFeed({ range: { from: "2019-09-25", to: "2019-10-02" }, programs: ["lca"] });
    expect(f.cases.map((c) => c.caseNumber)).toEqual(["I-200-19275-1", "I-200-19273-3", "I-200-19270-2"]);
    const hist = asked.find((q) => q.includes("FROM lca_cases_history") && !q.includes("COUNT"));
    expect(hist).toContain("FROM lca_cases_history INDEXED BY lca_cases_history_decided");
  });

  it("never asks the older table for a range after FY2019", async () => {
    await getDecidedFeed({ range: { from: "2019-10-01", to: "2025-03-01" }, programs: ["lca"] });
    expect(asked.some((q) => q.includes("lca_cases_history"))).toBe(false);
  });

  it("counts one day of the older files exactly", async () => {
    DATA.lca_cases_history = [row("I-200-15100-1", "2015-04-10"), row("I-200-15100-2", "2015-04-10")];
    const f = await getDecidedFeed({ range: { from: "2015-04-10", to: "2015-04-10" }, programs: ["lca"] });
    expect(f.totals?.lca).toBe(2);
    expect(asked.some((q) => q.includes("COUNT(*)") && q.includes("FROM lca_cases_history"))).toBe(true);
  });

  it("reads a state, occupation or firm on the older table by its own index, unpinned", async () => {
    await getDecidedFeed({ range: { from: "2012-01-01", to: "2014-12-31" }, programs: ["lca"], narrow: { state: "WA" } });
    const hist = asked.find((q) => q.includes("FROM lca_cases_history") && !q.includes("COUNT"));
    expect(hist).toMatch(/worksite_state = \?/);
    expect(hist).not.toContain("INDEXED BY");
  });

  it("holds a filter the older table walks row by row to a few days, and says why", async () => {
    // An employer name, a wage, a city or an outcome on its own is tested on each row of the range.
    const wide = await getDecidedFeed({ range: { from: "2015-04-01", to: "2015-04-30" }, programs: ["lca"], narrow: { employer: "acme" } });
    expect(wide.refused).toMatch(/before October 2019/);
    expect(wide.refused).toMatch(/at most one day of them/);
    expect(asked.some((q) => q.includes("lca_cases_history"))).toBe(false);
    // Measured on the live database (Nov 21 2026): three busy days walked took 1.19 s, one day 0.69 s.
    const two = await getDecidedFeed({ range: { from: "2015-04-29", to: "2015-04-30" }, programs: ["lca"], narrow: { employer: "acme" } });
    expect(two.refused).toMatch(/This one holds 2\./);
    const narrow = await getDecidedFeed({ range: { from: "2015-04-30", to: "2015-04-30" }, programs: ["lca"], narrow: { employer: "acme" } });
    expect(narrow.refused).toBeNull();
    const hist = asked.find((q) => q.includes("FROM lca_cases_history") && !q.includes("COUNT"));
    expect(hist).toContain("INDEXED BY lca_cases_history_decided");
    // The same month after FY2019 is not held: the current table answers it as before.
    const current = await getDecidedFeed({ range: { from: "2021-04-01", to: "2021-04-30" }, programs: ["lca"], narrow: { employer: "acme" } });
    expect(current.refused).toBeNull();
    // A program that isn't the LCA's is never held for it.
    const perm = await getDecidedFeed({ range: { from: "2015-04-01", to: "2015-04-30" }, programs: ["perm"], narrow: { employer: "acme" } });
    expect(perm.refused).toBeNull();
  });

  it("answers the other programs when the LCAs are asked beside them, and names the part it left out", async () => {
    DATA.perm_cases_history = [row("A-15100-00001", "2015-04-20")];
    asked.length = 0;
    const f = await getDecidedFeed({ range: { from: "2015-04-01", to: "2015-04-30" }, narrow: { employer: "acme" } });
    expect(f.refused).toBeNull();
    expect(f.cases.map((c) => c.caseNumber)).toEqual(["A-15100-00001"]);
    expect(f.partial).toMatch(/H-1B LCAs decided before October 2019 aren't in this answer/);
    expect(asked.some((q) => q.includes("lca_cases_history"))).toBe(false);
    // The current LCA table still answers its own part of a range that crosses into it.
    asked.length = 0;
    await getDecidedFeed({ range: { from: "2019-09-01", to: "2019-10-31" }, narrow: { employer: "acme" } });
    expect(asked.some((q) => q.includes("FROM lca_cases ") || q.includes("FROM lca_cases\n"))).toBe(true);
    const ok = await getDecidedFeed({ range: { from: "2025-03-01", to: "2025-03-31" }, narrow: { employer: "acme" } });
    expect(ok.partial).toBeNull();
  });
});

describe("filters", () => {
  it("applies a law-firm filter to wage requests and LCAs instead of dropping it", async () => {
    await getDecidedFeed({ range: { from: "2025-03-01", to: "2025-03-01" }, narrow: { attorney: "fragomen" } });
    const pwd = asked.find((q) => q.includes("FROM pwd_cases") && !q.includes("COUNT"));
    expect(pwd).toMatch(/attorney_slug = \?/);
  });

  it("links only the employers and law firms that have a page (Oct 1 2026: 132 404s)", async () => {
    DATA.pwd_cases = [
      row("P-1", "2025-03-01", { employer_slug: "adobe-inc", attorney_slug: "fragomen" }),
      row("P-2", "2025-03-01", { employer_slug: "steamboat-ski-resort-corporation", attorney_slug: "goldstein-law-group" }),
    ];
    // The fake returns every row of a table, so these are the slugs with pages.
    DATA.perm_entities = [{ slug: "adobe-inc" }, { slug: "fragomen" }];
    const f = await getDecidedFeed({ range: { from: "2025-03-01", to: "2025-03-01" }, programs: ["pwd"] });
    const by = Object.fromEntries(f.cases.map((c) => [c.caseNumber, [c.employerSlug, c.attorneySlug]]));
    expect(by["P-1"]).toEqual(["adobe-inc", "fragomen"]);
    expect(by["P-2"]).toEqual([null, null]);
  });

  it("answers nothing for a program that can't carry a filter, rather than ignoring it", async () => {
    DATA.pwd_cases = [row("P-1", "2025-03-01")];
    DATA.perm_cases = [row("G-1", "2025-03-01", { citizenship: "INDIA" })];
    const f = await getDecidedFeed({ range: { from: "2025-03-01", to: "2025-03-01" }, narrow: { citizenship: "INDIA" } });
    expect(f.cases.map((c) => c.program)).toEqual(["perm"]);
    expect(asked.some((q) => q.includes("FROM pwd_cases") && !q.includes("COUNT"))).toBe(false);
  });

  it("selects a column a table hasn't gained yet as NULL instead of failing the table", async () => {
    DATA.perm_cases_history = [row("A-1", "2020-05-05")];
    const f = await getDecidedFeed({ range: { from: "2020-05-05", to: "2020-05-05" }, programs: ["perm"] });
    expect(f.cases.map((c) => c.caseNumber)).toEqual(["A-1"]);
    expect(f.cases[0]!.citizenship).toBeNull();
  });

  it("treats city, industry, citizenship, visa and education as unindexed, held to 92 days", async () => {
    const f = await getDecidedFeed({ range: { from: "2020-01-01", to: "2020-12-31" }, narrow: { city: "Seattle" } });
    expect(f.refused).toMatch(/92 days/);
  });

  it("matches an industry by its leading digits", async () => {
    await getDecidedFeed({ range: { from: "2025-03-01", to: "2025-03-01" }, programs: ["perm"], narrow: { naics: "5415" } });
    const q = asked.find((s) => s.includes("FROM perm_cases") && !s.includes("COUNT"));
    expect(q).toMatch(/naics LIKE \?/);
  });
});

describe("getCoverageWindows", () => {
  it("starts PERM at the history ingest's first stored year, from its record", async () => {
    DATA.perm_cases = [{ v: "2023-10-01" }];
    const w = await getCoverageWindows();
    expect(w.decidedByProgram?.perm?.from).toBe("2015-10-01");
    expect(w.decided?.from).toBe("2015-10-01");
  });

  it("starts the LCAs at the older table's first decision, one seek on its index", async () => {
    DATA.lca_cases = [{ v: "2019-10-01" }];
    DATA.lca_cases_history = [{ v: "2007-10-03" }];
    const w = await getCoverageWindows();
    expect(w.decidedByProgram?.lca?.from).toBe("2007-10-03");
    expect(asked).toContain("SELECT MIN(decision_date) AS v FROM lca_cases_history");
    expect(asked.some((q) => q.includes("MAX(decision_date)") && q.includes("lca_cases_history"))).toBe(false);
  });
});
