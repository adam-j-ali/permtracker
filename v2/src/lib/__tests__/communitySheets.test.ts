import { describe, expect, it } from "vitest";

import { SHEETS, sheetFor } from "../communitySheets";

describe("the sheets this site reads", () => {
  it("names each sheet with its office, its link and the day it was shared", () => {
    const sfv = sheetFor("sfv-filers");
    expect(sfv?.office).toBe("SFV");
    expect(sfv?.url).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/htmlview$/);
    // A share date is only ever a verified day; a sheet whose first day isn't known has none.
    expect(SHEETS.every((s) => s.shared === undefined || /^\d{4}-\d{2}-\d{2}$/.test(s.shared))).toBe(true);
    expect(SHEETS.every((s) => /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/htmlview$/.test(s.url))).toBe(true);
    expect(new Set(SHEETS.map((s) => s.key)).size).toBe(SHEETS.length);
  });
});
