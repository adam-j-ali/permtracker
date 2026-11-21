import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What DOL's older yearly files hold for one employer: its PERM decisions FY2008 to FY2023 and its LCAs FY2008 to
 * FY2019, counted when those files load (perm_employer_years, history_lca_spellings). The employer page's program
 * ledger and its LCA panel add them to the newer files' counts, so a page never prints the newer files alone beside a
 * chart from FY2008 (the Nov 20 2026 sweep, items 16 and 17). What must hold: one cheap read of the two small tables
 * in the main database, never the older tables themselves, over the same spellings as the rest of the page.
 */

vi.mock("server-only", () => ({}));
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
vi.mock("../client", () => ({ one, rows: vi.fn(), exec: vi.fn() }));
const employerMatch = vi.fn<(slug: string) => Promise<unknown>>();
vi.mock("../employerSlugs", () => ({ employerMatch }));

const { employerOlderFiles, olderFilesSql } = await import("../olderFiles");
const { NEWER_FROM_FY } = await import("@/lib/employerPrograms");
const { statementHome } = await import("../lcaRoute");

const MAP = { where: "employer_slug IN (?, ?)", args: ["acme", "acme-inc"], basis: "map", spellings: 2 };

beforeEach(() => {
  one.mockReset();
  employerMatch.mockReset();
  employerMatch.mockResolvedValue(MAP);
});

describe("employerOlderFiles", () => {
  it("reads the two small tables once, over the employer's spellings, in the main database", async () => {
    one.mockResolvedValue({ perm_n: "1200", filings: "25", fy_from: "2011", certified: "20", level_rows: "9" });
    const got = await employerOlderFiles("acme");
    expect(one).toHaveBeenCalledTimes(1);
    const [sql, args] = one.mock.calls[0]!;
    expect(sql).toContain("FROM perm_employer_years WHERE slug IN (?, ?) AND fy < ?");
    expect(sql).toContain("FROM history_lca_spellings WHERE employer_slug IN (?, ?)");
    expect(args).toEqual(["acme", "acme-inc", NEWER_FROM_FY.perm, "acme", "acme-inc"]);
    expect(statementHome(sql)).toBe("main");
    expect(sql).not.toMatch(/perm_cases_history|lca_cases/);
    expect(got?.perm).toBe(1200);
    expect(got?.lca).toBe(25);
    expect(got?.lcaRow).toMatchObject({ filings: "25", fy_from: "2011", level_rows: "9" });
  });

  it("counts PERM's older years only, so FY2024 on (read from perm_cases) isn't counted twice", () => {
    expect(NEWER_FROM_FY.perm).toBe(2024);
    expect(NEWER_FROM_FY.lca).toBe(2020);
    expect(olderFilesSql("employer_slug IN (?)")).toMatch(/SUM\(certified \+ denied \+ withdrawn\) FROM perm_employer_years/);
  });

  it("reads an employer with no older LCAs as none, with its older PERM cases kept", async () => {
    one.mockResolvedValue({ perm_n: 40, filings: null });
    const got = await employerOlderFiles("acme");
    expect(got).toEqual({ perm: 40, lca: 0, lcaRow: null });
  });

  it("follows the old prefix range on both tables before the map's first build", async () => {
    employerMatch.mockResolvedValue({ where: "employer_slug >= ? AND employer_slug < ?", args: ["acme", "acmf"], basis: "prefix", spellings: null });
    one.mockResolvedValue({ perm_n: 1, filings: 1 });
    await employerOlderFiles("acme");
    const [sql, args] = one.mock.calls[0]!;
    expect(sql).toContain("WHERE slug >= ? AND slug < ? AND fy < ?");
    expect(sql).toContain("WHERE employer_slug >= ? AND employer_slug < ?");
    expect(args).toEqual(["acme", "acmf", 2024, "acme", "acmf"]);
  });

  it("is null before the tables are built, and throws on any other failure", async () => {
    one.mockRejectedValueOnce(new Error("SQLITE_ERROR: no such table: history_lca_spellings"));
    expect(await employerOlderFiles("acme")).toBeNull();
    // A table built before the profile's columns: not built yet as far as this read goes.
    one.mockRejectedValueOnce(new Error("SQLITE_ERROR: no such column: level_rows"));
    expect(await employerOlderFiles("acme")).toBeNull();
    one.mockRejectedValueOnce(new Error("SERVER_ERROR: database is locked"));
    await expect(employerOlderFiles("acme")).rejects.toThrow("locked");
  });

  it("reads nothing for a page with no spellings", async () => {
    employerMatch.mockResolvedValue(null);
    expect(await employerOlderFiles("nobody")).toBeNull();
    expect(one).not.toHaveBeenCalled();
  });
});
