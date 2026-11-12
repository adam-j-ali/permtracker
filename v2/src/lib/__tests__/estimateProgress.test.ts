import { describe, expect, it } from "vitest";

import { estimateProgress } from "../estimateProgress";

/**
 * How far along a pending case is by its own estimate: the days left to the estimated date and the share of the
 * estimated wait already behind it. Both are read off the estimate, so they can never say more than it does.
 */
describe("a pending case's progress, by its estimate", () => {
  it("counts the days left and the share of the wait that has passed", () => {
    // Arrange: filed February 13, estimated for November 23, read on November 12 (272 of 283 days).
    const got = estimateProgress({ filingDate: "2026-02-13", estimatedDate: "2026-11-23", today: "2026-11-12" });

    // Assert
    expect(got).toEqual({ daysLeft: 11, daysPassed: 272, totalDays: 283, passedPct: 96 });
  });

  it("never reads 100% while the case still waits, and never rounds up", () => {
    // 282 of 283 days is 99.6%: it stays 99.
    expect(estimateProgress({ filingDate: "2026-02-13", estimatedDate: "2026-11-23", today: "2026-11-22" })?.passedPct).toBe(99);
    // 141 of 283 days is 49.8%: it reads 49, since half isn't behind it yet.
    expect(estimateProgress({ filingDate: "2026-02-13", estimatedDate: "2026-11-23", today: "2026-07-04" })?.passedPct).toBe(49);
  });

  it("on the estimated day itself there are no days left and the bar is all but full", () => {
    expect(estimateProgress({ filingDate: "2026-02-13", estimatedDate: "2026-11-23", today: "2026-11-23" })).toEqual({
      daysLeft: 0,
      daysPassed: 283,
      totalDays: 283,
      passedPct: 99,
    });
  });

  it("says nothing once the estimated day is behind us: the estimate is stale, and a count would be made up", () => {
    expect(estimateProgress({ filingDate: "2026-02-13", estimatedDate: "2026-11-23", today: "2026-11-24" })).toBeNull();
  });

  it("says nothing for dates it can't read or an estimate that isn't after the filing", () => {
    expect(estimateProgress({ filingDate: null, estimatedDate: "2026-11-23", today: "2026-11-12" })).toBeNull();
    expect(estimateProgress({ filingDate: "not a date", estimatedDate: "2026-11-23", today: "2026-11-12" })).toBeNull();
    expect(estimateProgress({ filingDate: "2026-11-23", estimatedDate: "2026-11-23", today: "2026-11-23" })).toBeNull();
    expect(estimateProgress({ filingDate: "2026-12-01", estimatedDate: "2026-11-23", today: "2026-11-12" })).toBeNull();
    // A reading dated before the filing is a wrong clock: nothing has passed, so nothing is drawn.
    expect(estimateProgress({ filingDate: "2026-02-13", estimatedDate: "2026-11-23", today: "2026-02-01" })).toBeNull();
  });
});
