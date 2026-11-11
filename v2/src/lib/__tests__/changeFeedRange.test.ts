import { describe, expect, it } from "vitest";

import type { CaseChange, ChangeDay, ChangeDayFeed } from "@/lib/db/changes";
import { RANGE_DAYS_MAX, mergeChangeDays, observedDaysIn } from "../changeFeedRange";

/**
 * A range of recent days on the change feed. It loaded nothing and printed zeros (Nov 11 2026: "is it broken if I
 * do a range?"). The plan picks the days, the merge adds them up, and a range longer than the cap says what it left.
 */

const cal = (dates: [string, number][], truncated = false) => ({
  days: dates.map(([date, total]): ChangeDay => ({ date, total, byProgram: { perm: total, pwd: 0, lca: 0 } })),
  truncated,
});

const row = (caseNumber: string, observedOn: string, toStatus = "CERTIFIED"): CaseChange => ({
  caseNumber,
  program: "perm",
  observedOn,
  fromStatus: "ANALYST REVIEW",
  toStatus,
  isFinal: true,
  employerName: "Example Inc",
  employerSlug: null,
  jobTitle: "Engineer",
  filingDate: "2026-02-02",
});

const feed = (date: string, over: Partial<ChangeDayFeed> = {}): ChangeDayFeed => ({
  date,
  changes: [row(`G-100-26033-${date.slice(8)}0001`, date)],
  total: 1,
  byProgram: { perm: 1, pwd: 0, lca: 0 },
  transitions: [{ fromStatus: "ANALYST REVIEW", toStatus: "CERTIFIED", n: 1 }],
  expiriesExcluded: 0,
  bulkExcluded: 0,
  ...over,
});

describe("observedDaysIn", () => {
  const calendar = cal([["2026-11-11", 25], ["2026-11-10", 2599], ["2026-11-09", 3696], ["2026-11-07", 197]]);

  it("picks the days in the range that hold changes, newest first", () => {
    expect(observedDaysIn({ from: "2026-11-10", to: "2026-11-11" }, calendar)).toEqual({ dates: ["2026-11-11", "2026-11-10"], left: 0 });
  });

  it("skips a day the calendar doesn't list, without asking for it", () => {
    // Nov 8 holds nothing in this calendar.
    expect(observedDaysIn({ from: "2026-11-07", to: "2026-11-09" }, calendar).dates).toEqual(["2026-11-09", "2026-11-07"]);
  });

  it("loads the newest days of a range longer than the cap, and counts what it left", () => {
    const long = cal(Array.from({ length: 12 }, (_, i): [string, number] => [`2026-10-${String(20 - i).padStart(2, "0")}`, 5]));
    const plan = observedDaysIn({ from: "2026-10-01", to: "2026-10-31" }, long);
    expect(plan.dates).toHaveLength(RANGE_DAYS_MAX);
    expect(plan.dates[0]).toBe("2026-10-20");
    expect(plan.left).toBe(12 - RANGE_DAYS_MAX);
  });

  it("asks for days older than a cut-off calendar reaches, since it can't rule them out", () => {
    const cut = cal([["2026-11-11", 25], ["2026-11-10", 2599]], true);
    expect(observedDaysIn({ from: "2026-11-08", to: "2026-11-10" }, cut).dates).toEqual(["2026-11-10", "2026-11-09", "2026-11-08"]);
    // A whole calendar is trusted: the same range asks for the one listed day.
    expect(observedDaysIn({ from: "2026-11-08", to: "2026-11-10" }, cal([["2026-11-11", 25], ["2026-11-10", 2599]])).dates).toEqual(["2026-11-10"]);
  });

  it("answers nothing for a backwards range, an empty calendar, or a range with no listed day", () => {
    expect(observedDaysIn({ from: "2026-11-11", to: "2026-11-10" }, calendar)).toEqual({ dates: [], left: 0 });
    expect(observedDaysIn({ from: "2026-11-10", to: "2026-11-11" }, cal([]))).toEqual({ dates: [], left: 0 });
    expect(observedDaysIn({ from: "2026-11-01", to: "2026-11-05" }, calendar)).toEqual({ dates: [], left: 0 });
  });

  it("can't be made to spin by a very long range", () => {
    const plan = observedDaysIn({ from: "1990-01-01", to: "2026-11-11" }, cal([["2026-11-11", 25]], true));
    expect(plan.dates).toHaveLength(RANGE_DAYS_MAX);
  });
});

describe("mergeChangeDays", () => {
  it("is null for no days", () => {
    expect(mergeChangeDays([])).toBeNull();
  });

  it("adds every count up and keeps the rows of each day, newest day first", () => {
    const a = feed("2026-11-10", {
      total: 2599,
      byProgram: { perm: 2000, pwd: 500, lca: 99 },
      transitions: [
        { fromStatus: "ANALYST REVIEW", toStatus: "CERTIFIED", n: 754 },
        { fromStatus: "ANALYST REVIEW", toStatus: "DENIED", n: 36 },
      ],
      expiriesExcluded: 998,
      bulkExcluded: 3,
    });
    const b = feed("2026-11-11", {
      total: 25,
      byProgram: { perm: 25, pwd: 0, lca: 0 },
      transitions: [
        { fromStatus: "ANALYST REVIEW", toStatus: "WITHDRAWN", n: 25 },
        { fromStatus: "ANALYST REVIEW", toStatus: "CERTIFIED", n: 1 },
      ],
      expiriesExcluded: 2,
    });
    const m = mergeChangeDays([a, b])!;
    expect(m).toMatchObject({ date: "2026-11-11", since: "2026-11-10", days: 2, total: 2624, expiriesExcluded: 1000, bulkExcluded: 3 });
    expect(m.byProgram).toMatchObject({ perm: 2025, pwd: 500, lca: 99 });
    // A program a day's feed doesn't name adds nothing, and still reads as a number.
    expect(m.byProgram.seasonal).toBe(0);
    expect(m.transitions).toEqual([
      { fromStatus: "ANALYST REVIEW", toStatus: "CERTIFIED", n: 755 },
      { fromStatus: "ANALYST REVIEW", toStatus: "DENIED", n: 36 },
      { fromStatus: "ANALYST REVIEW", toStatus: "WITHDRAWN", n: 25 },
    ]);
    expect(m.changes.map((c) => c.observedOn)).toEqual(["2026-11-11", "2026-11-10"]);
  });

  it("doesn't change the feeds it was given", () => {
    const a = feed("2026-11-10");
    const b = feed("2026-11-11");
    mergeChangeDays([a, b]);
    expect(a.transitions[0]!.n).toBe(1);
    expect(b.transitions[0]!.n).toBe(1);
  });

  it("reads one day as a range of one", () => {
    expect(mergeChangeDays([feed("2026-11-11")])).toMatchObject({ date: "2026-11-11", since: "2026-11-11", days: 1, total: 1 });
  });
});
