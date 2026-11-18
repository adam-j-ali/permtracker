import { describe, expect, it } from "vitest";

import { changeWords, officeStanding, waitPapers, yearChange, type UscisPosted } from "../uscisPosted";

/** The work permit and travel document times USCIS posts for a pending I-485, found by what USCIS calls them. */
const doc = (newest: UscisPosted["newest"]): UscisPosted => ({
  published: "2026-10-19",
  postings: ["2026-10-19"],
  newest,
  series: [],
  longestGapDays: 34,
  project: "x",
});
const row = (form: string, subtype: string, office: string, posted: number | null, label: string, officeLabel: string) => ({
  form, subtype, office, posted, postedText: null, requestDate: null, label, officeLabel,
});

describe("the papers a pending I-485 waits on", () => {
  it("reads the (c)(9) work permit at the National Benefits Center and advance parole wherever USCIS posts it", () => {
    const d = doc([
      row("I-765", "147-C9", "NBC", 12, "Based on a pending I-485 adjustment application [(c)(9)]", "National Benefits Center"),
      row("I-765", "147-C9", "SCD", 9, "Based on a pending I-485 adjustment application [(c)(9)]", "Service Center Operations (SCOPS)"),
      row("I-131", "141A-RT", "SCD", 16.5, "Re-entry permit or refugee travel document", "Service Center Operations (SCOPS)"),
      row("I-131", "141B-OTH", "SCD", 26.5, "Advance parole", "Service Center Operations (SCOPS)"),
    ]);
    expect(waitPapers(d)).toEqual({
      published: "2026-10-19",
      ead: { months: 12, office: "National Benefits Center", subtype: "147-C9", code: "NBC" },
      ap: { months: 26.5, office: "Service Center Operations (SCOPS)", subtype: "141B-OTH", code: "SCD" },
    });
  });

  it("leaves out what USCIS didn't post, and gives nothing with no doc", () => {
    expect(waitPapers(doc([row("I-131", "141B-OTH", "SCD", null, "Advance parole", "Service Center Operations (SCOPS)")]))).toEqual({
      published: "2026-10-19",
      ead: null,
      ap: null,
    });
    expect(waitPapers(null)).toBeNull();
  });
});

describe("where one office stands, and how a posted time moved in a year", () => {
  const fam = (office: string, posted: number | null) => row("I-485", "131A-FAM", office, posted, "Family-based adjustment applications", office);

  it("counts the offices posting a shorter time, ties not counted, over the offices with a figure", () => {
    const d = doc([fam("HAR", 14.5), fam("BOS", 13.5), fam("BUF", 10), fam("CHI", 18.5), fam("ALB", 14.5), fam("XYZ", null)]);
    expect(officeStanding(d, "I-485", "131A-FAM", "HAR")).toEqual({ months: 14.5, shorter: 2, of: 5 });
    expect(officeStanding(d, "I-485", "131A-FAM", "BUF")).toEqual({ months: 10, shorter: 0, of: 5 });
    expect(officeStanding(d, "I-485", "131A-FAM", "XYZ")).toBeNull();
    expect(officeStanding(d, "I-485", "131A-FAM", "NOPE")).toBeNull();
    expect(officeStanding(null, "I-485", "131A-FAM", "HAR")).toBeNull();
  });

  it("compares the newest posting with the one closest to a year before it, within 15 days", () => {
    const points: [string, number][] = [
      ["2025-09-22", 8],
      ["2025-10-20", 9.5],
      ["2025-11-17", 10],
      ["2026-10-19", 12],
    ];
    expect(yearChange(points)).toEqual({ now: 12, nowOn: "2026-10-19", then: 9.5, thenOn: "2025-10-20" });
    expect(yearChange([["2025-10-19", 7], ["2026-10-19", 12]])).toEqual({ now: 12, nowOn: "2026-10-19", then: 7, thenOn: "2025-10-19" });
    // 336 and 392 days back are both too far from the anniversary to call "a year before".
    expect(yearChange([["2025-11-17", 10], ["2026-10-19", 12]])).toBeNull();
    expect(yearChange([["2025-09-22", 8], ["2026-10-19", 12]])).toBeNull();
    expect(yearChange([])).toBeNull();
  });

  it("says the change in words, with the older posting's date", () => {
    expect(changeWords({ now: 12, nowOn: "2026-10-19", then: 9.5, thenOn: "2025-10-20" })).toBe("up from 9.5 months in its October 20, 2025 posting");
    expect(changeWords({ now: 8, nowOn: "2026-10-19", then: 11, thenOn: "2025-10-20" })).toBe("down from 11 months in its October 20, 2025 posting");
    expect(changeWords({ now: 8, nowOn: "2026-10-19", then: 8, thenOn: "2025-10-20" })).toBe("the same as in its October 20, 2025 posting");
  });
});
