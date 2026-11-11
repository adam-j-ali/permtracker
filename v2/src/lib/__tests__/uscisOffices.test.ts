import { describe, expect, it } from "vitest";

import { USCIS_OFFICES, isCenter, officeByCode, officeBySlug, officeHref, officePlace } from "../uscisOffices";
import { officeYear, standing, type OfficeQuarter, type OfficeRow } from "../uscisQuarterlyShape";

describe("the list of USCIS offices", () => {
  it("gives every office one code and one address of its own", () => {
    expect(new Set(USCIS_OFFICES.map((o) => o.code)).size).toBe(USCIS_OFFICES.length);
    expect(new Set(USCIS_OFFICES.map((o) => o.slug)).size).toBe(USCIS_OFFICES.length);
    for (const o of USCIS_OFFICES) {
      // Lower-case words joined by single hyphens.
      expect(o.slug).toMatch(/^[a-z0-9-]+$/);
      expect(o.slug.split("-").every((part) => part.length > 0)).toBe(true);
    }
  });

  it("tells the two Portlands and the two Charlestons apart by state", () => {
    expect(officeByCode("POM")?.slug).toBe("portland-maine");
    expect(officeByCode("POO")?.slug).toBe("portland-oregon");
    expect(officeBySlug("charleston-west-virginia")?.code).toBe("CHS");
    expect(officeBySlug("portland")).toBeUndefined();
  });

  it("names a service center in full, where USCIS's file prints only its state", () => {
    expect(officeByCode("SSC")).toMatchObject({ name: "Texas Service Center", state: "", slug: "texas-service-center" });
    expect(isCenter(officeByCode("NBC")!)).toBe(true);
    expect(isCenter(officeByCode("HAR")!)).toBe(false);
    expect(officePlace(officeByCode("HAR")!)).toBe("Hartford, Connecticut");
    expect(officePlace(officeByCode("NBC")!)).toBe("National Benefits Center");
  });

  it("links an office it holds and nothing else", () => {
    expect(officeHref("HAR")).toBe("/i485-by-field-office/hartford-connecticut");
    expect(officeHref("ZZZ")).toBeNull();
    expect(officeHref("ALL")).toBeNull();
  });
});

const row = (code: string, empPending: number | null): OfficeRow =>
  ({ state: "X", office: code, code, suppressed: 0, empPending }) as unknown as OfficeRow;
const quarter = (fy: number, q: number, rows: OfficeRow[]): OfficeQuarter => ({
  fy,
  quarter: q,
  quarterEnd: `${fy}-0${q}-30`,
  sourceFile: "file",
  byCode: Object.fromEntries(rows.map((r) => [r.code, r])),
});

describe("an office's year", () => {
  it("is its own rows, oldest first, skipping a quarter the file doesn't carry it in", () => {
    const quarters = [
      quarter(2025, 4, [row("HAR", 10), row("BOS", 5)]),
      quarter(2026, 1, [row("BOS", 6)]),
      quarter(2026, 2, [row("HAR", 12), row("BOS", 7)]),
    ];
    const year = officeYear(quarters, "HAR");
    expect(year.map((p) => [p.fy, p.quarter, p.row.empPending])).toEqual([[2025, 4, 10], [2026, 2, 12]]);
    expect(officeYear(quarters, "ZZZ")).toEqual([]);
  });
});

describe("where an office stands", () => {
  const rows = [row("A", 50), row("B", 20), row("C", null), row("D", 20), row("E", 5)];
  const pending = (r: OfficeRow) => r.empPending;

  it("ranks the largest first and counts only offices whose figure can be read", () => {
    expect(standing(rows, "A", pending)).toEqual({ rank: 1, of: 4 });
    expect(standing(rows, "E", pending)).toEqual({ rank: 4, of: 4 });
  });

  it("gives two offices with the same figure the same place", () => {
    expect(standing(rows, "B", pending)).toEqual({ rank: 2, of: 4 });
    expect(standing(rows, "D", pending)).toEqual({ rank: 2, of: 4 });
  });

  it("has no place for a withheld figure or an office that isn't listed", () => {
    expect(standing(rows, "C", pending)).toBeNull();
    expect(standing(rows, "Z", pending)).toBeNull();
  });
});
