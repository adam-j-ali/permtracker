import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The filings DOL's file ties a day's rows to: a decided PERM case's wage request, an LCA's cited
 * one, and the decided PERM cases a wage request is named on. The day's list stands without the
 * last, so a failed read of it leaves the count out and never turns it into "none".
 */
const rows = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(f: T) => f }));
vi.mock("../client", () => ({ rows: (...a: unknown[]) => rows(...a) }));
vi.mock("../entityLinks", () => ({ keepLinkableSlugs: async <T,>(list: T[]) => list }));

const { getFiledOnProgram } = await import("../filingDay");

const live = (over: Record<string, unknown> = {}) => ({
  case_number: "G-100-26030-000001", current_status: "CERTIFIED", employer_name: "Acme Corp", employer_slug: "acme-corp",
  job_title: "Engineer", is_final: 1, file_date: "2026-01-30", decided: "2026-10-01", state: "WA", wage: 120000, wage_unit: "Year",
  ...over,
});
const file = (over: Record<string, unknown> = {}) => ({
  case_number: "G-100-26030-000009", status: "CERTIFIED", employer_name: "Beta LLC", employer_slug: "beta-llc",
  job_title: "Analyst", received_date: "2026-01-30", decided: "2026-09-01", state: "CA", wage: 90000, wage_unit: "Year",
  ...over,
});

// A block, so nothing is returned: the runner calls whatever a hook returns as its cleanup, and
// `mockReset()` returns the mock itself.
beforeEach(() => {
  rows.mockReset();
});

/**
 * Which statement this is. The live one joins its file; a file statement only names the live table
 * inside its "not already listed" test, so the join is what tells them apart.
 */
const isLive = (sql: string, table: string) => new RegExp(`FROM ${table} s\\s+LEFT JOIN`).test(sql);

/** Answer each statement by the table it reads. */
function answer(by: (sql: string) => unknown[] | Error) {
  rows.mockImplementation(async (sql: string) => {
    const got = by(sql);
    if (got instanceof Error) throw got;
    return got;
  });
}

describe("a day's PERM cases", () => {
  it("carry the wage request the current file names, and nothing where the cell isn't one", async () => {
    answer((sql) =>
      isLive(sql, "perm_case_status")
        ? [live({ wage_request: "P-100-25171-129387" }), live({ case_number: "G-100-26030-000002", is_final: 0, current_status: "ANALYST REVIEW", file_date: null, decided: null, wage_request: null })]
        : sql.includes("FROM perm_cases p WHERE")
          ? [file({ wage_request: " p-100-25100-000777 " }), file({ case_number: "G-100-26030-000010", wage_request: "N/A" })]
          : [file({ case_number: "A-19001-00001" })],
    );
    const { cases } = await getFiledOnProgram("2026-01-30", "perm");
    const by = new Map(cases.map((c) => [c.caseNumber, c.wageRequest]));
    expect(by.get("G-100-26030-000001")).toBe("P-100-25171-129387");
    expect(by.get("G-100-26030-000002")).toBeNull();
    expect(by.get("G-100-26030-000009")).toBe("P-100-25100-000777");
    expect(by.get("G-100-26030-000010")).toBeNull();
    // The FY2016 to FY2023 file has no such column, and its statement asks for none.
    expect(by.get("A-19001-00001")).toBeNull();
    const history = rows.mock.calls.map((c) => String(c[0])).find((s) => s.includes("FROM perm_cases_history p"));
    expect(history).not.toContain("pwd_number");
  });
});

describe("a day's wage requests", () => {
  const request = (n: string) => live({ case_number: n, current_status: "DETERMINATION ISSUED", wage_request: null });

  it("say how many decided PERM cases name each, and say nothing for one none does", async () => {
    answer((sql) =>
      sql.includes("FROM perm_cases WHERE pwd_number IN")
        ? [{ pwd_number: "P-100-26030-000001", n: "2" }]
        : isLive(sql, "pwd_case_status")
          ? [request("P-100-26030-000001"), request("P-100-26030-000002")]
          : [],
    );
    const { cases } = await getFiledOnProgram("2026-01-30", "pwd");
    expect(cases.find((c) => c.caseNumber === "P-100-26030-000001")?.namedBy).toBe(2);
    expect(cases.find((c) => c.caseNumber === "P-100-26030-000002")).not.toHaveProperty("namedBy");
  });

  it("still list the day when the counts can't be read, with no count shown as none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    answer((sql) =>
      sql.includes("FROM perm_cases WHERE pwd_number IN")
        ? new Error("fetch failed")
        : isLive(sql, "pwd_case_status")
          ? [request("P-100-26030-000001")]
          : [],
    );
    const { cases } = await getFiledOnProgram("2026-01-31", "pwd");
    expect(cases).toHaveLength(1);
    expect(cases[0]).not.toHaveProperty("namedBy");
    expect(warn.mock.calls.flat().join(" ")).toContain("filingDay/permsNaming");
    warn.mockRestore();
  });

  it("ask for no counts on the seasonal programs, which no PERM case names", async () => {
    answer(() => []);
    await getFiledOnProgram("2026-01-30", "seasonal");
    expect(rows.mock.calls.some((c) => String(c[0]).includes("pwd_number IN"))).toBe(false);
  });
});

describe("a day's LCAs", () => {
  it("carry the wage request the few that cite one name", async () => {
    answer((sql) =>
      isLive(sql, "lca_case_status")
        ? []
        : [file({ case_number: "I-200-26030-123456", wage_request: "P-200-25078-786174" }), file({ case_number: "I-200-26030-123457", wage_request: "" })],
    );
    const { cases } = await getFiledOnProgram("2026-01-30", "lca");
    expect(cases.find((c) => c.caseNumber === "I-200-26030-123456")?.wageRequest).toBe("P-200-25078-786174");
    expect(cases.find((c) => c.caseNumber === "I-200-26030-123457")?.wageRequest).toBeNull();
  });
});
