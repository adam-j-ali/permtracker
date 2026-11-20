import { describe, expect, it } from "vitest";

import { mergeDisclosureSummaries } from "@/lib/disclosureSummary";

/** A program's two disclosure tables read as one: the newer files and the older ones (the LCA's FY2008 to FY2019). */
describe("mergeDisclosureSummaries", () => {
  const newer = { rows: 3754961, earliestReceived: "2016-04-27", latestDecision: "2026-06-30", files: { "FY2026_Q3.xlsx": 437496 }, computedAt: 2 };
  const older = { rows: 5839865, earliestReceived: "2007-09-26", latestDecision: "2019-09-30", files: { "FY2008.xlsx": 405641 }, computedAt: 1 };

  it("sums the rows, spans both tables' dates and keeps every file", () => {
    expect(mergeDisclosureSummaries(newer, older)).toEqual({
      rows: 9594826,
      earliestReceived: "2007-09-26",
      latestDecision: "2026-06-30",
      files: { "FY2026_Q3.xlsx": 437496, "FY2008.xlsx": 405641 },
      computedAt: 2,
    });
  });

  it("is the one that's there when the other is missing", () => {
    expect(mergeDisclosureSummaries(newer, null)).toBe(newer);
    expect(mergeDisclosureSummaries(null, older)).toBe(older);
    expect(mergeDisclosureSummaries(null, null)).toBeNull();
  });

  it("keeps a known date over a missing one", () => {
    expect(mergeDisclosureSummaries({ ...newer, earliestReceived: null }, { ...older, latestDecision: null })).toMatchObject({
      earliestReceived: "2007-09-26",
      latestDecision: "2026-06-30",
    });
  });
});
