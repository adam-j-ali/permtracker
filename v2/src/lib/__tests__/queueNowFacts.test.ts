import { describe, expect, it } from "vitest";

import { queueNowFacts } from "../queueNowFacts";

/** Where DOL is in the PERM line, as the figures every place shows: the month it's deciding, then the oldest open. */
describe("the figures for where DOL is now", () => {
  const deciding = { month: "2026-02", asOf: "2026-11-12" };

  it("lead with the month DOL is deciding, dated by our check, then the oldest month still open", () => {
    expect(queueNowFacts(deciding, "2026-01")).toEqual([
      {
        label: "DOL is deciding now",
        value: "February 2026",
        note: "cases filed that month, by our check of DOL's case status on Nov 12",
      },
      { label: "Oldest month still open", value: "January 2026", note: "the oldest filing month DOL hasn't substantially decided" },
    ]);
  });

  it("show the month once when the oldest open month is the one DOL is deciding", () => {
    expect(queueNowFacts(deciding, "2026-02").map((f) => f.label)).toEqual(["DOL is deciding now"]);
  });

  it("fall back to the oldest open month alone when our check can't be read, and to nothing with neither", () => {
    expect(queueNowFacts(null, "2026-01").map((f) => f.label)).toEqual(["Oldest month still open"]);
    expect(queueNowFacts(null, null)).toEqual([]);
  });
});
