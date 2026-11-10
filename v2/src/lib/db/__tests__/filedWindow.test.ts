import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The read behind the finder's window of days (owner, Nov 10 2026: a date range, and any of an employer, a job
 * title and a law firm). What has to hold: the window is in every statement, what was typed reaches the database
 * with its wildcards escaped, a firm is read from the files alone, an LCA's two databases are never joined, a case
 * is listed once, and a read that stops at its limit says so.
 */
const rows = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ rows: (...a: unknown[]) => rows(...a) }));
vi.mock("../entityLinks", () => ({ keepLinkableSlugs: async <T,>(list: T[]) => list }));

const { getFiledInWindow, getWindowEmployers, WINDOW_READ_MAX } = await import("../filedWindow");

const NONE = { employerStem: "", titleWords: [], firmWords: [] };
const live = (over: Record<string, unknown> = {}) => ({
  case_number: "G-100-26005-000001", status: "ANALYST REVIEW", employer_name: "Acme Corp", employer_slug: "acme-corp",
  job_title: "Engineer", is_final: 0, filed_on: "2026-01-05", file_date: null, decided: null, state: null, wage: null,
  wage_unit: "Year", wage_request: null, attorney_name: null,
  ...over,
});
const file = (over: Record<string, unknown> = {}) => ({
  case_number: "G-100-26005-000009", status: "CERTIFIED", employer_name: "Beta LLC", employer_slug: "beta-llc",
  job_title: "Analyst", is_final: 1, filed_on: "2026-01-06", decided: "2026-09-01", state: "CA", wage: 90000,
  wage_unit: "Year", wage_request: "P-100-25300-123456", attorney_name: "Smith Immigration PC", file_only: 1,
  ...over,
});

/**
 * Which table a PERM statement reads. A file statement also names the live table, inside its "not already listed"
 * test, so the file's own FROM is what tells the three apart.
 */
const permTable = (sql: string) => (/FROM perm_cases_history p/.test(sql) ? "history" : /FROM perm_cases p/.test(sql) ? "file" : "live");

type Call = { sql: string; args: unknown[] };
const calls = (): Call[] => rows.mock.calls.map(([sql, args]) => ({ sql: String(sql).replace(/\s+/g, " "), args: args as unknown[] }));

beforeEach(() => {
  rows.mockReset();
  rows.mockResolvedValue([]);
});

describe("a window of PERM filings", () => {
  it("reads the live record and both files, each between the two days, newest first, to its limit", async () => {
    await getFiledInWindow("perm", "2026-01-01", "2026-01-31", NONE);
    const c = calls();
    expect(c).toHaveLength(3);
    expect(c[0]!.sql).toContain("FROM perm_case_status s");
    expect(c[0]!.sql).toContain("s.is_final IN (0, 1) AND s.filing_date BETWEEN ? AND ?");
    expect(c[0]!.sql).toContain("ORDER BY s.filing_date DESC, s.case_number LIMIT ?");
    expect(c[1]!.sql).toContain("FROM perm_cases p WHERE p.received_date BETWEEN ? AND ?");
    expect(c[2]!.sql).toContain("FROM perm_cases_history p WHERE p.received_date BETWEEN ? AND ?");
    for (const call of c) expect(call.args).toEqual(["2026-01-01", "2026-01-31", WINDOW_READ_MAX]);
    // A file's case the live record holds is the live record's to list.
    expect(c[1]!.sql).toContain("NOT EXISTS (SELECT 1 FROM perm_case_status s WHERE s.case_number = p.case_number)");
  });

  it("sends each typed word of a job title as its own contains-match, wildcards escaped", async () => {
    await getFiledInWindow("perm", "2026-01-01", "2026-01-31", { ...NONE, titleWords: ["data", "100%_sure"] });
    const [first] = calls();
    expect(first!.sql.match(/s\.job_title LIKE \? ESCAPE/g)).toHaveLength(2);
    expect(first!.args).toEqual(["2026-01-01", "2026-01-31", "%data%", "%100\\%\\_sure%", WINDOW_READ_MAX]);
  });

  it("narrows by the start of an employer's name with the printed name's spaces and punctuation taken out", async () => {
    await getFiledInWindow("perm", "2026-01-01", "2026-01-31", { ...NONE, employerStem: "jpm" });
    const [liveCall, fileCall] = calls();
    expect(liveCall!.sql).toContain("REPLACE(LOWER(s.employer_name), ' ', '')");
    expect(liveCall!.sql).toMatch(/'&', ''\), '-', ''\)/);
    expect(fileCall!.sql).toContain("REPLACE(LOWER(p.employer_name), ' ', '')");
    expect(liveCall!.args).toEqual(["2026-01-01", "2026-01-31", "%jpm%", WINDOW_READ_MAX]);
  });

  it("reads a law firm from the files alone, where DOL names it", async () => {
    await getFiledInWindow("perm", "2026-01-01", "2026-01-31", { ...NONE, firmWords: ["smith", "pc"] });
    const c = calls();
    expect(c).toHaveLength(2);
    expect(c.every((call) => !call.sql.includes("FROM perm_case_status s"))).toBe(true);
    expect(c[0]!.sql.match(/p\.attorney_name LIKE \? ESCAPE/g)).toHaveLength(2);
    expect(c[0]!.args).toEqual(["2026-01-01", "2026-01-31", "%smith%", "%pc%", WINDOW_READ_MAX]);
  });

  it("lists a case once, the live row first, with what its file adds and the firm it names", async () => {
    rows.mockImplementation(async (sql: string) => {
      const table = permTable(sql);
      if (table === "live") {
        return [live({ status: "certified", is_final: 1, file_date: "2026-01-07", decided: "2026-10-01", state: "wa", wage: 120000, attorney_name: "Smith Immigration PC" })];
      }
      return table === "file" ? [file(), file({ case_number: "G-100-26005-000001" })] : [];
    });
    const { cases, capped } = await getFiledInWindow("perm", "2026-01-01", "2026-01-31", NONE);
    expect(capped).toBe(false);
    expect(cases.map((x) => x.caseNumber)).toEqual(["G-100-26005-000001", "G-100-26005-000009"]);
    expect(cases[0]).toMatchObject({
      status: "CERTIFIED", final: true, filedOn: "2026-01-05", source: "both", fileDate: "2026-01-07", decided: "2026-10-01",
      state: "WA", firm: "Smith Immigration PC", employer: "Acme Corp", employerSlug: "acme-corp",
    });
    expect(cases[0]!.wage).toContain("$120,000");
    expect(cases[1]).toMatchObject({ final: true, source: "file", fileDate: null, filedOn: "2026-01-06", wageRequest: "P-100-25300-123456" });
  });

  it("says a read stopped at its limit, and drops a row with no filing day", async () => {
    rows.mockImplementation(async (sql: string) =>
      permTable(sql) === "live"
        ? [...Array.from({ length: WINDOW_READ_MAX }, (_, i) => live({ case_number: `G-${i}` })), live({ case_number: "G-undated", filed_on: null })]
        : [],
    );
    const { cases, capped } = await getFiledInWindow("perm", "2026-01-01", "2026-01-31", NONE);
    expect(capped).toBe(true);
    expect(cases).toHaveLength(WINDOW_READ_MAX);
  });

  it("throws a failed read on: never an empty answer", async () => {
    rows.mockRejectedValue(new Error("SERVER_ERROR: database is locked"));
    await expect(getFiledInWindow("perm", "2026-01-01", "2026-01-31", NONE)).rejects.toThrow("database is locked");
  });
});

describe("wage requests and the seasonal programs", () => {
  it.each([
    ["pwd", "pwd_case_status", "pwd_cases"],
    ["seasonal", "seasonal_case_status", "seasonal_cases"],
  ] as const)("%s reads its live table with its file beside it, then the file's own cases", async (program, liveTable, fileTable) => {
    await getFiledInWindow(program, "2026-03-01", "2026-03-31", { ...NONE, titleWords: ["farmworker"] });
    const c = calls();
    expect(c).toHaveLength(2);
    expect(c[0]!.sql).toContain(`FROM ${liveTable} s LEFT JOIN ${fileTable} p ON p.case_number = s.case_number`);
    expect(c[0]!.sql).toContain("s.filing_date BETWEEN ? AND ?");
    expect(c[1]!.sql).toContain(`FROM ${fileTable} p WHERE p.received_date BETWEEN ? AND ?`);
    expect(c[1]!.sql).toContain(`NOT EXISTS (SELECT 1 FROM ${liveTable} s WHERE s.case_number = p.case_number)`);
    expect(c[1]!.args).toEqual(["2026-03-01", "2026-03-31", "%farmworker%", WINDOW_READ_MAX]);
  });

  it("with a firm typed, reads the file alone", async () => {
    await getFiledInWindow("pwd", "2026-03-01", "2026-03-31", { ...NONE, firmWords: ["fragomen"] });
    const c = calls();
    expect(c).toHaveLength(1);
    expect(c[0]!.sql).toContain("FROM pwd_cases p WHERE p.received_date BETWEEN ? AND ?");
    expect(c[0]!.sql).not.toContain("pwd_case_status");
  });
});

describe("H-1B LCAs, held on two databases", () => {
  it("never joins the file's table to the live one, and asks for a live case's file details by number", async () => {
    rows.mockImplementation(async (sql: string, args: unknown[]) => {
      if (/FROM lca_case_status s/.test(sql)) {
        return [
          live({ case_number: "I-200-26005-000001", status: "CERTIFIED", is_final: 1 }),
          live({ case_number: "I-200-26005-000002" }),
        ];
      }
      if (/p\.case_number IN/.test(sql)) {
        expect(args).toEqual(["I-200-26005-000002"]);
        return [file({ case_number: "I-200-26005-000002", filed_on: "2026-02-20", state: "TX", attorney_name: "Late Firm LLP" })];
      }
      return [file({ case_number: "I-200-26005-000001", state: "NY" }), file({ case_number: "I-200-26005-000003" })];
    });
    const { cases } = await getFiledInWindow("lca", "2026-01-01", "2026-01-31", NONE);
    for (const call of calls()) {
      const namesFile = call.sql.includes("lca_cases");
      const namesLive = call.sql.includes("lca_case_status");
      expect(namesFile && namesLive, call.sql.slice(0, 80)).toBe(false);
    }
    expect(cases.map((x) => x.caseNumber)).toEqual(["I-200-26005-000001", "I-200-26005-000002", "I-200-26005-000003"]);
    expect(cases[0]).toMatchObject({ state: "NY", source: "both", final: true });
    // The file dates the second case outside the window: its details still come, and the page says the file's day.
    expect(cases[1]).toMatchObject({ state: "TX", fileDate: "2026-02-20", firm: "Late Firm LLP", final: false });
    expect(cases[2]).toMatchObject({ source: "file", final: true });
  });

  it("with a firm typed, reads the file's database alone", async () => {
    await getFiledInWindow("lca", "2026-01-01", "2026-01-31", { ...NONE, firmWords: ["smith"] });
    const c = calls();
    expect(c).toHaveLength(1);
    expect(c[0]!.sql).toContain("FROM lca_cases p WHERE p.received_date BETWEEN ? AND ?");
  });
});

describe("the employers that filed in a window", () => {
  it("adds a name's live and file-only cases for PERM, and never counts a case twice", async () => {
    rows.mockImplementation(async (sql: string) => {
      const table = permTable(sql);
      if (table === "live") return [{ employer_name: "Acme Corp", n: 3 }, { employer_name: " ", n: 9 }];
      return table === "file" ? [{ employer_name: "Acme Corp", n: 2 }, { employer_name: "Beta LLC", n: 1 }] : [];
    });
    const names = await getWindowEmployers("perm", "2026-01-01", "2026-01-07");
    expect(names).toEqual([{ employer: "Acme Corp", cases: 5 }, { employer: "Beta LLC", cases: 1 }]);
    expect(calls()[1]!.sql).toContain("NOT EXISTS (SELECT 1 FROM perm_case_status s WHERE s.case_number = p.case_number)");
  });

  it("takes the larger of an LCA name's two counts, since its two databases can't be told apart by case", async () => {
    rows.mockImplementation(async (sql: string) =>
      /lca_case_status/.test(sql) ? [{ employer_name: "Acme Corp", n: 4 }] : [{ employer_name: "Acme Corp", n: 6 }, { employer_name: "Beta LLC", n: 2 }],
    );
    expect(await getWindowEmployers("lca", "2026-01-01", "2026-01-07")).toEqual([
      { employer: "Acme Corp", cases: 6 },
      { employer: "Beta LLC", cases: 2 },
    ]);
  });
});
