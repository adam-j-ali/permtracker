import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The H-2B and CW-1 wage requests (P-400, P-500) are the seasonal programs' cases, decided in DOL's prevailing wage
 * file: their decided record is read from there, merged into an employer's seasonal list, and never listed as a wage
 * request, even with every visa asked for (src/lib/wageRequestRanges.ts).
 */
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
vi.mock("server-only", () => ({}));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(f: T) => f }));
vi.mock("../client", () => ({ rows: (...a: [string, unknown[]?]) => rows(...a), one: (...a: [string, unknown[]?]) => one(...a), exec: vi.fn() }));

const { seasonal } = await import("../seasonalCases");
const { searchPwdDeterminations } = await import("../pwdCases");
const { SEASONAL_WAGE_REQUEST_FROM, isSeasonalWageRequest } = await import("@/lib/wageRequestRanges");

const row = (case_number: string, received_date: string) => ({ case_number, case_status: "DETERMINATION ISSUED", received_date, employer_name: "Acme Farms" });

describe("H-2B and CW-1 wage requests", () => {
  beforeEach(() => {
    one.mockReset();
    rows.mockReset();
  });

  it("splits DOL's prevailing wage file at P-400 by number alone", () => {
    expect(SEASONAL_WAGE_REQUEST_FROM).toBe("P-400-");
    expect(isSeasonalWageRequest("P-400-26272-268643")).toBe(true);
    expect(isSeasonalWageRequest("P-500-26001-000001")).toBe(true);
    expect(isSeasonalWageRequest("P-100-26232-000009")).toBe(false);
    expect(isSeasonalWageRequest("P-203-26146-948740")).toBe(false);
  });

  it("a seasonal lookup finds a P-400 request's decided record in the prevailing wage file", async () => {
    one.mockImplementation(async (sql: string) => (sql.includes("FROM pwd_cases") ? row("P-400-26272-268643", "2026-09-29") : null));
    const got = await seasonal.lookupDisclosed("P-400-26272-268643");
    expect(got?.caseNumber).toBe("P-400-26272-268643");
    const sqls = one.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain("FROM seasonal_cases WHERE case_number = ?");
    expect(sqls[1]).toContain("FROM pwd_cases WHERE case_number = ? AND case_number >= 'P-400-'");
  });

  it("an employer's seasonal list merges its applications and its H-2B requests, newest first", async () => {
    rows.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) return [{ n: 2 }];
      return sql.includes("FROM pwd_cases") ? [row("P-400-26100-000002", "2026-04-10")] : [row("H-400-26090-000001", "2026-04-01")];
    });
    one.mockResolvedValue({ n: 2 });
    const got = await seasonal.searchDisclosed({ text: "Acme Farms" });
    expect(got.map((r) => r.caseNumber)).toEqual(["P-400-26100-000002", "H-400-26090-000001"]);
    const extra = rows.mock.calls.map((c) => String(c[0])).find((s) => s.includes("FROM pwd_cases"));
    expect(extra).toContain("INDEXED BY pwd_cases_emp");
    expect(extra).toContain("case_number >= 'P-400-'");
  });

  it("a wage request search never reaches the H-2B and CW-1 requests, even with every visa", async () => {
    rows.mockResolvedValue([]);
    one.mockResolvedValue({ n: 0 });
    await searchPwdDeterminations({ text: "Acme Farms", visa: "all" });
    const read = rows.mock.calls.map((c) => String(c[0])).find((s) => s.includes("FROM pwd_cases"));
    expect(read).toContain("case_number < 'P-400-'");
  });
});
