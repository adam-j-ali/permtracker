import { describe, expect, it } from "vitest";

import type { ActivityDay } from "@/lib/activityStats";
import { PERIOD_SPANS, periodsAgainstLastYear, typicalYear } from "@/lib/decisionPeriods";

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
