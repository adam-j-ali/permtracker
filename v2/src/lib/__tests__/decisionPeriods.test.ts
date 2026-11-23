import { describe, expect, it } from "vitest";

import type { ActivityDay } from "@/lib/activityStats";
import { PERIOD_SPANS, periodsAgainstLastYear, typicalYear, weekStanding } from "@/lib/decisionPeriods";

/**
 * PERM decisions by day, week, month or year, each against a year earlier. One rule for all four: a period counts the
 * days a record holds (DOL's file, then our own daily check), names the working days neither holds, and is compared
 * with the same days a year earlier, per working day (a day against the same weekday). The month view is also held by
 * decisionMonths.test.ts, which must keep passing unchanged.
 */
const d = (date: string, total: number): ActivityDay => ({ date, total, certified: total, denied: 0, withdrawn: 0 });

function weekdays(from: string, to: string, total: number): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) out.push(d(new Date(t).toISOString().slice(0, 10), total));
  }
  return out;
}

// DOL's file: October 2024 through June 2026, with the 2025 shutdown's hole. Our check: from Friday August 28, 2026.
const file = [...weekdays("2024-10-01", "2025-09-30", 500), d("2025-10-02", 21), ...weekdays("2025-11-03", "2026-06-30", 500)];
const checks = weekdays("2026-08-28", "2026-11-12", 700);
const TODAY = "2026-11-12";

describe("days, each against the same weekday a year earlier", () => {
  const rows = periodsAgainstLastYear(file, checks, TODAY, "day", 30);
  const day = (key: string) => rows.find((r) => r.key === key)!;

  it("lists the newest complete day first", () => {
    expect(rows.slice(0, 3).map((r) => r.key)).toEqual(["2026-11-11", "2026-11-10", "2026-11-09"]);
    expect(rows).toHaveLength(30);
  });

  it("compares a working day with the same weekday 52 weeks before, by its total", () => {
    // Monday Nov 9 2026 against Monday Nov 10 2025.
    const mon = day("2026-11-09");
    expect(mon.then).toMatchObject({ from: "2025-11-10", to: "2025-11-10", total: 500 });
    expect(mon.gap).toBeNull();
    expect(mon.pct).toBe(40);
  });

  it("names a holiday, a weekend and the shutdown instead of comparing", () => {
    expect(day("2026-11-11")).toMatchObject({ gap: "holiday", pct: null });
    // Tuesday Nov 10 2026 sits against Veterans Day 2025.
    expect(day("2026-11-10")).toMatchObject({ gap: "holiday", pct: null });
    expect(day("2026-11-08")).toMatchObject({ gap: "weekend", pct: null });
    // Tuesday Oct 20 2026 sits against Oct 21 2025, when DOL was shut.
    expect(day("2026-10-20")).toMatchObject({ gap: "shutdown", pct: null });
  });
});

describe("weeks, Monday to Sunday, each against the same week a year earlier", () => {
  const rows = periodsAgainstLastYear(file, checks, TODAY, "week", 3);

  it("counts the running week through yesterday and compares it per working day", () => {
    const now = rows[0]!;
    expect(now).toMatchObject({ key: "2026-11-09", start: "2026-11-09", end: "2026-11-15", toDate: true, missingWorkdays: 0 });
    // Nov 9 to 11, 2026: three rows, two working days (the 11th is Veterans Day).
    expect(now.now).toMatchObject({ total: 2100, workdays: 2, from: "2026-11-09", to: "2026-11-11", source: "checks" });
    // Nov 10 to 12, 2025: three rows, two working days (the 11th again).
    expect(now.then).toMatchObject({ total: 1500, workdays: 2, from: "2025-11-10", to: "2025-11-12", source: "file" });
    expect(now.pct).toBe(40);
  });

  it("says when the year-ago week was DOL's first back after the shutdown", () => {
    const prior = rows[1]!;
    expect(prior.key).toBe("2026-11-02");
    expect(prior.then).toMatchObject({ from: "2025-11-03", to: "2025-11-09" });
    expect(prior.afterShutdown).toBe(true);
  });
});

describe("years, across the stretch neither record holds", () => {
  const rows = periodsAgainstLastYear(file, checks, TODAY, "year", PERIOD_SPANS.year);
  const year = (key: string) => rows.find((r) => r.key === key)!;

  it("stops at the oldest year a record reaches", () => {
    expect(rows.map((r) => r.key)).toEqual(["2026", "2025", "2024"]);
  });

  it("counts both records, names the missing working days, and compares the same days a year earlier", () => {
    const y = year("2026");
    expect(y.toDate).toBe(true);
    expect(y.now).toMatchObject({ from: "2026-01-01", to: "2026-11-11", source: "both" });
    expect(y.missingWorkdays).toBeGreaterThan(30);
    expect(y.then).toMatchObject({ from: "2025-01-01", to: "2025-11-11", source: "file" });
    expect(y.gap).toBeNull();
    const now = y.now!;
    const then = y.then!;
    expect(y.pct).toBe(Math.round((now.total / now.workdays / (then.total / then.workdays) - 1) * 100));
  });

  it("leaves a year uncompared when the year before isn't on record", () => {
    expect(year("2024")).toMatchObject({ gap: "not-counted", then: null, pct: null });
  });
});

describe("a typical year", () => {
  it("averages decisions per working day by calendar month over the newest complete years", () => {
    const days = [
      ...weekdays("2019-03-01", "2023-12-31", 100).map((x) => (x.date.slice(5, 7) === "12" ? d(x.date, 50) : x)),
    ];
    const shape = typicalYear(days, "2024-06-01", 5);
    expect(shape.years).toEqual({ from: 2020, to: 2023 });
    expect(shape.months).toHaveLength(12);
    // Holidays are rows here but not working days, so a month's rate sits a little above its count.
    expect(shape.months[0]!.perWorkday).toBeGreaterThanOrEqual(100);
    expect(shape.months[11]!.perWorkday).toBeLessThan(shape.months[10]!.perWorkday!);
  });

  it("is empty with no complete year on record", () => {
    expect(typicalYear(weekdays("2026-01-01", "2026-06-30", 100), "2026-07-01", 5).months).toEqual([]);
  });
});

describe("a month against the same days a year earlier (the month list's rule since Nov 12 2026)", () => {
  // DOL's file: October 2024 through June 2026, with the shutdown's hole. Our check: from August 28, 2026.
  const file = [
    ...weekdays("2024-10-01", "2025-09-30", 500),
    d("2025-10-02", 21),
    ...weekdays("2025-11-03", "2026-06-30", 500),
  ];
  const checks = weekdays("2026-08-28", "2026-11-12", 700);
  const rows = periodsAgainstLastYear(file, checks, "2026-11-12", "month", 12);
  const month = (m: string) => rows.find((r) => r.key === m)!;

  it("lists the newest month first, twelve of them", () => {
    expect(rows.map((r) => r.key)).toEqual([
      "2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12",
    ]);
  });

  it("compares a whole month from DOL's file per working day", () => {
    const june = month("2026-06");
    // June 2026: 22 weekdays less Juneteenth. June 2025: 21 weekdays less Juneteenth.
    expect(june.now).toMatchObject({ total: 22 * 500, workdays: 21, from: "2026-06-01", to: "2026-06-30", source: "file" });
    expect(june.then).toMatchObject({ total: 21 * 500, workdays: 20, from: "2025-06-01", to: "2025-06-30", source: "file" });
    expect(june.gap).toBeNull();
    expect(june.toDate).toBe(false);
    // 11,000 over 21 days against 10,500 over 20.
    expect(june.pct).toBe(Math.round(((11000 / 21) / (10500 / 20) - 1) * 100));
  });

  it("counts the month so far through yesterday, against the same dates a year earlier", () => {
    const nov = month("2026-11");
    expect(nov.toDate).toBe(true);
    // Nov 2 to 10, 2026 are seven working days (Veterans Day is the 11th) and hold eight weekday rows, the 11th's too.
    expect(nov.now).toMatchObject({ total: 8 * 700, workdays: 7, from: "2026-11-01", to: "2026-11-11", source: "checks" });
    // Nov 3 to 10, 2025 are six working days; the 11th is the holiday, and the 1st and 2nd end the shutdown.
    expect(nov.then).toMatchObject({ total: 7 * 500, workdays: 6, from: "2025-11-01", to: "2025-11-11", source: "file" });
    expect(nov.gap).toBeNull();
    expect(nov.afterShutdown).toBe(true);
    expect(nov.pct).toBe(Math.round(((5600 / 7) / (3500 / 6) - 1) * 100));
  });

  it("names the shutdown instead of comparing with it", () => {
    const oct = month("2026-10");
    expect(oct.now?.source).toBe("checks");
    expect(oct.then?.total).toBe(21);
    expect(oct.then?.workdays).toBe(0);
    expect(oct.gap).toBe("shutdown");
    expect(oct.pct).toBeNull();
  });

  it("says a month neither record holds isn't counted yet, and a month our check joined part way is a part month", () => {
    expect(month("2026-07")).toMatchObject({ now: null, gap: "not-counted", pct: null });
    const aug = month("2026-08");
    expect(aug.gap).toBe("part");
    expect(aug.now).toMatchObject({ from: "2026-08-28", to: "2026-08-31", source: "checks" });
    expect(aug.pct).toBeNull();
  });

  it("has nothing to compare when the file doesn't reach back a year", () => {
    const young = periodsAgainstLastYear(weekdays("2026-01-01", "2026-06-30", 500), [], "2026-07-15", "month", 3);
    expect(young.find((r) => r.key === "2026-06")).toMatchObject({ then: null, gap: "not-counted", pct: null });
  });

  it("leaves out a month with no complete day yet", () => {
    expect(periodsAgainstLastYear(file, checks, "2026-11-01", "month", 2).map((r) => r.key)).toEqual(["2026-10", "2026-09"]);
  });
});

describe("the newest whole week against the weeks before it (most since, fewest since)", () => {
  /** Every day of a span at one count, weekends at their own; a zero is no row. */
  const span = (from: string, to: string, weekday: number, weekend: number): ActivityDay[] => {
    const out: ActivityDay[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      const dow = new Date(t).getUTCDay();
      const n = dow === 0 || dow === 6 ? weekend : weekday;
      if (n > 0) out.push(d(new Date(t).toISOString().slice(0, 10), n));
    }
    return out;
  };
  const without = (days: ActivityDay[], ...dates: string[]) => days.filter((x) => !dates.includes(x.date));

  // The weeks behind the Nov 23 2026 check: DOL's file to Sunday Aug 30 with its weekends worked, our check from Aug 28.
  // The week of Aug 31 holds 4,773 with its weekend, DOL stops working weekends on Sep 19, the week of Sep 28 holds
  // 4,233 on weekdays alone, and Nov 16 to 22 holds 4,142 on weekdays and 477 on the weekend: 4,619.
  const fileDays = span("2026-03-02", "2026-08-30", 800, 100);
  const checkDays = [
    ...span("2026-08-28", "2026-08-30", 800, 100),
    d("2026-08-31", 900), d("2026-09-01", 900), d("2026-09-02", 900), d("2026-09-03", 900), d("2026-09-04", 873),
    d("2026-09-05", 200), d("2026-09-06", 100),
    // Labor Day is Monday Sep 7.
    ...span("2026-09-08", "2026-09-18", 800, 100),
    ...span("2026-09-21", "2026-09-25", 800, 0),
    d("2026-09-28", 847), d("2026-09-29", 847), d("2026-09-30", 847), d("2026-10-01", 846), d("2026-10-02", 846),
    // Columbus Day Oct 12 and Veterans Day Nov 11 are holidays.
    ...without(span("2026-10-05", "2026-11-13", 800, 0), "2026-10-12", "2026-11-11"),
    d("2026-11-14", 356),
    d("2026-11-16", 829), d("2026-11-17", 829), d("2026-11-18", 828), d("2026-11-19", 828), d("2026-11-20", 828),
    d("2026-11-21", 331), d("2026-11-22", 146),
  ];

  it("names the last week with as many or more, and how many weeks this one beat", () => {
    // Act
    const s = weekStanding(fileDays, checkDays, "2026-11-23");

    // Assert
    expect(s).toMatchObject({
      kind: "most",
      week: { start: "2026-11-16", end: "2026-11-22", total: 4619, weekend: 477 },
      since: { start: "2026-08-31", end: "2026-09-06", total: 4773 },
      // Sep 7 to Nov 9: ten weeks.
      weeks: 10,
    });
  });

  it("says when the weekend made the difference: Monday to Friday alone, a newer week had more", () => {
    const s = weekStanding(fileDays, checkDays, "2026-11-23")!;
    expect(s.weekdaysOnly).toEqual({ start: "2026-09-28", end: "2026-10-04", total: 4233, mine: 4142 });
  });

  it("says nothing of the weekend when the weekdays alone give the same answer", () => {
    // The same week with its weekend's decisions on its Friday: the most since Aug 31 either way.
    const flat = [...without(checkDays, "2026-11-20", "2026-11-21", "2026-11-22"), d("2026-11-20", 828 + 477)];
    const s = weekStanding(fileDays, flat, "2026-11-23")!;
    expect(s.since?.start).toBe("2026-08-31");
    expect(s.weekdaysOnly).toBeNull();
  });

  it("judges the newest whole week, never one still running", () => {
    // On Wednesday Nov 25 the week of Nov 23 holds two days: the line is still about Nov 16 to 22.
    const more = [...checkDays, d("2026-11-23", 5000), d("2026-11-24", 5000)];
    expect(weekStanding(fileDays, more, "2026-11-25")?.week.start).toBe("2026-11-16");
  });

  it("says nothing when the week beat only the three weeks just before it", () => {
    // Sep 28 to Oct 4 (4,233) beat Sep 7, 14 and 21, and the week of Aug 31 held more.
    expect(weekStanding(fileDays, checkDays, "2026-10-05")).toBeNull();
  });

  it("names the fewest since, and says how far back the record runs when no earlier week had as few", () => {
    const quiet = [...span("2026-03-02", "2026-06-19", 800, 0), ...span("2026-06-22", "2026-06-28", 500, 0)];
    const s = weekStanding(quiet, [], "2026-06-29");
    expect(s).toMatchObject({ kind: "fewest", week: { start: "2026-06-22", total: 2500 }, since: null, back: "2026-03-02" });
    // Mar 2 to Jun 15: sixteen whole weeks before it.
    expect(s?.weeks).toBe(16);
  });

  it("never calls a week with a holiday the fewest: fewer working days isn't DOL slowing down", () => {
    // The week of May 25 2026 holds Memorial Day.
    const days = without(span("2026-03-02", "2026-05-31", 800, 0), "2026-05-25");
    expect(weekStanding(days, [], "2026-06-01")).toBeNull();
  });

  it("stops at a stretch neither record holds, rather than reading it as a quiet week", () => {
    // Our check from Sep 28 only: Aug 31 to Sep 27 is in neither record, so the walk back stops at Sep 28.
    const later = checkDays.filter((x) => x.date >= "2026-09-28");
    const s = weekStanding(fileDays, later, "2026-11-23")!;
    expect(s).toMatchObject({ kind: "most", since: null, back: "2026-09-28", weeks: 7 });
    expect(s.weekdaysOnly?.start).toBe("2026-09-28");
  });
});
