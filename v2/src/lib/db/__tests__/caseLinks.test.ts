import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The count of decided PERM cases naming each wage request: asked once a number, in chunks, with
 * the database's string integers read as numbers. A failed read throws, so no caller can take it
 * for "none".
 */
const rows = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ rows: (...a: unknown[]) => rows(...a) }));

const { permsNaming } = await import("../caseLinks");

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
