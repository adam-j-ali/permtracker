import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
vi.mock("../client", () => ({ one, rows: vi.fn(), exec: vi.fn() }));

const { getEmployerStages } = await import("../employerStages");
const { h2bGroupOf } = await import("../h2bGroups");
const { getMonthDetail } = await import("../monthDetail");

/**
 * Three one-row reads that used to answer a failed read with "nothing held": the employer stage census, one filing
 * month's recent decisions, and an H-2B application's group. Each throws now. A page whose subject it is keeps its
 * last good render, and a page that only borrows it names a recorded fallback where it calls.
 */
describe("small reads that throw on a failed read", () => {
  beforeEach(() => {
    one.mockReset();
  });

  const READS: [string, () => Promise<unknown>][] = [
    ["getEmployerStages", () => getEmployerStages()],
    ["getMonthDetail", () => getMonthDetail("2026-01")],
    ["h2bGroupOf", () => h2bGroupOf("H-400-26001-123456")],
  ];

  it.each(READS)("%s throws when the database can't be read", async (_name, read) => {
    one.mockRejectedValue(new Error("database query deadline"));
    await expect(read()).rejects.toThrow("database query deadline");
  });

  it.each(READS)("%s answers null when nothing is held", async (_name, read) => {
    one.mockResolvedValue(null);
    expect(await read()).toBeNull();
  });

  it("reads an H-2B application's group, and a list not loaded yet as no group", async () => {
    one.mockResolvedValueOnce({ peak: "2026-04", grp: "B" });
    expect(await h2bGroupOf(" h-400-26001-123456 ")).toEqual({ peak: "2026-04", letter: "B" });
    expect(one.mock.calls[0]![1]).toEqual(["H-400-26001-123456"]);
    one.mockRejectedValueOnce(new Error("SQLITE_ERROR: no such table: h2b_groups"));
    expect(await h2bGroupOf("H-400-26001-123456")).toBeNull();
  });

  it("shows nothing for a month's detail older than three days, as before", async () => {
    one.mockResolvedValue({ json: "{}", computed_at: Date.now() - 4 * 86_400_000 });
    expect(await getMonthDetail("2026-01")).toBeNull();
  });
});
