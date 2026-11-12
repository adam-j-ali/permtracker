import { describe, expect, it } from "vitest";

import type { ActivityDay } from "@/lib/activityStats";
import type { PwdQueueDay } from "@/lib/pwdNow";
import { dolDays, weekTotals, weekTrend } from "@/lib/dolDays";

/**
 * PERM decisions and wage determinations, side by side for each day. The two counts come from two records (the
 * PERM check's daily rows, the wage check's day document), so a day one of them can't speak to is "not counted",
 * never zero.
 */
const day = (date: string, total: number): ActivityDay => ({ date, total, certified: total, denied: 0, withdrawn: 0 });
const wage = (date: string, issued: number | undefined, n = issued ?? 0): PwdQueueDay => ({ date, n, issued, withdrawn: 0 });

describe("the days both records can speak to", () => {
  it("lists complete days newest first, and leaves today out", () => {
    const perm = [day("2026-11-09", 563), day("2026-11-10", 680), day("2026-11-11", 165), day("2026-11-12", 40)];
    const wages = [wage("2026-11-09", 722), wage("2026-11-10", 852), wage("2026-11-11", 53)];
    expect(dolDays(perm, wages, "2026-11-12", 3)).toEqual([
      { date: "2026-11-11", perm: 165, wage: 53 },
      { date: "2026-11-10", perm: 680, wage: 852 },
      { date: "2026-11-09", perm: 563, wage: 722 },
    ]);
  });

  it("counts a day with no row inside a record's range as zero, and a day outside it as not counted", () => {
    // PERM has no row for the Sunday; the wage record begins a day later than PERM's.
    const perm = [day("2026-11-06", 559), day("2026-11-07", 45), day("2026-11-09", 563)];
    const wages = [wage("2026-11-07", 37), wage("2026-11-08", 0), wage("2026-11-09", 722)];
    expect(dolDays(perm, wages, "2026-11-10", 4)).toEqual([
      { date: "2026-11-09", perm: 563, wage: 722 },
      { date: "2026-11-08", perm: 0, wage: 0 },
      { date: "2026-11-07", perm: 45, wage: 37 },
      { date: "2026-11-06", perm: 559, wage: null },
    ]);
  });

  it("says not counted when one record hasn't reached the newest day yet", () => {
    const perm = [day("2026-11-09", 563), day("2026-11-10", 680)];
    const wages = [wage("2026-11-09", 722), wage("2026-11-10", 852), wage("2026-11-11", 53)];
    expect(dolDays(perm, wages, "2026-11-12", 2)[0]).toEqual({ date: "2026-11-11", perm: null, wage: 53 });
  });

  it("doesn't read a day whose exits aren't split by kind as zero determinations", () => {
    const wages = [wage("2026-11-10", undefined, 300), wage("2026-11-11", 53)];
    expect(dolDays([day("2026-11-10", 680), day("2026-11-11", 165)], wages, "2026-11-12", 2)[1]).toEqual({ date: "2026-11-10", perm: 680, wage: null });
  });

  it("is empty with nothing to read, and drops the old end where neither record has a day", () => {
    expect(dolDays([], [], "2026-11-12")).toEqual([]);
    expect(dolDays([day("2026-11-10", 680)], [], "2026-11-12", 28)).toEqual([{ date: "2026-11-10", perm: 680, wage: null }]);
  });
});

describe("a week against the week before", () => {
  const two = (perm: number[], wages: (number | null)[]) =>
    perm.map((p, i) => ({ date: `2026-11-${String(20 - i).padStart(2, "0")}`, perm: p, wage: wages[i] ?? null }));

  it("adds the newest seven days and the seven before them", () => {
    const days = two([100, 100, 100, 100, 100, 0, 0, 80, 80, 80, 80, 80, 0, 0], [10, 10, 10, 10, 10, 0, 0, 20, 20, 20, 20, 20, 0, 0]);
    expect(weekTotals(days, "perm")).toEqual({ last7: 500, prior7: 400 });
    expect(weekTotals(days, "wage")).toEqual({ last7: 50, prior7: 100 });
  });

  it("gives no week when a day in it wasn't counted, and no earlier week without all seven of its days", () => {
    const days = two([100, 100, 100, 100, 100, 0, 0, 80, 80, 80], [10, 10, null, 10, 10, 0, 0]);
    expect(weekTotals(days, "wage")).toBeNull();
    expect(weekTotals(days, "perm")).toEqual({ last7: 500, prior7: null });
  });

  it("words the change, and calls a week with a holiday in it neither good nor bad", () => {
    expect(weekTrend({ last7: 500, prior7: 400 }, [])).toEqual({ text: "25% more than the week before (400)", dir: "up", tone: "good" });
    expect(weekTrend({ last7: 300, prior7: 400 }, [])).toEqual({ text: "25% fewer than the week before (400)", dir: "down", tone: "bad" });
    expect(weekTrend({ last7: 404, prior7: 400 }, [])).toEqual({ text: "About the same as the week before (400)", dir: "level", tone: "neutral" });
    expect(weekTrend({ last7: 300, prior7: 400 }, ["Veterans Day"])).toEqual({
      text: "25% fewer than the week before (400), with Veterans Day in it",
      dir: "down",
      tone: "neutral",
    });
    expect(weekTrend({ last7: 300, prior7: null }, [])).toBeNull();
    expect(weekTrend({ last7: 300, prior7: 0 }, [])).toBeNull();
  });
});
