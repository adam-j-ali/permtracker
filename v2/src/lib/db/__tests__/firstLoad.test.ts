import { describe, expect, it } from "vitest";

import { beforeFirstLoad } from "../firstLoad";

/** The one place a missing table reads as "nothing held". Everything else a read can fail with is a failure. */
describe("beforeFirstLoad", () => {
  it("answers the empty value for a table that isn't made yet, however the driver words it", () => {
    expect(beforeFirstLoad<string[]>([])(new Error("SQLITE_ERROR: no such table: perm_x"))).toEqual([]);
    expect(beforeFirstLoad(null)(new Error("SQLite error: No Such Table: lca_cases_history"))).toBeNull();
    expect(beforeFirstLoad(0)("no such table: x")).toBe(0);
  });

  it("throws anything else, unchanged", () => {
    const down = new Error("database query deadline");
    expect(() => beforeFirstLoad([])(down)).toThrow(down);
    expect(() => beforeFirstLoad(null)(new Error("no such column: pw_case"))).toThrow("no such column");
  });
});
