import { describe, expect, it } from "vitest";

import { countBusinessDays } from "@/lib/perm";

import {
  estimateNextStart,
  findMonthStarts,
  liveMonthFrom,
  shareDecided,
  type MonthDay,
} from "../monthStart";
import fixture from "./monthStart.fixture.json";

/**
 * The fixture is the past-day census (perm_census_days) for filing months
 * October 2025 to March 2026, Aug 30 to Nov 19 2026: each day's total, decided,
 * on-hold and analyst-review counts per filing month, as the server held them
 * on Nov 16 2026 (through Nov 15) and Nov 20 (Nov 16 to 19). The four starts it
 * holds (December on Sep 22, January on Oct 20, February on Nov 10, March on
 * Nov 17) are DOL's real ones.
 */
const series = fixture as MonthDay[];

/** Working days between two dates, either order: 0 for the same day, 1 for neighbours. */
function businessDaysApart(a: string, b: string): number {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return Math.max(0, countBusinessDays(lo, hi) - 1);
}

/** The series as it stood at the end of `day`, and that day's figures for one month. */
function asOf(day: string, month: string) {
  const known = series.filter((r) => r.day <= day);
  const live = known.find((r) => r.day === day && r.month === month) ?? null;
  return { known, live };
}

describe("findMonthStarts", () => {
  const starts = findMonthStarts(series);

  it("finds the four starts DOL made inside the record, on their days", () => {
    expect(starts.map((s) => [s.month, s.day])).toEqual([
      ["2025-12", "2026-09-22"],
      ["2026-01", "2026-10-20"],
      ["2026-02", "2026-11-10"],
      ["2026-03", "2026-11-17"],
    ]);
  });

  it("measures the month before at the end of the day before, holds left out", () => {
    // March began with February 54% decided, where the three before had begun at 80 to 82.5%: February was a
    // small month. The count still in analyst review held: 1,603 to 2,607 at all four.
    const shares = starts.map((s) => Math.round(s.previousShare * 1000) / 10);
    expect(shares).toEqual([80, 80.9, 82.5, 53.8]);
    expect(starts.map((s) => s.previousInLine)).toEqual([2607, 2557, 1603, 2258]);
    expect(starts[2]).toMatchObject({ previous: "2026-01", previousWorkable: 11635 - 1230, previousDecided: 8582 });
  });

  it("skips a month already being decided when the record begins", () => {
    // November 2025 gained 498 decisions on Aug 31, the record's second day:
    // its start came before the record, so no day in it is its start.
    expect(starts.find((s) => s.month === "2025-11")).toBeUndefined();
  });

  it("needs a month seen standing still before its jump", () => {
    const jumpOnly: MonthDay[] = [
      { day: "2026-11-02", month: "2026-05", total: 100, decided: 0, withdrawn: 0, held: 0, inLine: 100 },
      { day: "2026-11-02", month: "2026-06", total: 900, decided: 0, withdrawn: 0, held: 0, inLine: 900 },
      { day: "2026-11-03", month: "2026-05", total: 100, decided: 90, withdrawn: 0, held: 0, inLine: 10 },
      { day: "2026-11-03", month: "2026-06", total: 900, decided: 300, withdrawn: 0, held: 0, inLine: 600 },
    ];
    expect(findMonthStarts(jumpOnly)).toEqual([]);
  });

  it("doesn't read an employer withdrawing a batch as DOL starting the month", () => {
    const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
    const rows: MonthDay[] = days.flatMap((day, i) => [
      { day, month: "2026-05", total: 1000, decided: 900, withdrawn: 0, held: 0, inLine: 100 },
      // 80 withdrawn on Nov 6, and nothing else decided.
      { day, month: "2026-06", total: 1000, decided: i === 4 ? 80 : 0, withdrawn: i === 4 ? 80 : 0, held: 0, inLine: 1000 },
    ]);
    expect(findMonthStarts(rows)).toEqual([]);
  });

  it("returns nothing for an empty record", () => {
    expect(findMonthStarts([])).toEqual([]);
  });
});

describe("shareDecided", () => {
  it("leaves the cases on hold out of the month", () => {
    expect(shareDecided({ total: 5494, decided: 2043, held: 407 })).toBeCloseTo(2043 / 5087, 6);
  });
  it("is null for a month with nothing DOL can decide", () => {
    expect(shareDecided({ total: 10, decided: 0, held: 10 })).toBeNull();
    expect(shareDecided({ total: 0, decided: 0, held: 0 })).toBeNull();
  });
});

describe("liveMonthFrom", () => {
  it("reads a live census month in the record's terms", () => {
    const live = liveMonthFrom({
      month: "2026-02",
      total: 5494,
      pending: 3451,
      decided: 2043,
      decidedPct: 37.2,
      statuses: [
        { status: "ANALYST REVIEW", count: 2975, isFinal: false },
        { status: "CERTIFIED", count: 1806, isFinal: true },
        { status: "APPLICATION ON HOLD", count: 407, isFinal: false },
        { status: "WITHDRAWN", count: 224, isFinal: true },
        { status: "RFI ISSUED", count: 68, isFinal: false },
      ],
    });
    expect(live).toEqual({ month: "2026-02", total: 5494, decided: 2043, held: 407, inLine: 2975 });
  });
});

describe("estimateNextStart", () => {
  it("dates March from February at the end of Nov 15", () => {
    const { known, live } = asOf("2026-11-15", "2026-02");
    const est = estimateNextStart({ series: known, starts: findMonthStarts(known), live });
    expect(est).toMatchObject({
      state: "estimate",
      month: "2026-03",
      current: "2026-02",
      currentStarted: "2026-11-10",
      asOf: "2026-11-15",
      decided: 2043,
      workable: 5087,
      inLine: 2975,
      held: 407,
      inLineLow: 1603,
      inLineHigh: 2607,
      // 2,975 in analyst review against the 2,607 and 1,603 the last three starts began at.
      needLow: 368,
      needHigh: 1372,
      // 1,809 decided since the end of Nov 9, over Nov 10, 12 and 13 (Nov 11 is Veterans Day).
      pace: 603,
      // March began Tue Nov 17. The share rule this replaced said Fri Nov 20.
      from: "2026-11-17",
      to: "2026-11-19",
    });
    expect(est?.basedOn).toHaveLength(3);
  });

  // The backtest, kept: run each business day on the record as it stood, the
  // estimate named the real start or the business day either side of it
  // through the two weeks before the January and February starts.
  it.each([
    ["2026-10-06", "2026-10-20"], ["2026-10-07", "2026-10-20"], ["2026-10-08", "2026-10-20"],
    ["2026-10-09", "2026-10-20"], ["2026-10-13", "2026-10-20"], ["2026-10-14", "2026-10-20"],
    ["2026-10-15", "2026-10-20"], ["2026-10-16", "2026-10-20"],
    ["2026-10-28", "2026-11-10"], ["2026-10-29", "2026-11-10"], ["2026-10-30", "2026-11-10"],
    ["2026-11-02", "2026-11-10"], ["2026-11-03", "2026-11-10"], ["2026-11-04", "2026-11-10"],
    ["2026-11-05", "2026-11-10"], ["2026-11-06", "2026-11-10"],
  ])("as of %s it names %s, within a business day", (day, actual) => {
    const current = actual === "2026-10-20" ? "2025-12" : "2026-01";
    const { known, live } = asOf(day, current);
    const est = estimateNextStart({ series: known, starts: findMonthStarts(known), live });
    // A month already down to the count reads as due on the next working day: Nov 6 to 9 for February, a day early.
    if (!est || (est.state === "estimate" && (!est.from || !est.to))) throw new Error("no date");
    const from = est.from!;
    const to = est.state === "estimate" ? est.to! : est.from;
    expect(businessDaysApart(from, actual)).toBeLessThanOrEqual(1);
    expect(businessDaysApart(to, actual)).toBeLessThanOrEqual(1);
    expect(to >= from).toBe(true);
  });

  // And March, from the first day there was a February pace to read: Nov 12 (the first working day after February
  // began, its pace one day old) said Nov 20 to 24, three working days late; Nov 13 and Nov 16 held the real day
  // or a working day either side of it.
  it.each([["2026-11-13"], ["2026-11-16"]])("as of %s its range holds March's start, within a business day", (day) => {
    const { known, live } = asOf(day, "2026-02");
    const est = estimateNextStart({ series: known, starts: findMonthStarts(known), live });
    if (est?.state !== "estimate" || !est.from || !est.to) throw new Error("no date");
    const actual = "2026-11-17";
    const inside = est.from <= actual && actual <= est.to;
    expect(inside || businessDaysApart(est.from, actual) <= 1 || businessDaysApart(est.to, actual) <= 1).toBe(true);
  });

  it("says the start is due once the month is down to the count and the next one hasn't begun", () => {
    const { known, live } = asOf("2026-11-09", "2026-01");
    const est = estimateNextStart({ series: known, starts: findMonthStarts(known), live });
    expect(est).toMatchObject({ state: "due", month: "2026-02", current: "2026-01", from: "2026-11-10" });
  });

  it("gives the count still to go without a date when there's no working day to measure a pace on", () => {
    const { known } = asOf("2026-11-15", "2026-02");
    // February's start day is the record's last day: nothing after it to measure.
    const cut = known.filter((r) => r.day <= "2026-11-10");
    const live = cut.find((r) => r.day === "2026-11-10" && r.month === "2026-02")!;
    const est = estimateNextStart({ series: cut, starts: findMonthStarts(cut), live });
    expect(est).toMatchObject({ state: "estimate", month: "2026-03", pace: null, from: null, to: null });
    expect(est?.state === "estimate" && est.needLow > 0).toBe(true);
  });

  it("skips Thanksgiving when it counts working days", () => {
    // July has 600 in analyst review when August starts on Mon Nov 9. August then sits at 50 decided until Nov 17
    // and gains 40 a working day to 250 on Tue Nov 24: 750 in line, 150 above July's 600, so four working days.
    // Counted past Thanksgiving (Thu Nov 26) those are Nov 25, 27, 30 and Dec 1, and the start is Wed Dec 2.
    // Counting the holiday as a working day would say Tue Dec 1.
    const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10",
      "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20",
      "2026-11-23", "2026-11-24"];
    const august = (day: string) => {
      if (day < "2026-11-09") return 0;
      if (day <= "2026-11-17") return 50;
      return 50 + 40 * days.filter((d) => d > "2026-11-17" && d <= day).length;
    };
    const rows: MonthDay[] = days.flatMap((day) => [
      { day, month: "2026-07", total: 1000, decided: 400, withdrawn: 0, held: 0, inLine: 600 },
      { day, month: "2026-08", total: 1000, decided: august(day), withdrawn: 0, held: 0, inLine: 1000 - august(day) },
    ]);
    const starts = findMonthStarts(rows);
    expect(starts.map((s) => [s.month, s.day])).toEqual([["2026-08", "2026-11-09"]]);
    const live = rows.at(-1)!;
    expect(live).toMatchObject({ month: "2026-08", decided: 250 });
    const est = estimateNextStart({ series: rows, starts, live });
    expect(est).toMatchObject({
      state: "estimate", month: "2026-09", needLow: 150, needHigh: 150, pace: 40, from: "2026-12-02", to: "2026-12-02",
    });
  });

  it("is null with no start on record or no figures for the month DOL is on", () => {
    const { known, live } = asOf("2026-11-15", "2026-02");
    expect(estimateNextStart({ series: known, starts: [], live })).toBeNull();
    expect(estimateNextStart({ series: known, starts: findMonthStarts(known), live: null })).toBeNull();
    expect(
      estimateNextStart({ series: known, starts: findMonthStarts(known), live: { ...live!, month: "2025-12" } }),
    ).toBeNull();
  });
});
