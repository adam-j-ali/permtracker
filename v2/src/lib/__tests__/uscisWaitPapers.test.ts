import { describe, expect, it } from "vitest";

import { waitPapers, type UscisPosted } from "../uscisPosted";

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
      ead: { months: 12, office: "National Benefits Center" },
      ap: { months: 26.5, office: "Service Center Operations (SCOPS)" },
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
