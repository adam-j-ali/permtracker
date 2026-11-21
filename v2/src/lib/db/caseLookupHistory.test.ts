import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A case decided in FY2020 to FY2023 lives in `perm_cases_history`, not in
 * `perm_cases`. The lookup must answer from it, and must not spend a live DOL
 * question on a number whose decision is already on record.
 */

const tables: Record<string, Record<string, Record<string, unknown>>> = {};
const asked: string[] = [];
/** A table whose read fails, and how. */
const broken: Record<string, Error> = {};

vi.mock("./client", () => ({
  one: async (sql: string, args: unknown[] = []) => {
    const table = /FROM (\w+)/.exec(sql)?.[1] ?? "";
    asked.push(table);
    if (broken[table]) throw broken[table];
    return tables[table]?.[String(args[0])] ?? null;
  },
}));

const discoverCase = vi.fn();
vi.mock("./caseDiscovery", () => ({
  discoverCase: (...a: unknown[]) => discoverCase(...a),
  discoverCaseOutcome: async (...a: unknown[]) => {
    const found = await discoverCase(...a);
    return { found, miss: found ? null : "none" };
  },
}));
vi.mock("./sweepCoverage", () => ({ getSweepCoverage: async () => null, laterDate: (a: string | null) => a }));
vi.mock("./liveCensus", () => ({
  getLiveCensus: async () => null,
  aheadPendingFrom: () => null,
  monthRowsFrom: () => [],
  statusTotalFrom: () => null,
}));

import { lookupCase } from "./caseLookup";

const OLD = "A-20001-11111";
const DECIDED = {
  status: "certified", received_date: "2020-01-02", decision_date: "2021-03-01", days: 424,
  employer_name: "ACME INC", job_title: "Engineer", soc_title: "Software Developers",
  state: "WA", wage: 104000,
};

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(broken)) delete broken[k];
  asked.length = 0;
  discoverCase.mockReset().mockResolvedValue(null);
});

describe("lookupCase and the FY2020 to FY2023 history", () => {
  it("answers from perm_cases_history when perm_cases has no row", async () => {
    tables.perm_cases_history = { [OLD]: DECIDED };
    const r = await lookupCase(OLD);
    expect(r?.decided).not.toBeNull();
    expect(asked).toContain("perm_cases_history");
    expect(discoverCase).not.toHaveBeenCalled();
  });

  it("prefers perm_cases and never reads history when the current record has it", async () => {
    tables.perm_cases = { [OLD]: { ...DECIDED, status: "denied" } };
    tables.perm_cases_history = { [OLD]: DECIDED };
    await lookupCase(OLD);
    expect(asked).not.toContain("perm_cases_history");
  });

  it("throws when the history can't be read, instead of asking DOL and answering none", async () => {
    broken.perm_cases_history = new Error("turso query deadline");
    await expect(lookupCase(OLD)).rejects.toThrow("turso query deadline");
    expect(discoverCase).not.toHaveBeenCalled();
  });

  it("treats a history table that doesn't exist yet as no record", async () => {
    broken.perm_cases_history = new Error("SQLite error: no such table: perm_cases_history");
    await lookupCase(OLD);
    expect(discoverCase).toHaveBeenCalledOnce();
  });

  it("still asks DOL live when neither table holds the case", async () => {
    await lookupCase(OLD);
    expect(discoverCase).toHaveBeenCalledOnce();
  });
});

describe("the employer's record on the case page", () => {
  const ENTITY = { name: "Acme Inc", slug: "acme-inc", total: 300, certified: 280, denied: 5, median_days: 410 };

  it("counts every year DOL published for the employer, FY2008 on, and says which years", async () => {
    tables.perm_cases_history = { [OLD]: { ...DECIDED, employer_slug: "acme-inc" } };
    tables.perm_entities = { "acme-inc": ENTITY };
    tables.perm_employer_years = {
      "acme-inc": { fy_from: 2009, fy_to: 2026, certified: 1900, denied: 40, withdrawn: 60 },
    };
    const r = await lookupCase(OLD);
    expect(r?.employer).toEqual({
      name: "Acme Inc",
      slug: "acme-inc",
      total: 2000,
      certified: 1900,
      denied: 40,
      approvalRate: 95,
      medianDays: 410,
      fyFrom: 2009,
      fyTo: 2026,
    });
  });

  it("finds the page by the row's own slug when an older file spelled the name differently", async () => {
    // The history load maps an older spelling to today's page; slugifying the spelling would miss it.
    tables.perm_cases_history = { [OLD]: { ...DECIDED, employer_name: "ACME INCORPORATED OF WA", employer_slug: "acme-inc" } };
    tables.perm_entities = { "acme-inc": ENTITY };
    const r = await lookupCase(OLD);
    expect(r?.employer?.slug).toBe("acme-inc");
  });

  it("keeps the page's own counts, labelled with their years, when the yearly table has nothing", async () => {
    tables.perm_cases_history = { [OLD]: { ...DECIDED, employer_slug: "acme-inc" } };
    tables.perm_entities = { "acme-inc": ENTITY };
    const r = await lookupCase(OLD);
    expect(r?.employer).toMatchObject({ total: 300, certified: 280, denied: 5, fyFrom: null, fyTo: null });
  });
});
