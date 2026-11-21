import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
vi.mock("../client", () => ({ rows, one: vi.fn(), exec: vi.fn() }));

const { employerHistoryCases, employerYears, historyMakeup, workerFacets } = await import("../employerHistory");

/**
 * An employer's older record: its yearly counts, its FY2020 to FY2023 cases and the worker's side of them. A table
 * the history load hasn't made yet holds nothing. A database that can't be read is a failure, and each read throws,
 * so an employer's page (kept for up to 30 days) never stores "no history" for an employer that has one.
 */
describe("the employer history reads", () => {
  beforeEach(() => {
    rows.mockReset();
  });

  const READS: [string, () => Promise<unknown>, unknown][] = [
    ["employerYears", () => employerYears("acme"), []],
    ["employerHistoryCases", () => employerHistoryCases("acme", 5), []],
    ["workerFacets", () => workerFacets("employer", "acme"), {}],
    ["historyMakeup", () => historyMakeup("employer", "acme"), null],
  ];

  it.each(READS)("%s holds nothing when its table isn't made yet", async (_name, read, empty) => {
    rows.mockRejectedValue(new Error("SQLITE_ERROR: no such table: perm_x"));
    expect(await read()).toEqual(empty);
  });

  it.each(READS)("%s throws when the database can't be read", async (_name, read) => {
    rows.mockRejectedValue(new Error("database query deadline"));
    await expect(read()).rejects.toThrow("database query deadline");
  });

  it("shapes the years, oldest first as the table gives them", async () => {
    rows.mockResolvedValue([{ fy: "2019", certified: "12", denied: "1", withdrawn: "0" }, { fy: "2020", certified: "30", denied: "2", withdrawn: "3" }]);
    expect(await employerYears("acme")).toEqual([
      { fy: 2019, certified: 12, denied: 1, withdrawn: 0 },
      { fy: 2020, certified: 30, denied: 2, withdrawn: 3 },
    ]);
    expect(rows.mock.calls[0]![1]).toEqual(["acme"]);
  });

  it("shapes the cases, a missing wage staying missing", async () => {
    rows.mockResolvedValue([
      { case_number: "A-20001-00001", status: "Certified", decision_date: "2020-03-02", job_title: "Engineer", state: "CA", wage: "120000" },
      { case_number: "A-20001-00002", status: "Denied", decision_date: null, job_title: null, state: null, wage: null },
    ]);
    expect(await employerHistoryCases("acme", 2)).toEqual([
      { caseNumber: "A-20001-00001", status: "Certified", decisionDate: "2020-03-02", jobTitle: "Engineer", state: "CA", wage: 120000 },
      { caseNumber: "A-20001-00002", status: "Denied", decisionDate: null, jobTitle: null, state: null, wage: null },
    ]);
    expect(rows.mock.calls[0]![1]).toEqual(["acme", 2]);
  });

  it("groups the worker's side by facet, in the table's order", async () => {
    rows.mockResolvedValue([
      { facet: "citizenship", key: "india", label: "India", n: "40" },
      { facet: "citizenship", key: "china", label: "China", n: "12" },
      { facet: "education", key: "masters", label: "Master's", n: "33" },
    ]);
    expect(await workerFacets("occupation", "15-1252")).toEqual({
      citizenship: [{ key: "india", label: "India", n: 40 }, { key: "china", label: "China", n: 12 }],
      education: [{ key: "masters", label: "Master's", n: 33 }],
    });
    expect(rows.mock.calls[0]![1]).toEqual(["occupation", "15-1252"]);
  });

  it("reads what the older cases were made of in one statement, with their own total and years", async () => {
    rows.mockResolvedValue([
      { facet: "occupation", key: "software-developers", label: "Software Developers", code: "15-1252.00", n: "30", certified: "28", denied: "1", total: "50", fy_from: "2012", fy_to: "2023" },
      { facet: "occupation", key: null, label: "SOFTWARE DEVELOPERS", code: "15-1252", n: "5", certified: "5", denied: "0", total: "50", fy_from: "2012", fy_to: "2023" },
      { facet: "state", key: "WA", label: "WA", code: null, n: "40", certified: "38", denied: "1", total: "50", fy_from: "2012", fy_to: "2023" },
      { facet: "attorney", key: null, label: "Old Firm PC", code: null, n: "9", certified: "9", denied: "0", total: "50", fy_from: "2012", fy_to: "2023" },
    ]);
    const got = await historyMakeup("attorney", "law-firm-llp");
    expect(rows).toHaveBeenCalledTimes(1);
    expect(String(rows.mock.calls[0]![0])).toMatch(/FROM perm_history_entity_facets WHERE kind = \? AND slug = \?/);
    expect(rows.mock.calls[0]![1]).toEqual(["attorney", "law-firm-llp"]);
    expect(got?.total).toBe(50);
    expect(got?.fyFrom).toBe(2012);
    expect(got?.fyTo).toBe(2023);
    // One job printed under both code spellings is one row, as on the current figures.
    expect(got?.facets.occupation).toEqual([
      { key: "software-developers", label: "Software Developers", code: "15-1252.00", n: 35, certified: 33, denied: 1 },
    ]);
    expect(got?.facets.state).toEqual([{ key: "WA", label: "WA", code: null, n: 40, certified: 38, denied: 1 }]);
    expect(got?.facets.attorney?.[0]).toEqual({ key: null, label: "Old Firm PC", code: null, n: 9, certified: 9, denied: 0 });
  });

  it("is nothing for an entity with too few older cases", async () => {
    rows.mockResolvedValue([]);
    expect(await historyMakeup("employer", "tiny")).toBeNull();
  });
});
