import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A failed read is never "no such group": it throws, so the page keeps its last good render instead of caching a
 * 404 for 30 days. Only a table that isn't there yet (a fresh database) reads as empty.
 */
const one = vi.fn();
const rows = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ one: (...a: unknown[]) => one(...a), rows: (...a: unknown[]) => rows(...a) }));

const { getGroup, listGroups, countryYears } = await import("../groups");

beforeEach(() => {
  one.mockReset();
  rows.mockReset();
});

describe("the group readers", () => {
  it("throw on a failed read, so the page isn't turned into a 404", async () => {
    one.mockRejectedValue(new Error("SERVER_ERROR: database is locked"));
    await expect(getGroup("industry", "manufacturing-x")).rejects.toThrow(/locked/);
    rows.mockRejectedValue(new Error("fetch failed"));
    await expect(listGroups("country")).rejects.toThrow(/fetch failed/);
    await expect(countryYears("india-x")).rejects.toThrow(/fetch failed/);
  });

  it("read as empty only when the table isn't there yet", async () => {
    one.mockRejectedValue(new Error("SQLITE_ERROR: no such table: perm_groups"));
    await expect(getGroup("industry", "manufacturing-y")).resolves.toBeNull();
    rows.mockRejectedValue(new Error("SQLITE_ERROR: no such table: perm_country_years"));
    await expect(listGroups("industry")).resolves.toEqual([]);
    await expect(countryYears("india-y")).resolves.toEqual([]);
  });
});
