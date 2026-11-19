import { describe, expect, it } from "vitest";

import { SHEETS, sheetFor } from "../communitySheets";

describe("the sheets this site reads", () => {
  it("names each sheet with its office, its link and the day it was shared", () => {
    const sfv = sheetFor("sfv-filers");
    expect(sfv?.office).toBe("SFV");
    expect(sfv?.url).toMatch(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/htmlview$/);
    expect(SHEETS.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.shared))).toBe(true);
  });
});
