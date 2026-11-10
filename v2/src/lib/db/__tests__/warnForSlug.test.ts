import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rows = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown[]>>();
vi.mock("../client", () => ({ rows, one: vi.fn(), exec: vi.fn() }));

const { matchedWarn, warnForSlug, warnTotals } = await import("../warn");

describe("warnForSlug", () => {
  beforeEach(() => {
    rows.mockReset();
  });

  it("reads the sponsor's notices newest first", async () => {
    rows.mockResolvedValue([]);
    await warnForSlug("northwind-traders-inc");
    const [sql, args] = rows.mock.calls[0]!;
    expect(sql).toContain("WHERE employer_slug = ? ORDER BY notice_date DESC");
    expect(args).toEqual(["northwind-traders-inc", 10]);
  });

  it("throws on a failed read instead of answering that the sponsor has no notices", async () => {
    rows.mockRejectedValue(new Error("database query deadline"));
    await expect(warnForSlug("contoso-logistics-llc")).rejects.toThrow("database query deadline");
  });
});

/**
 * The layoffs page's two reads. Its whole subject is these notices, so a failed read must never print "0 notices":
 * it throws, and the page keeps its last good render.
 */
describe("the layoffs page's reads", () => {
  beforeEach(() => {
    rows.mockReset();
  });

  const READS: [string, () => Promise<unknown>, unknown][] = [
    ["matchedWarn", () => matchedWarn(), []],
    ["warnTotals", () => warnTotals(), { notices: 0, matched: 0, employees: 0 }],
  ];

  it.each(READS)("%s throws on a failed read", async (_name, read) => {
    rows.mockRejectedValue(new Error("database query deadline"));
    await expect(read()).rejects.toThrow("database query deadline");
  });

  it.each(READS)("%s holds nothing before the table's first load", async (_name, read, empty) => {
    rows.mockRejectedValue(new Error("SQLITE_ERROR: no such table: warn_notices"));
    expect(await read()).toEqual(empty);
  });

  it("counts what the table holds, and reads the matched notices newest first", async () => {
    rows.mockResolvedValueOnce([{ notices: "5200", matched: "800", employees: "91000" }]);
    expect(await warnTotals()).toEqual({ notices: 5200, matched: 800, employees: 91000 });
    rows.mockResolvedValueOnce([]);
    await matchedWarn(9000);
    const [sql, args] = rows.mock.calls[1]!;
    expect(sql).toContain("WHERE employer_slug IS NOT NULL ORDER BY notice_date DESC");
    expect(args).toEqual([5000]);
  });
});
