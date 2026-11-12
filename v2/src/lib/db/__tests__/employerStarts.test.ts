import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The employer page's wage requests and PERM applications by year: each read bounded by the employer's spellings on
 * the table's employer index, each case counted once across DOL's file and its live record, and the Schedule A
 * count taken from the job groups the wage file names.
 */

vi.mock("server-only", () => ({}));
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
vi.mock("../client", () => ({ rows, one: vi.fn(), exec: vi.fn() }));
const employerMatch = vi.fn();
vi.mock("../employerSlugs", () => ({
  employerMatch,
  slugListMatch: (slugs: string[], basis: "map" | "own") => ({
    where: `employer_slug IN (${slugs.map(() => "?").join(", ")})`,
    args: slugs,
    basis,
    spellings: slugs.length,
  }),
}));
vi.mock("@convex/lib/time", async (original) => ({
  ...(await original<typeof import("@convex/lib/time")>()),
  easternDay: () => "2026-11-12",
}));

const { getEmployerStarts } = await import("../employerStarts");

const mapMatch = (slugs: string[]) => ({
  where: `employer_slug IN (${slugs.map(() => "?").join(", ")})`,
  args: slugs,
  basis: "map" as const,
  spellings: slugs.length,
});

/** Answers the wage read and the PERM read by the table each names. */
const answer = (wage: unknown[], perm: unknown[]) =>
  rows.mockImplementation(async (sql: string) => (sql.includes("FROM pwd_cases") ? wage : perm));

// Braces: a beforeEach that returns the mock has it called as a cleanup hook.
beforeEach(() => {
  rows.mockReset();
  employerMatch.mockReset();
});

describe("an employer's wage requests and PERM applications by year", () => {
  it("gives every year of the window, with the newest filing of each kind", async () => {
    employerMatch.mockResolvedValue(mapMatch(["google-llc"]));
    // libSQL returns every integer as a string.
    answer(
      [
        { y: "2023", g: "15-1252", n: "62", newest: "2023-09-14" },
        { y: "2024", g: "15-1252", n: "1000", newest: "2024-09-27" },
        { y: "2024", g: "11-2021", n: "14", newest: "2024-09-30" },
        { y: "2026", g: "", n: "1598", newest: "2026-11-12" },
        { y: "2026", g: "15-1252", n: "296", newest: "2026-04-02" },
      ],
      [
        { y: "2023", n: "55", newest: "2023-01-20" },
        { y: "2025", n: "1", newest: "2025-03-03" },
        { y: "2026", n: "23", newest: "2026-10-30" },
      ],
    );
    const out = await getEmployerStarts("google-llc");
    expect(out).toEqual({
      years: [
        { year: 2023, wageRequests: 62, permFiled: 55, scheduleA: 0, jobKnown: 62 },
        { year: 2024, wageRequests: 1014, permFiled: 0, scheduleA: 0, jobKnown: 1014 },
        { year: 2025, wageRequests: 0, permFiled: 1, scheduleA: 0, jobKnown: 0 },
        { year: 2026, wageRequests: 1894, permFiled: 23, scheduleA: 0, jobKnown: 296 },
      ],
      newestWageRequest: "2026-11-12",
      newestPerm: "2026-10-30",
    });
  });

  it("counts a nurse or physical therapist request as Schedule A, by the job group DOL's file names", async () => {
    employerMatch.mockResolvedValue(mapMatch(["avant-healthcare-professionals-llc"]));
    answer(
      [
        { y: "2025", g: "29-1141", n: "1900", newest: "2025-12-19" },
        { y: "2025", g: "29-1123", n: "40", newest: "2025-04-11" },
        { y: "2025", g: "13-1071", n: "9", newest: "2025-02-03" },
      ],
      [],
    );
    const out = await getEmployerStarts("avant-healthcare-professionals-llc");
    expect(out?.years.find((r) => r.year === 2025)).toEqual({
      year: 2025,
      wageRequests: 1949,
      permFiled: 0,
      scheduleA: 1940,
      jobKnown: 1949,
    });
    expect(out?.newestPerm).toBeNull();
  });

  it("reads each table on its employer index, the green card kind only, and each case once", async () => {
    employerMatch.mockResolvedValue(mapMatch(["meta-platforms-inc", "meta-platforms-inc-1"]));
    answer([], []);
    await getEmployerStarts("meta-platforms-inc");
    const wage = rows.mock.calls.find((c) => String(c[0]).includes("FROM pwd_cases"))!;
    const perm = rows.mock.calls.find((c) => String(c[0]).includes("FROM perm_cases "))!;
    const w = String(wage[0]);
    expect(w).toContain("FROM pwd_cases INDEXED BY pwd_cases_emp_kind WHERE employer_slug IN (?, ?) AND received_date >= ? AND visa_class = ?");
    expect(w).toContain(
      "FROM pwd_case_status INDEXED BY pwd_case_status_emp_kind WHERE employer_slug IN (?, ?) AND filing_date >= ? AND visa_type = ?",
    );
    expect(w).toContain("GROUP BY case_number");
    expect(w).toContain("substr(soc_code, 1, 7)");
    expect(wage[1]).toEqual([
      "meta-platforms-inc", "meta-platforms-inc-1", "2023-01-01", "PERM",
      "meta-platforms-inc", "meta-platforms-inc-1", "2023-01-01", "PERM",
    ]);
    const p = String(perm[0]);
    expect(p).toContain("FROM perm_cases INDEXED BY idx_pc_emp_dec_recv WHERE employer_slug IN (?, ?) AND decision_date >= ? AND received_date >= ?");
    expect(p).toContain("FROM perm_cases_history INDEXED BY idx_pch_emp_dec_recv WHERE employer_slug IN (?, ?) AND decision_date >= ? AND received_date >= ?");
    expect(p).toContain("FROM perm_live_recent INDEXED BY perm_live_recent_emp_case WHERE employer_slug IN (?, ?) AND filing_date >= ?");
    expect(p).toContain("GROUP BY case_number");
    expect(perm[1]).toEqual([
      "meta-platforms-inc", "meta-platforms-inc-1", "2023-01-01", "2023-01-01",
      "meta-platforms-inc", "meta-platforms-inc-1", "2023-01-01", "2023-01-01",
      "meta-platforms-inc", "meta-platforms-inc-1", "2023-01-01",
    ]);
  });

  it("adds the page's own slug to the PERM read, where the live list files every matched case", async () => {
    // The map names two spellings and neither is the page's slug.
    employerMatch.mockResolvedValue(mapMatch(["visa-usa-inc", "visa-u-s-a-inc-1"]));
    answer([], []);
    await getEmployerStarts("visa-u-s-a-inc");
    const wage = rows.mock.calls.find((c) => String(c[0]).includes("FROM pwd_cases"))!;
    const perm = rows.mock.calls.find((c) => String(c[0]).includes("FROM perm_cases "))!;
    expect((wage[1] as string[]).filter((a) => a === "visa-u-s-a-inc")).toHaveLength(0);
    expect(String(perm[0])).toContain("FROM perm_live_recent INDEXED BY perm_live_recent_emp_case WHERE employer_slug IN (?, ?, ?)");
    expect((perm[1] as string[]).filter((a) => a === "visa-u-s-a-inc")).toHaveLength(3);
  });

  it("keeps an old page's prefix range as it is", async () => {
    employerMatch.mockResolvedValue({
      where: "employer_slug >= ? AND employer_slug < ?",
      args: ["mcrp-farms", "mcrp-farmt"],
      basis: "prefix",
      spellings: null,
    });
    answer([], []);
    await getEmployerStarts("mcrp-farms");
    const perm = rows.mock.calls.find((c) => String(c[0]).includes("FROM perm_cases "))!;
    expect(String(perm[0])).toContain("FROM perm_live_recent INDEXED BY perm_live_recent_emp_case WHERE employer_slug >= ? AND employer_slug < ? AND filing_date >= ?");
  });

  it("gives a mistyped year no row, and never takes its date as the newest", async () => {
    employerMatch.mockResolvedValue(mapMatch(["acme-inc"]));
    answer(
      [
        { y: "2062", g: "15-1252", n: "1", newest: "2062-03-01" },
        { y: "2026", g: "15-1252", n: "12", newest: "2026-05-04" },
      ],
      [{ y: "2027", n: "2", newest: "2027-01-02" }],
    );
    const out = await getEmployerStarts("acme-inc");
    expect(out?.years.map((r) => r.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(out?.newestWageRequest).toBe("2026-05-04");
    expect(out?.newestPerm).toBeNull();
  });

  it("is null for a slug with no employer, and reads nothing", async () => {
    employerMatch.mockResolvedValue(null);
    expect(await getEmployerStarts("nobody")).toBeNull();
    expect(rows).not.toHaveBeenCalled();
  });

  it("throws when a read fails, so the page never stores an empty record for an employer that has one", async () => {
    employerMatch.mockResolvedValue(mapMatch(["acme-inc"]));
    rows.mockRejectedValue(new Error("database is busy"));
    await expect(getEmployerStarts("acme-co")).rejects.toThrow("database is busy");
  });
});
