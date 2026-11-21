import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The count of decided PERM cases naming each wage request: asked once a number, in chunks, with
 * the database's string integers read as numbers. A failed read throws, so no caller can take it
 * for "none".
 */
const rows = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ rows: (...a: unknown[]) => rows(...a) }));

const { permsNaming, casesCitingPwd, CITING_LIMIT } = await import("../caseLinks");

// A block, so nothing is returned: the runner calls whatever a hook returns as its cleanup, and
// `mockReset()` returns the mock itself.
beforeEach(() => {
  rows.mockReset();
});

describe("permsNaming", () => {
  it("asks nothing for no numbers", async () => {
    expect(await permsNaming([])).toEqual(new Map());
    expect(rows).not.toHaveBeenCalled();
  });

  it("counts by wage request, each number asked once, and leaves out the ones nothing names", async () => {
    rows.mockResolvedValue([{ pwd_number: "P-100-24171-129387", n: "2" }]);
    const got = await permsNaming(["P-100-24171-129387", "P-100-24171-129387", "P-100-24246-308380"]);
    expect(got).toEqual(new Map([["P-100-24171-129387", 2]]));
    expect(got.has("P-100-24246-308380")).toBe(false);
    const [sql, params] = rows.mock.calls[0]!;
    expect(sql).toContain("FROM perm_cases WHERE pwd_number IN (?,?) GROUP BY pwd_number");
    expect(params).toEqual(["P-100-24171-129387", "P-100-24246-308380"]);
  });

  it("asks in chunks of 500", async () => {
    rows.mockResolvedValue([]);
    await permsNaming(Array.from({ length: 1201 }, (_, i) => `P-100-24001-${String(i).padStart(6, "0")}`));
    expect(rows.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([500, 500, 201]);
  });

  it("throws when the read fails", async () => {
    rows.mockRejectedValue(new Error("fetch failed"));
    await expect(permsNaming(["P-100-24171-129387"])).rejects.toThrow(/fetch failed/);
  });
});

/**
 * The LCAs and seasonal job orders that cite a wage request, for the link back from its own page (the Nov 20 2026
 * sweep, item 36): one keyed read of each table on its partial index, newest first, a few of each.
 */
describe("casesCitingPwd", () => {
  it("asks each table by the number on its own partial index, newest first, a few of each", async () => {
    rows.mockImplementation(async (sql: string) =>
      sql.includes("FROM lca_cases")
        ? [{ case_number: "I-200-20275-852750", employer_name: "Acme", case_status: "Certified", decision_date: "2020-10-10", visa_class: "H-1B" }]
        : [{ case_number: "H-400-24001-000001", employer_name: "Farm Co", accepted_date: "2024-01-05", visa: "H-2B" }],
    );
    const got = await casesCitingPwd("P-200-20275-852750");
    expect(got).toEqual([
      { caseNumber: "I-200-20275-852750", kind: "lca", program: "H-1B", employerName: "Acme", status: "Certified", day: "2020-10-10" },
      { caseNumber: "H-400-24001-000001", kind: "seasonal", program: "H-2B", employerName: "Farm Co", status: null, day: "2024-01-05" },
    ]);
    const sqls = rows.mock.calls.map((c) => String(c[0]));
    expect(sqls.find((s) => s.includes("FROM lca_cases"))).toMatch(/WHERE pw_case = \? ORDER BY decision_date DESC LIMIT \d+/);
    expect(sqls.find((s) => s.includes("FROM seasonal_postings"))).toMatch(/WHERE pwd_number = \? ORDER BY accepted_date DESC LIMIT \d+/);
    expect(rows.mock.calls.every((c) => (c[1] as unknown[])[0] === "P-200-20275-852750")).toBe(true);
    expect(CITING_LIMIT).toBeLessThanOrEqual(10);
  });

  it("asks nothing for a number that isn't a wage request's", async () => {
    expect(await casesCitingPwd("I-200-20275-852750")).toEqual([]);
    expect(rows).not.toHaveBeenCalled();
  });

  it("drops rows with no case number", async () => {
    rows.mockResolvedValue([{ case_number: null, employer_name: "X" }]);
    expect(await casesCitingPwd("P-100-24171-129387")).toEqual([]);
  });

  it("throws when a read fails, so the page can't take it for none", async () => {
    rows.mockRejectedValue(new Error("fetch failed"));
    await expect(casesCitingPwd("P-100-24171-129387")).rejects.toThrow(/fetch failed/);
  });
});
