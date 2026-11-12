import { describe, expect, it } from "vitest";

import type { ActivityDay } from "@/lib/activityStats";
import { monthsAgainstLastYear } from "@/lib/decisionMonths";

/**
 * PERM decisions by month against the same days a year earlier. Two records hold the days: DOL's published file
 * (through its last quarter) and our own daily check (from the day it began). The yardstick is decisions per
 * working day, so a month with a holiday or a part month isn't read as a slowdown, and the 2025 shutdown is named
 * instead of compared.
 */
const d = (date: string, total: number): ActivityDay => ({ date, total, certified: total, denied: 0, withdrawn: 0 });

/** Every working day of a span at one count: Monday to Friday, holidays included (the count is what's under test). */
function weekdays(from: string, to: string, total: number): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) out.push(d(new Date(t).toISOString().slice(0, 10), total));
  }
  return out;
}

describe("a month against the same days a year earlier", () => {
  // DOL's file: October 2024 through June 2026, with the shutdown's hole. Our check: from August 28, 2026.
  const file = [
    ...weekdays("2024-10-01", "2025-09-30", 500),
    d("2025-10-02", 21),
    ...weekdays("2025-11-03", "2026-06-30", 500),
  ];
  const checks = weekdays("2026-08-28", "2026-11-12", 700);
  const rows = monthsAgainstLastYear(file, checks, "2026-11-12", 12);
  const month = (m: string) => rows.find((r) => r.month === m)!;

  it("lists the newest month first, twelve of them", () => {
    expect(rows.map((r) => r.month)).toEqual([
      "2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12",
    ]);
  });

  it("compares a whole month from DOL's file per working day", () => {
    const june = month("2026-06");
    // June 2026: 22 weekdays less Juneteenth. June 2025: 21 weekdays less Juneteenth.
    expect(june.now).toEqual({ total: 22 * 500, workdays: 21, from: "2026-06-01", to: "2026-06-30", source: "file" });
    expect(june.then).toEqual({ total: 21 * 500, workdays: 20, from: "2025-06-01", to: "2025-06-30", source: "file" });
    expect(june.gap).toBeNull();
    expect(june.toDate).toBe(false);
    // 11,000 over 21 days against 10,500 over 20.
    expect(june.perDayPct).toBe(Math.round(((11000 / 21) / (10500 / 20) - 1) * 100));
  });

  it("counts the month so far through yesterday, against the same dates a year earlier", () => {
    const nov = month("2026-11");
    expect(nov.toDate).toBe(true);
    // Nov 2 to 10, 2026 are seven working days (Veterans Day is the 11th) and hold eight weekday rows, the 11th's too.
    expect(nov.now).toEqual({ total: 8 * 700, workdays: 7, from: "2026-11-01", to: "2026-11-11", source: "checks" });
    // Nov 3 to 10, 2025 are six working days; the 11th is the holiday, and the 1st and 2nd end the shutdown.
    expect(nov.then).toEqual({ total: 7 * 500, workdays: 6, from: "2025-11-01", to: "2025-11-11", source: "file" });
    expect(nov.gap).toBeNull();
    expect(nov.afterShutdown).toBe(true);
    expect(nov.perDayPct).toBe(Math.round(((5600 / 7) / (3500 / 6) - 1) * 100));
  });

  it("names the shutdown instead of comparing with it", () => {
    const oct = month("2026-10");
    expect(oct.now?.source).toBe("checks");
    expect(oct.then?.total).toBe(21);
    expect(oct.then?.workdays).toBe(0);
    expect(oct.gap).toBe("shutdown");
    expect(oct.perDayPct).toBeNull();
  });

  it("says a month neither record holds isn't counted yet, and a month our check joined part way is a part month", () => {
    expect(month("2026-07")).toMatchObject({ now: null, gap: "not-counted", perDayPct: null });
    const aug = month("2026-08");
    expect(aug.gap).toBe("part-month");
    expect(aug.now).toMatchObject({ from: "2026-08-28", to: "2026-08-31", source: "checks" });
    expect(aug.perDayPct).toBeNull();
  });

  it("has nothing to compare when the file doesn't reach back a year", () => {
    const young = monthsAgainstLastYear(weekdays("2026-01-01", "2026-06-30", 500), [], "2026-07-15", 3);
    expect(young.find((r) => r.month === "2026-06")).toMatchObject({ then: null, gap: "not-counted", perDayPct: null });
  });

  it("leaves out a month with no complete day yet", () => {
    expect(monthsAgainstLastYear(file, checks, "2026-11-01", 2).map((r) => r.month)).toEqual(["2026-10", "2026-09"]);
  });
});
