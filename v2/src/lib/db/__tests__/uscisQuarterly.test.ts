import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
vi.mock("../client", () => ({ one, rows, exec: vi.fn() }));

const { getUscisFormQuarter } = await import("../uscisQuarterly");

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
