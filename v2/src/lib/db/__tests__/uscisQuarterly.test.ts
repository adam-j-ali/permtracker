import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
vi.mock("../client", () => ({ one, rows, exec: vi.fn() }));

const { getEbAwaitingVisa, getHistoricalMedians, getI140ClassCountry, getI485Offices, getUscisFormHistory, getUscisFormMedian, getUscisFormQuarter } =
  await import("../uscisQuarterly");

/**
 * USCIS's newest quarter. A table the first load hasn't made yet holds nothing; a database that can't be read is a
 * failure, and the read throws so a page keeps its last good render and never stores "not arrived" for a file that has.
 */
describe("getUscisFormQuarter", () => {
  beforeEach(() => {
    one.mockReset();
    rows.mockReset();
  });

  const ROW = {
    form: "I-140", title: "Immigrant Petition for Alien Workers", category: "Employment", quarter_start: "2026-04-01", quarter_end: "2026-06-30",
    source_file: "quarterly_all_forms_fy2026_q3.xlsx", received: "40000", approved: "30000", denied: "1000", completed: "31000", pending: "90000",
    median_months: "3.9", ytd_received: null, ytd_completed: null, ytd_pending: null,
  };

  it("shapes the newest quarter, with the total kept apart from the forms", async () => {
    one.mockResolvedValue({ fy: "2026", quarter: "3" });
    rows.mockResolvedValue([ROW, { ...ROW, form: "TOTAL", title: "Total", median_months: null }]);
    const q = await getUscisFormQuarter();
    expect(q).toMatchObject({ fy: 2026, quarter: 3, quarterStart: "2026-04-01", quarterEnd: "2026-06-30" });
    expect(q!.forms.map((f) => [f.form, f.medianMonths])).toEqual([["I-140", 3.9]]);
    expect(q!.total?.form).toBe("TOTAL");
    expect(rows.mock.calls[0]![1]).toEqual(["2026", "3"]);
  });

  it("holds nothing when no quarter is loaded, or the table isn't made yet", async () => {
    one.mockResolvedValue(null);
    expect(await getUscisFormQuarter()).toBeNull();
    one.mockRejectedValue(new Error("SQLITE_ERROR: no such table: uscis_form_quarters"));
    expect(await getUscisFormQuarter()).toBeNull();
    one.mockResolvedValue({ fy: 2026, quarter: 3 });
    rows.mockResolvedValue([]);
    expect(await getUscisFormQuarter()).toBeNull();
  });

  it("throws when the database can't be read, on either statement", async () => {
    one.mockRejectedValue(new Error("database query deadline"));
    await expect(getUscisFormQuarter()).rejects.toThrow("database query deadline");
    one.mockResolvedValue({ fy: 2026, quarter: 3 });
    rows.mockRejectedValue(new Error("fetch failed"));
    await expect(getUscisFormQuarter()).rejects.toThrow("fetch failed");
  });
});

/**
 * The same rule for every other read in the file. Each used to answer a failed read with "nothing held", which a
 * page then printed as "USCIS hasn't published this" and kept for its whole cache window.
 */
describe("every other USCIS quarterly read", () => {
  beforeEach(() => {
    one.mockReset();
    rows.mockReset();
  });

  const READS: [string, () => Promise<unknown>, unknown][] = [
    ["getUscisFormHistory", () => getUscisFormHistory("I-140"), []],
    ["getUscisFormMedian", () => getUscisFormMedian("I-485", "Employment"), null],
    ["getI485Offices", () => getI485Offices(), null],
    ["getEbAwaitingVisa", () => getEbAwaitingVisa(), null],
    ["getI140ClassCountry", () => getI140ClassCountry(), null],
    ["getHistoricalMedians", () => getHistoricalMedians(), null],
  ];

  it.each(READS)("%s holds nothing when its table isn't made yet", async (_name, read, empty) => {
    const notMade = new Error("SQLITE_ERROR: no such table: uscis_x");
    one.mockRejectedValue(notMade);
    rows.mockRejectedValue(notMade);
    expect(await read()).toEqual(empty);
  });

  it.each(READS)("%s throws when the database can't be read", async (_name, read) => {
    const down = new Error("database query deadline");
    one.mockRejectedValue(down);
    rows.mockRejectedValue(down);
    await expect(read()).rejects.toThrow("database query deadline");
  });

  it("throws when a later statement fails, after the first one answered", async () => {
    const down = new Error("fetch failed");
    // The field offices: the quarters answer, the newest quarter's rows don't.
    rows.mockResolvedValueOnce([{ fy: 2026, quarter: 3 }]).mockRejectedValueOnce(down);
    await expect(getI485Offices()).rejects.toThrow("fetch failed");
    // The same page's comparison with the quarter before.
    rows.mockReset();
    rows
      .mockResolvedValueOnce([{ fy: 2026, quarter: 3 }, { fy: 2026, quarter: 2 }])
      .mockResolvedValueOnce([{ state: "CA", office: "Los Angeles", code: "LOS", suppressed: 0, quarter_end: "2026-06-30", source_file: "i485.xlsx" }])
      .mockRejectedValueOnce(down);
    await expect(getI485Offices()).rejects.toThrow("fetch failed");
    // Approved petitions waiting for a visa: the dates answer, the cells don't.
    rows.mockReset();
    rows.mockResolvedValueOnce([{ as_of: "2026-06-30" }]).mockRejectedValueOnce(down);
    await expect(getEbAwaitingVisa()).rejects.toThrow("fetch failed");
    // Receipts by class and country: the newest file's date answers, its rows don't.
    rows.mockReset();
    one.mockResolvedValueOnce({ as_of: "2026-Q3" });
    rows.mockRejectedValueOnce(down);
    await expect(getI140ClassCountry()).rejects.toThrow("fetch failed");
  });

  it("still answers what it holds", async () => {
    rows.mockResolvedValueOnce([{ fy: "2026", quarter: "3", quarter_end: "2026-06-30", title: "Employment", median_months: "7.1", pending: "100", received: "50", completed: "40" }]);
    expect(await getUscisFormHistory("I-485")).toEqual([
      { fy: 2026, quarter: 3, quarterEnd: "2026-06-30", title: "Employment", medianMonths: 7.1, pending: 100, received: 50, completed: 40 },
    ]);
    one.mockResolvedValueOnce(null);
    expect(await getUscisFormMedian("I-140")).toBeNull();
  });
});
