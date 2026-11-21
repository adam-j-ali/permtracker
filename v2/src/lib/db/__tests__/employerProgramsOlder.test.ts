import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The employer page's "every program" ledger read PERM from FY2024 and LCAs from FY2020, beside a chart from FY2008
 * (the Nov 20 2026 sweep, item 16), and an employer whose LCAs are all in DOL's FY2008 to FY2019 files read "0
 * published". Its published counts now add the older files' (olderFiles.ts), and its medians, which read the newer
 * files only, say which years they cover.
 */

vi.mock("server-only", () => ({}));
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
vi.mock("../client", () => ({ one, rows: vi.fn(), exec: vi.fn() }));
vi.mock("../employerSlugs", () => ({
  employerMatch: vi.fn(async () => ({ where: "employer_slug IN (?)", args: ["acme"], basis: "map", spellings: 1 })),
}));
const employerOlderFiles = vi.fn<(slug: string) => Promise<unknown>>();
vi.mock("../olderFiles", () => ({ employerOlderFiles }));

const { getEmployerPrograms } = await import("../employerPrograms");

beforeEach(() => {
  one.mockReset();
  employerOlderFiles.mockReset();
  one.mockImplementation(async (sql: string) => {
    if (sql.includes("is_final = 0")) return { n: 2 };
    if (sql.includes("COUNT(*)")) return { n: 10, wage_n: 10 };
    if (sql.includes("ORDER BY")) return { annual: 100_000, wage: 15 };
    return null;
  });
});

describe("the ledger's older years", () => {
  it("adds the older files to PERM's and the LCA's published counts, and dates their medians", async () => {
    employerOlderFiles.mockResolvedValue({ perm: 1200, lca: 25, lcaRow: { filings: 25 } });
    const out = await getEmployerPrograms("acme");
    expect(employerOlderFiles).toHaveBeenCalledWith("acme");
    expect(out?.perm).toMatchObject({ published: 1210, olderPublished: 1200, medianFromFy: 2024, wageN: 10 });
    expect(out?.lca).toMatchObject({ published: 35, olderPublished: 25, medianFromFy: 2020, wageN: 10 });
    // Wage requests have no older file: nothing added, and no year on the median.
    expect(out?.pwd.published).toBe(10);
    expect(out?.pwd.medianFromFy).toBeUndefined();
  });

  it("gives an employer whose LCAs are all in the older files its count, never 0 published", async () => {
    one.mockImplementation(async (sql: string) => (sql.includes("COUNT(*)") ? { n: 0, wage_n: 0 } : null));
    employerOlderFiles.mockResolvedValue({ perm: 0, lca: 25, lcaRow: { filings: 25 } });
    const out = await getEmployerPrograms("acme");
    expect(out?.lca.published).toBe(25);
    expect(out?.lca.medianAnnualWage).toBeNull();
  });

  it("dates the medians before the older counts are built, and adds nothing", async () => {
    employerOlderFiles.mockResolvedValue(null);
    const out = await getEmployerPrograms("acme");
    expect(out?.perm).toMatchObject({ published: 10, olderPublished: 0, medianFromFy: 2024 });
    expect(out?.lca).toMatchObject({ published: 10, olderPublished: 0, medianFromFy: 2020 });
  });

  it("fails with the older files' read rather than print the newer files alone as every year", async () => {
    employerOlderFiles.mockRejectedValue(new Error("SERVER_ERROR: database is locked"));
    await expect(getEmployerPrograms("acme")).rejects.toThrow("locked");
  });
});
