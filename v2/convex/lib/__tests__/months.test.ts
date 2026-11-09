import { describe, expect, it } from "vitest";

import { MONTH_ABBR, MONTH_NAMES, MONTH_OR_DAY_RE, boundEnd, boundStart, longDate, monthDay, monthYear, shortDate, weekdayName } from "../months";

describe("the shared month names and date labels", () => {
  it("has twelve months, and the short forms are the long ones cut to three", () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_ABBR).toEqual(MONTH_NAMES.map((m) => m.slice(0, 3)));
  });

  it("writes a date the way DOL's own pages do, whatever the reader's time zone", () => {
    expect(longDate("2026-09-01")).toBe("September 1, 2026");
    expect(longDate("2026-12-31T23:59:00")).toBe("December 31, 2026");
    expect(shortDate("2026-01-05")).toBe("Jan 5, 2026");
    expect(monthDay("2026-01-05")).toBe("Jan 5");
    expect(monthYear("2025-11")).toBe("November 2025");
  });

  it("answers null for anything that isn't a date, so a caller chooses what shows", () => {
    for (const bad of ["", null, undefined, "2026-13-01", "next week", "2026/09/01"]) {
      expect(longDate(bad)).toBeNull();
      expect(shortDate(bad)).toBeNull();
      expect(monthDay(bad)).toBeNull();
    }
    expect(monthYear("2026-00")).toBeNull();
    expect(monthYear("2026-09-01")).toBeNull();
  });
});

describe("weekdayName", () => {
  it("names the day of the week of a date, in UTC so no zone can shift it", () => {
    expect(weekdayName("2026-10-28")).toBe("Wednesday");
    expect(weekdayName("2026-10-25")).toBe("Sunday");
    expect(weekdayName("2026-10-25T23:30:00-05:00")).toBe("Sunday");
  });

  it("names nothing for what isn't a date", () => {
    expect(weekdayName("2026-10")).toBeNull();
    expect(weekdayName(null)).toBeNull();
  });
});

describe("a month or one day as a search bound", () => {
  it("takes a whole month or one calendar day, and nothing shaped otherwise", () => {
    for (const ok of ["2026-03", "2026-03-05", "2026-12-31", "2028-02-29"]) expect(MONTH_OR_DAY_RE.test(ok)).toBe(true);
    for (const bad of ["2026", "2026-3", "2026-13", "2026-00", "2026-03-5", "2026-03-00", "2026-03-32", "2026-03-05T00:00", " 2026-03", "26-03-05"]) {
      expect(MONTH_OR_DAY_RE.test(bad)).toBe(false);
    }
  });

  it("starts a month on its first day and a day on itself", () => {
    expect(boundStart("2026-03")).toBe("2026-03-01");
    expect(boundStart("2026-03-05")).toBe("2026-03-05");
  });

  it("ends on the first day after: the next month's first, or the next day", () => {
    expect(boundEnd("2026-03")).toBe("2026-04-01");
    expect(boundEnd("2026-12")).toBe("2027-01-01");
    expect(boundEnd("2026-03-05")).toBe("2026-03-06");
    // The ends of a month and of a year, and February in a leap year and out of one.
    expect(boundEnd("2026-01-31")).toBe("2026-02-01");
    expect(boundEnd("2026-12-31")).toBe("2027-01-01");
    expect(boundEnd("2028-02-28")).toBe("2028-02-29");
    expect(boundEnd("2028-02-29")).toBe("2028-03-01");
    expect(boundEnd("2026-02-28")).toBe("2026-03-01");
    // The days the clocks change in the United States: stepped in UTC, so neither is skipped or doubled.
    expect(boundEnd("2026-03-08")).toBe("2026-03-09");
    expect(boundEnd("2026-11-01")).toBe("2026-11-02");
  });
});
