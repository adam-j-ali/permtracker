/** Every Convex table has a retention rule, and every rule names a table the schema still has (plan item A23). */
import { describe, expect, it } from "vitest";

import schema from "../schema";
import { TABLE_RETENTION } from "./tableRetention";

const tables = Object.keys((schema as unknown as { tables: Record<string, unknown> }).tables).sort();

describe("TABLE_RETENTION", () => {
  it("names every table in the schema", () => {
    expect(tables.length).toBeGreaterThan(60);
    expect(tables.filter((t) => !(t in TABLE_RETENTION))).toEqual([]);
  });
  it("names no table the schema no longer has", () => {
    expect(Object.keys(TABLE_RETENTION).filter((t) => !tables.includes(t))).toEqual([]);
  });
  it("writes a rule for each", () => {
    expect(Object.entries(TABLE_RETENTION).filter(([, e]) => e.rule.trim().length < 10).map(([t]) => t)).toEqual([]);
  });
});
