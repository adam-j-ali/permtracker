import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The settlements page's record of each company (src/lib/db/sponsorRecords.ts). Its H-1B count reads every
 * spelling the nightly map gives the employer's page, as the employer page itself does: one company files
 * LCAs under several (Nov 4 2026), and a read of the page's own slug alone missed the rest.
 */
const one = vi.fn();
const employerMatch = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ one: (...a: unknown[]) => one(...a) }));
vi.mock("../employerSlugs", () => ({ employerMatch: (...a: unknown[]) => employerMatch(...a) }));

import { getSponsorRecord } from "../sponsorRecords";

beforeEach(() => {
  one.mockReset();
  employerMatch.mockReset();
  one.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM perm_entities")) return { total: 120, name: "Acme Corp" };
    if (sql.includes("FROM lca_case_status")) return { n: 7 };
    return null;
  });
});

describe("getSponsorRecord", () => {
  it("counts the LCAs of every spelling the map gives the page", async () => {
    employerMatch.mockResolvedValue({ where: "employer_slug IN (?, ?)", args: ["acme-corp", "acme-corporation"] });
    const r = await getSponsorRecord("acme-corp", "2026-05-12");
    const call = one.mock.calls.find(([sql]) => String(sql).includes("lca_case_status"))!;
    expect(call[0]).toContain("employer_slug IN (?, ?)");
    expect(call[1]).toEqual(["acme-corp", "acme-corporation", "2026-05-12"]);
    expect(r).toMatchObject({ name: "Acme Corp", perm: 120, lcaSince: 7, since: "2026-05-12" });
  });

  it("reads the page's own slug when the map has nothing for it", async () => {
    employerMatch.mockResolvedValue(null);
    await getSponsorRecord("acme-corp", "2026-05-12");
    const call = one.mock.calls.find(([sql]) => String(sql).includes("lca_case_status"))!;
    expect(call[1]).toEqual(["acme-corp", "2026-05-12"]);
  });

  it("counts the employer's decided PERM filings in every year DOL published, FY2008 on", async () => {
    employerMatch.mockResolvedValue(null);
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM perm_entities")) return { total: 120, name: "Acme Corp" };
      // The yearly table the employer page charts: FY2008 on, the current files' years included.
      if (sql.includes("FROM perm_employer_years")) return { n: 2_480 };
      return null;
    });
    const r = await getSponsorRecord("acme-corp", "2026-05-12");
    expect(r.perm).toBe(2_480);
    const call = one.mock.calls.find(([sql]) => String(sql).includes("perm_employer_years"))!;
    expect(call[1]).toEqual(["acme-corp"]);
  });

  it("finds the newest filing in the older table when the current files and the live record hold none since", async () => {
    employerMatch.mockResolvedValue(null);
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM perm_entities")) return { total: 0, name: "Acme Corp" };
      if (sql.includes("FROM perm_cases_history")) return { d: "2022-11-03" };
      return null;
    });
    const r = await getSponsorRecord("acme-corp", "2026-05-12");
    expect(r.lastPerm).toBe("2022-11-03");
    const call = one.mock.calls.find(([sql]) => String(sql).includes("perm_cases_history"))!;
    expect(call[0]).toContain("SELECT MAX(received_date) AS d FROM perm_cases_history WHERE employer_slug = ?");
  });

  it("never reads the older table when a newer filing is already in hand", async () => {
    employerMatch.mockResolvedValue(null);
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM perm_entities")) return { total: 10, name: "Acme Corp" };
      if (sql.includes("FROM perm_cases WHERE")) return { d: "2025-03-01" };
      return null;
    });
    const r = await getSponsorRecord("acme-corp", "2026-05-12");
    expect(r.lastPerm).toBe("2025-03-01");
    expect(one.mock.calls.some(([sql]) => String(sql).includes("perm_cases_history"))).toBe(false);
  });

  it("throws on a failed read, so the page keeps its last good render", async () => {
    employerMatch.mockResolvedValue(null);
    one.mockRejectedValue(new Error("database is busy"));
    await expect(getSponsorRecord("acme-corp", "2026-05-12")).rejects.toThrow("database is busy");
  });
});
