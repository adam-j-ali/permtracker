import { describe, expect, it } from "vitest";

import {
  MIN_STARTS,
  STARTS_FROM,
  fillStartYears,
  mostlyScheduleA,
  startsScale,
  startsSentence,
  worthShowing,
  type EmployerStarts,
  type StartYear,
} from "../employerStarts";

/**
 * An employer's wage requests beside its PERM applications, by the year it filed. The figures in these tests are
 * shapes DOL's files really hold: an employer that asks for wages and files nothing, one that stopped both, and a
 * nurse employer whose cases skip the PERM step by law.
 */

const y = (year: number, wageRequests: number, permFiled: number, scheduleA = 0, jobKnown = wageRequests): StartYear => ({
  year,
  wageRequests,
  permFiled,
  scheduleA,
  jobKnown,
});

const starts = (years: StartYear[], newestWageRequest: string | null, newestPerm: string | null): EmployerStarts => ({
  years,
  newestWageRequest,
  newestPerm,
});

describe("fillStartYears", () => {
  it("gives every year from the first to this one, a year with nothing as zeros", () => {
    const out = fillStartYears([y(2024, 1014, 0), y(2026, 1894, 23)], 2026);
    expect(out.map((r) => r.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(out[0]).toEqual(y(STARTS_FROM, 0, 0));
    expect(out[2]).toEqual(y(2025, 0, 0));
    expect(out[3]).toEqual(y(2026, 1894, 23));
  });

  it("drops a year outside the window, so a mistyped date can't add a row", () => {
    const out = fillStartYears([y(2019, 5, 5), y(2027, 3, 0), y(2025, 2, 1)], 2026);
    expect(out.map((r) => r.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(out.reduce((a, r) => a + r.wageRequests, 0)).toBe(2);
  });
});

describe("worthShowing", () => {
  it("is false with nothing read, and for a handful of filings the ledger above already counts", () => {
    expect(worthShowing(null)).toBe(false);
    expect(worthShowing(starts(fillStartYears([], 2026), null, null))).toBe(false);
    expect(worthShowing(starts(fillStartYears([y(2025, MIN_STARTS - 2, 1)], 2026), "2025-03-01", "2025-09-01"))).toBe(false);
  });

  it("is true once the window holds enough filings to compare, wage requests alone included", () => {
    expect(worthShowing(starts(fillStartYears([y(2025, MIN_STARTS - 1, 1)], 2026), "2025-03-01", "2025-09-01"))).toBe(true);
    expect(worthShowing(starts(fillStartYears([y(2026, 2026, 0)], 2026), "2026-11-10", null))).toBe(true);
  });
});

describe("startsScale", () => {
  it("is the largest figure in either column, so the two columns share one scale", () => {
    expect(startsScale([y(2023, 62, 55), y(2024, 1014, 0), y(2026, 1894, 23)])).toBe(1894);
    expect(startsScale([y(2023, 10, 191)])).toBe(191);
    expect(startsScale([])).toBe(0);
  });
});

describe("mostlyScheduleA", () => {
  it("is true when most of the wage requests whose job DOL's file names are for nurses or physical therapists", () => {
    expect(mostlyScheduleA([y(2025, 1949, 0, 1949), y(2026, 3588, 0, 1468, 1468)])).toBe(true);
  });

  it("is false for an ordinary employer, and when too few jobs are named to say", () => {
    expect(mostlyScheduleA([y(2025, 2900, 21, 0), y(2026, 4273, 4, 0, 839)])).toBe(false);
    expect(mostlyScheduleA([y(2026, 40, 0, 3, 4)])).toBe(false);
    expect(mostlyScheduleA([])).toBe(false);
  });

  it("counts only the requests whose job is named: the live record names none", () => {
    // 100 named, 60 of them Schedule A; 900 more from the live record with no job code.
    expect(mostlyScheduleA([y(2026, 1000, 0, 60, 100)])).toBe(true);
  });
});

describe("startsSentence", () => {
  it("gives the newest of each, dated, when the employer has both", () => {
    expect(startsSentence(starts([], "2026-11-12", "2026-10-30"))).toBe(
      "Its newest wage request went in on November 12, 2026, and its newest PERM application on October 30, 2026.",
    );
  });

  it("says there's been no PERM application when the window holds none", () => {
    expect(startsSentence(starts([], "2026-11-11", null))).toBe(
      `Its newest wage request went in on November 11, 2026. It has filed no PERM application since the start of ${STARTS_FROM}.`,
    );
  });

  it("says there's been no wage request when only PERM applications are on file", () => {
    expect(startsSentence(starts([], null, "2025-09-12"))).toBe(
      `Its newest PERM application went in on September 12, 2025. It has made no wage request since the start of ${STARTS_FROM}.`,
    );
  });

  it("is null with neither date", () => {
    expect(startsSentence(starts([], null, null))).toBeNull();
  });
});
