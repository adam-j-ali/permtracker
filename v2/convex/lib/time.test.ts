import { describe, expect, it } from "vitest";

import {
  DAYS_PER_MONTH,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  checkedLabel,
  dayFromNumber,
  dayNumber,
  daysBetween,
  daysBetweenOrNull,
  easternDay,
} from "./time";
import dayCases from "../../scripts/data/day_cases.json";

describe("units", () => {
  it("are the plain millisecond counts", () => {
    expect(MS_PER_MINUTE).toBe(60_000);
    expect(MS_PER_HOUR).toBe(3_600_000);
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(DAYS_PER_MONTH).toBe(30.4375);
  });
});

describe("easternDay", () => {
  it("is still yesterday in Eastern time after 8 PM, when UTC has moved on", () => {
    // 01:30 UTC on Oct 2 is 9:30 PM EDT on Oct 1.
    expect(easternDay(Date.UTC(2026, 9, 2, 1, 30))).toBe("2026-10-01");
  });

  it("reads a winter instant in EST", () => {
    // 04:59 UTC on Jan 15 is 11:59 PM EST on Jan 14.
    expect(easternDay(Date.UTC(2026, 0, 15, 4, 59))).toBe("2026-01-14");
  });
});

describe("checkedLabel", () => {
  it("gives a 12-hour Eastern time and the Eastern day", () => {
    // 09:25 UTC on Oct 1 is 5:25 AM EDT.
    expect(checkedLabel(Date.UTC(2026, 9, 1, 9, 25))).toBe("5:25 AM ET, Oct 1");
  });
});

describe("daysBetween", () => {
  it("counts calendar days, across a leap day and a daylight-saving change", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-01-10", "2026-01-01")).toBe(-9);
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("is NaN when a date doesn't parse", () => {
    expect(daysBetween("2026-13-01", "2026-01-01")).toBeNaN();
  });

  it("is the same on a machine in any zone (the suite runs in New York)", () => {
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("is NaN for what V8 would quietly read as some other day", () => {
    // Date.parse rolls February 30 into March and reads a bare month as its first day.
    expect(daysBetween("2024-02-30", "2024-03-01")).toBeNaN();
    expect(daysBetween("2026-09", "2026-09-30")).toBeNaN();
    expect(daysBetween("2026-09-01T10:00:00Z", "2026-09-30")).toBeNaN();
  });
});

describe("daysBetweenOrNull", () => {
  it.each(dayCases.cases)("gives the shared answer from $from to $to", ({ from, to, days }) => {
    expect(daysBetweenOrNull(from, to)).toBe(days);
  });

  it("agrees with daysBetween wherever there's an answer", () => {
    for (const c of dayCases.cases) {
      if (c.days !== null) expect(daysBetween(c.from!, c.to!)).toBe(c.days);
    }
  });
});

describe("dayNumber", () => {
  it("counts whole days from 1970-01-01, so two days subtract to the days between them", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("1969-12-31")).toBe(-1);
    for (const c of dayCases.cases) {
      if (c.days !== null) expect(dayNumber(c.to!) - dayNumber(c.from!)).toBe(c.days);
    }
  });

  it("is NaN for what isn't a real day", () => {
    expect(dayNumber("2024-02-30")).toBeNaN();
    expect(dayNumber("2026-09")).toBeNaN();
  });
});

describe("dayFromNumber", () => {
  it("is dayNumber's inverse", () => {
    for (const day of ["1970-01-01", "2024-02-29", "2026-03-08", "2026-11-23", "1969-12-31"]) {
      expect(dayFromNumber(dayNumber(day))).toBe(day);
    }
    expect(dayFromNumber(dayNumber("2026-11-23") + 9)).toBe("2026-12-02");
  });

  it("rounds to the nearest whole day, and refuses NaN loudly", () => {
    expect(dayFromNumber(dayNumber("2026-11-23") + 0.4)).toBe("2026-11-23");
    expect(dayFromNumber(dayNumber("2026-11-23") + 0.5)).toBe("2026-11-24");
    expect(() => dayFromNumber(Number.NaN)).toThrow(RangeError);
  });
});
