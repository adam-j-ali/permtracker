import { beforeEach, describe, expect, it, vi } from "vitest";
import { pythonFinalSet } from "./pythonFinalSet";

/** The LCA program: same factory, different prefix, no default visa filter. */

vi.mock("server-only", () => ({}));

const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
const exec = vi.fn<(sql: string, args?: unknown[]) => Promise<number>>();
vi.mock("../client", () => ({
  rows,
  one,
  exec,
  // The pagers count the rows read (rowsPaged); these tests read through `rows`.
  rowsPaged: async (sql: string, args: unknown[], take: number) => {
    const r = await rows(sql, args);
    return { page: r.slice(0, take), more: r.length > take, consumed: Math.min(r.length, take) };
  },
}));

const { LCA_FINAL_STATUSES, listLcaCases, lookupLcaDisclosed, lookupLcaRecord, normaliseLcaCaseNumber, searchLcaCases, searchLcaDisclosed } =
  await import("../lcaCases");
const { BROAD_NAME_ROWS } = await import("../flagCases");

beforeEach(() => {
  rows.mockReset();
  rows.mockResolvedValue([]);
  one.mockReset();
});

describe("LCA numbers and finality", () => {
  it("accepts I- numbers of any visa-class segment and nothing else", () => {
    expect(normaliseLcaCaseNumber(" i-200-26239-199948 ")).toBe("I-200-26239-199948");
    expect(normaliseLcaCaseNumber("I-203-26239-199943")).toBe("I-203-26239-199943");
    expect(normaliseLcaCaseNumber("P-100-26240-200135")).toBeNull();
    expect(normaliseLcaCaseNumber("G-100-26240-200246")).toBeNull();
  });

  it("mirrors the Python ingest's final set byte for byte", () => {
    expect(pythonFinalSet("lca")).toEqual(new Set(LCA_FINAL_STATUSES));
  });
});

describe("LCA reads have no program filter, because every row is an LCA", () => {
  it("search", async () => {
    await searchLcaCases({ text: "versaflair" });
    const [sql, args] = rows.mock.calls[0]!;
    // INDEXED BY is asserted, not incidental: without it a status or month
    // narrowing moved the plan onto `lca_case_status_stage` and read every
    // LCA at that status for every employer in the country.
    expect(sql).toMatch(
      /FROM lca_case_status INDEXED BY lca_case_status_emp WHERE employer_slug >= \? AND employer_slug < \? ORDER BY/,
    );
    expect(args).toEqual(["versaflair", "versaflais", 200]);
  });

  it("list", async () => {
    await listLcaCases({ kind: "pending", numItems: 5 });
    const [sql, args] = rows.mock.calls[0]!;
    expect(sql).toMatch(/FROM lca_case_status WHERE is_final = \? ORDER BY filing_date DESC, case_number DESC LIMIT \? OFFSET \?/);
    expect(args).toEqual([0, 6, 0]);
  });
});

describe("the published LCA file: a broad name is read newest-first (Sentry 59)", () => {
  it("counts the name's filings on the name index, at most one past the line", async () => {
    one.mockResolvedValueOnce({ n: 12 });
    await searchLcaDisclosed({ text: "Am" });
    const [sql, args] = one.mock.calls[0]!;
    expect(sql).toContain(`FROM lca_cases INDEXED BY lca_cases_emp WHERE employer_slug >= ? AND employer_slug < ? LIMIT ${BROAD_NAME_ROWS + 1}`);
    expect(args).toEqual(["am", "an"]);
  });

  it("reads a small name on the name index, sorted", async () => {
    one.mockResolvedValueOnce({ n: BROAD_NAME_ROWS });
    await searchLcaDisclosed({ text: "tuopu" });
    expect(rows.mock.calls[0]![0]).toContain("FROM lca_cases INDEXED BY lca_cases_emp WHERE");
  });

  it("reads a broad name newest-first and stops at the limit", async () => {
    // libSQL can hand the count back as a string.
    one.mockResolvedValueOnce({ n: String(BROAD_NAME_ROWS + 1) });
    await searchLcaDisclosed({ text: "Am" });
    const [sql, args] = rows.mock.calls[0]!;
    expect(sql).toMatch(/FROM lca_cases INDEXED BY lca_cases_recv WHERE employer_slug >= \? AND employer_slug < \? ORDER BY received_date DESC, case_number DESC LIMIT \?/);
    expect(args).toEqual(["am", "an", 200]);
  });

  it("falls back to the name index when the count can't be read", async () => {
    one.mockResolvedValueOnce(null);
    await searchLcaDisclosed({ text: "Am" });
    expect(rows.mock.calls[0]![0]).toContain("INDEXED BY lca_cases_emp");
  });
});

describe("the published LCA file: a name with a job title counts the title's matches (Sentry 59, Nov 2 2026)", () => {
  it("counts the matches on the title index, which holds the title, at most one past the line", async () => {
    one.mockResolvedValueOnce({ n: 37 });
    await searchLcaDisclosed({ text: "EMC", title: "Senior Principal Software Engineer" });
    const [sql, args] = one.mock.calls[0]!;
    expect(sql).toContain("FROM lca_cases INDEXED BY lca_cases_emp_title WHERE employer_slug >= ? AND employer_slug < ? AND job_title LIKE ?");
    expect(sql).toContain(`LIMIT ${BROAD_NAME_ROWS + 1}`);
    expect(args).toEqual(["emc", "emd", "%Senior Principal Software Engineer%"]);
  });

  it("reads a few matches on the title index", async () => {
    // EMC holds 2,204 LCAs, more than the line, so the name alone went newest-first and walked every LCA in the
    // file looking for 37 matches: 15 to 20 s under load. The title index reads EMC's own entries (0.03 s).
    one.mockResolvedValueOnce({ n: 37 });
    await searchLcaDisclosed({ text: "EMC", title: "Senior Principal Software Engineer" });
    expect(one).toHaveBeenCalledTimes(1);
    expect(rows.mock.calls[0]![0]).toContain("FROM lca_cases INDEXED BY lca_cases_emp_title WHERE");
  });

  it("reads many matches newest-first, where the walk stops early", async () => {
    one.mockResolvedValueOnce({ n: BROAD_NAME_ROWS + 1 });
    await searchLcaDisclosed({ text: "Am", title: "Software Engineer" });
    expect(rows.mock.calls[0]![0]).toContain("FROM lca_cases INDEXED BY lca_cases_recv WHERE");
  });

  it("falls back to the title index when the count can't be read", async () => {
    one.mockResolvedValueOnce(null);
    await searchLcaDisclosed({ text: "EMC", title: "Engineer" });
    expect(rows.mock.calls[0]![0]).toContain("INDEXED BY lca_cases_emp_title");
  });
});

describe("the older LCA files with a job title read on their own title index (Sentry 61, Nov 19 2026)", () => {
  it("tests the title on the history table's title index, so it never opens each old filing", async () => {
    // "Deloitte" and "Security Engineer": the current files gave too few, so the older files filled the rest on
    // the employer index alone, opening each of Deloitte's 97,155 FY2008 to FY2019 LCAs: past the 20 s deadline.
    one.mockResolvedValueOnce({ n: 3 });
    await searchLcaDisclosed({ text: "Deloitte", title: "Security Engineer" });
    const [sql, args] = rows.mock.calls[1]!;
    expect(sql).toContain("FROM lca_cases_history INDEXED BY lca_cases_history_emp_title WHERE employer_slug >= ? AND employer_slug < ? AND job_title LIKE ?");
    expect(args).toEqual(["deloitte", "deloittf", "%Security Engineer%", 200]);
  });

  it("keeps the employer index for the older files when no title narrows the search", async () => {
    one.mockResolvedValueOnce({ n: 3 });
    await searchLcaDisclosed({ text: "tuopu" });
    expect(rows.mock.calls[1]![0]).toContain("FROM lca_cases_history INDEXED BY lca_cases_history_emp WHERE");
  });

  it("falls back to the employer index while the title index isn't built", async () => {
    one.mockResolvedValueOnce({ n: 3 });
    rows.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("SQLITE_ERROR: no such index: lca_cases_history_emp_title"));
    await expect(searchLcaDisclosed({ text: "Deloitte", title: "Security Engineer" })).resolves.toEqual([]);
    expect(rows.mock.calls[2]![0]).toContain("FROM lca_cases_history INDEXED BY lca_cases_history_emp WHERE");
  });

  it("still throws any other failure of the older files' read", async () => {
    one.mockResolvedValueOnce({ n: 3 });
    rows.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("database query deadline (20000ms, local read)"));
    await expect(searchLcaDisclosed({ text: "Deloitte", title: "Security Engineer" })).rejects.toThrow(/deadline/);
  });
});

describe("what DOL's file prints about an LCA's job", () => {
  const ROW = {
    pw_case: " p-100-25340-123456 ", wage_level: "II", pw_wage: "118000", pw_unit: "Year", pw_oes_year: "7/1/2025 - 6/30/2026",
    worksite_city: "San Jose", worksite_county: "Santa Clara", workers: "1", new_employment: "1", continued_employment: "0",
    change_previous_employment: "0", new_concurrent_employment: "0", change_employer: "0", amended_petition: "0",
    begin_date: "2026-01-05", end_date: "2029-01-04", attorney_name: "Firm LLP", attorney_slug: "firm-llp", naics: "541511",
    h1b_dependent: "N", willful_violator: "No",
  };

  it("reads the current files' table, cleaning the wage request number and naming the petition", async () => {
    one.mockResolvedValueOnce(ROW);
    const got = await lookupLcaRecord(" i-200-26055-173457 ");
    expect(got).toMatchObject({
      wageRequest: "P-100-25340-123456", level: "II", prevailingWage: 118000, prevailingSource: "OFLC wage data, 7/1/2025 - 6/30/2026",
      worksiteCity: "San Jose", worksiteCounty: "Santa Clara", workers: 1, kinds: ["New employment"], h1bDependent: false,
      willfulViolator: false, attorneySlug: "firm-llp", naics: "541511",
    });
    const [sql, args] = one.mock.calls[0]!;
    expect(sql).toContain("FROM lca_cases WHERE case_number = ?");
    expect(args).toEqual(["I-200-26055-173457"]);
    expect(one).toHaveBeenCalledTimes(1);
  });

  it("falls back to the FY2008 to FY2019 table, which carries the same fields, so an older LCA keeps them", async () => {
    one.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...ROW, pw_oes_year: null, pw_other_source: "Other", pw_survey_publisher: "Radford", pw_other_year: "2015" });
    const got = await lookupLcaRecord("I-200-15055-1");
    expect(one.mock.calls[1]![0]).toContain("FROM lca_cases_history WHERE case_number = ?");
    expect(got).toMatchObject({ level: "II", prevailingWage: 118000, prevailingSource: "Other, Radford (2015)" });
  });

  it("answers nothing for a number neither table holds, a missing older table, or something that isn't an LCA number", async () => {
    one.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(lookupLcaRecord("I-200-26055-1")).resolves.toBeNull();
    one.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("no such table: lca_cases_history"));
    await expect(lookupLcaRecord("I-200-26055-1")).resolves.toBeNull();
    one.mockReset();
    await expect(lookupLcaRecord("G-100-26055-173457")).resolves.toBeNull();
    expect(one).not.toHaveBeenCalled();
  });

  it("names no wage request for an empty cell or one that isn't a wage request", async () => {
    one.mockResolvedValueOnce({ ...ROW, pw_case: "N/A" });
    expect((await lookupLcaRecord("I-200-26055-1"))?.wageRequest).toBeNull();
  });

  it("lets any other failed read fail, so the page can say it couldn't read it", async () => {
    one.mockRejectedValueOnce(new Error("query deadline"));
    await expect(lookupLcaRecord("I-200-26055-1")).rejects.toThrow(/deadline/);
    one.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("query deadline"));
    await expect(lookupLcaRecord("I-200-26055-1")).rejects.toThrow(/deadline/);
  });
});

describe("DOL's FY2008 to FY2019 files, in lca_cases_history", () => {
  const row = (case_number: string, received_date: string) => ({
    case_number, case_status: "CERTIFIED", received_date, decision_date: received_date, employer_name: "Acme",
    employer_slug: "acme", job_title: "Engineer", soc_code: "15-1132", soc_title: "x", wage: 90000, wage_unit: "YEAR",
    worksite_state: "CA", visa_class: "H-1B", source_file: "H-1B_Disclosure_Data_FY17.xlsx",
  });

  it("answers a number the current files don't hold from the older files", async () => {
    one.mockResolvedValueOnce(null).mockResolvedValueOnce(row("I-200-16055-173457", "2016-02-24"));
    const got = await lookupLcaDisclosed("I-200-16055-173457");
    expect(got?.caseNumber).toBe("I-200-16055-173457");
    expect(one.mock.calls[1]![0]).toContain("FROM lca_cases_history WHERE case_number = ?");
  });

  it("never asks the older files about a number the current files hold", async () => {
    one.mockResolvedValueOnce(row("I-200-21055-1", "2021-02-24"));
    await lookupLcaDisclosed("I-200-21055-1");
    expect(one).toHaveBeenCalledTimes(1);
  });

  it("reads an older table that isn't loaded yet as nothing, and any other failure as a failure", async () => {
    one.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("SQLite error: no such table: lca_cases_history"));
    await expect(lookupLcaDisclosed("I-200-16055-1")).resolves.toBeNull();
    one.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("query deadline"));
    await expect(lookupLcaDisclosed("I-200-16055-1")).rejects.toThrow(/deadline/);
  });

  it("fills an employer search's room from the older files, newest first, and only its room", async () => {
    one.mockResolvedValueOnce({ n: 3 });
    rows.mockResolvedValueOnce([row("I-200-21001-1", "2021-01-05")]).mockResolvedValueOnce([
      row("I-200-21001-1", "2021-01-05"), // a case in both tables appears once
      row("I-200-17001-2", "2017-01-05"),
    ]);
    const got = await searchLcaDisclosed({ text: "acme", limit: 50 });
    expect(got.map((r) => r.caseNumber)).toEqual(["I-200-21001-1", "I-200-17001-2"]);
    const [sql, args] = rows.mock.calls[1]!;
    expect(sql).toContain("FROM lca_cases_history INDEXED BY lca_cases_history_emp WHERE employer_slug >= ? AND employer_slug < ?");
    expect(sql).toContain("ORDER BY received_date DESC, case_number DESC LIMIT ?");
    expect(args!.at(-1)).toBe(49);
  });

  it("never reads the older files when the current ones fill the limit", async () => {
    one.mockResolvedValueOnce({ n: 3 });
    rows.mockResolvedValueOnce([row("I-200-21001-1", "2021-01-05"), row("I-200-21001-2", "2021-01-04")]);
    await searchLcaDisclosed({ text: "acme", limit: 2 });
    expect(rows).toHaveBeenCalledTimes(1);
  });

  it("keeps the current rows when the older table isn't loaded yet", async () => {
    one.mockResolvedValueOnce({ n: 3 });
    rows.mockResolvedValueOnce([row("I-200-21001-1", "2021-01-05")])
      .mockRejectedValueOnce(new Error("SQLite error: no such table: lca_cases_history"));
    await expect(searchLcaDisclosed({ text: "acme", limit: 50 })).resolves.toHaveLength(1);
  });
});
