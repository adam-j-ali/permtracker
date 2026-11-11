import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CASE_CHECKS, clockLabel, nextCheckAfter, nextCheckLabel } from "@/lib/sweepSchedule";

/** An Eastern wall-clock time in November 2026 (UTC-5) as epoch ms. */
const est = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00-05:00`);

describe("the case checks' clock", () => {
  it("is the server's own timers, one for one", () => {
    // Arrange: every case-status timer the server runs, read from the unit files.
    const dir = resolve(process.cwd(), "scripts/oracle/systemd");
    const timers = readdirSync(dir).filter((f) => /^permtracker-sweep@case-status-.*\.timer$/.test(f));
    const onServer = timers.map((f) => {
      const m = readFileSync(resolve(dir, f), "utf8").match(/^OnCalendar=(Mon\.\.Fri )?\*-\*-\* (\d{2}:\d{2}):00 America\/New_York$/m);
      if (!m) throw new Error(`${f}: its OnCalendar line isn't one this test can read`);
      return { at: m[2]!, weekdays: Boolean(m[1]) };
    });
    const byClock = (a: { at: string }, b: { at: string }) => a.at.localeCompare(b.at);

    // Assert
    expect(timers.length).toBeGreaterThanOrEqual(4);
    expect([...onServer].sort(byClock)).toEqual([...CASE_CHECKS].sort(byClock));
  });

  it("gives the next check on the same day, in order", () => {
    // Wednesday Nov 11 2026.
    expect(nextCheckAfter(est("2026-11-11", "09:00"))).toBe(est("2026-11-11", "10:40"));
    expect(nextCheckAfter(est("2026-11-11", "14:00"))).toBe(est("2026-11-11", "15:40"));
    expect(nextCheckAfter(est("2026-11-11", "16:00"))).toBe(est("2026-11-11", "20:10"));
  });

  it("rolls to the morning after the day's last check", () => {
    expect(nextCheckAfter(est("2026-11-11", "21:00"))).toBe(est("2026-11-12", "04:10"));
  });

  it("skips the weekday-only check on a weekend", () => {
    // Saturday Nov 14 2026, after the 4:10 AM check: the next is 3:40 PM, never 10:40 AM.
    expect(nextCheckAfter(est("2026-11-14", "09:00"))).toBe(est("2026-11-14", "15:40"));
  });

  it("is the moment after, never the moment itself", () => {
    expect(nextCheckAfter(est("2026-11-11", "15:40"))).toBe(est("2026-11-11", "20:10"));
  });

  it("holds across the clocks changing in spring", () => {
    // Sunday Mar 14 2027: 2 AM becomes 3 AM. Saturday night's next check is 4:10 AM daylight time, 08:10 UTC.
    const saturdayNight = Date.parse("2027-03-13T21:00:00-05:00");
    expect(nextCheckAfter(saturdayNight)).toBe(Date.parse("2027-03-14T08:10:00Z"));
  });

  it("says the time the way a person reads it", () => {
    expect(clockLabel("04:10")).toBe("4:10 AM");
    expect(clockLabel("15:40")).toBe("3:40 PM");
    expect(clockLabel("12:05")).toBe("12:05 PM");
    expect(clockLabel("00:30")).toBe("12:30 AM");
    expect(nextCheckLabel(est("2026-11-11", "14:00"))).toBe("3:40 PM");
    expect(nextCheckLabel(est("2026-11-11", "21:00"))).toBe("4:10 AM tomorrow");
  });
});
