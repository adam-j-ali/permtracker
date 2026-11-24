import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CASE_CHECKS,
  DAYTIME_CHECKS,
  WAGE_CHECKS,
  clockLabel,
  daytimeChecksRunning,
  nextCheckAfter,
  nextCheckLabel,
  wageDayWhole,
  wageDayWholeAt,
} from "@/lib/sweepSchedule";

/** An Eastern wall-clock time in November 2026 (UTC-5) as epoch ms. */
const est = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00-05:00`);

describe("the case checks' clock", () => {
  it("is the server's own timers, one for one", () => {
    // Arrange: every case-status timer the server runs, read from the unit files.
    const dir = resolve(process.cwd(), "scripts/oracle/systemd");
    // The daytime pass (case-status-active, every 15 minutes on weekdays) reads only the cases DOL is deciding now,
    // so it isn't a check of every pending case and the page never names it as the next one.
    const timers = readdirSync(dir).filter(
      (f) => /^permtracker-sweep@case-status-.*\.timer$/.test(f) && f !== "permtracker-sweep@case-status-active.timer",
    );
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

describe("the wage requests' reads", () => {
  it("are the server's own timers: 5:40 AM every day and each weekday hour from 8:10 AM to 7:10 PM", () => {
    const dir = resolve(process.cwd(), "scripts/oracle/systemd");
    const onServer = ["permtracker-sweep@pwd-pending.timer", "permtracker-sweep@pwd-active.timer"].flatMap((f) => {
      // "05:40" or an hour range, "08..19:10".
      const m = readFileSync(resolve(dir, f), "utf8").match(
        /^OnCalendar=(Mon\.\.Fri )?\*-\*-\* (\d{2})(?:\.\.(\d{2}))?:(\d{2}):00 America\/New_York$/m,
      );
      if (!m) throw new Error(`${f}: its OnCalendar line isn't one this test can read`);
      const [from, to] = [Number(m[2]), Number(m[3] ?? m[2])];
      return Array.from({ length: to - from + 1 }, (_, i) => ({ at: `${String(from + i).padStart(2, "0")}:${m[4]}`, weekdays: Boolean(m[1]) }));
    });
    expect(onServer).toEqual([...WAGE_CHECKS]);
  });

  it("make a DOL day's count whole with the next morning's 5:40 AM read, before DOL's day turns at 7", () => {
    // Sunday Nov 22 2026: Monday's 5:40 AM read dates its finds to Sunday.
    expect(wageDayWholeAt("2026-11-22")).toBe(est("2026-11-23", "05:40"));
    // The pages show a read about half an hour after it starts.
    expect(wageDayWhole("2026-11-22", est("2026-11-23", "05:45"))).toBe(false);
    expect(wageDayWhole("2026-11-22", est("2026-11-23", "06:10"))).toBe(true);
    // Sunday afternoon: no read runs on a weekend afternoon, so Sunday's count isn't in.
    expect(wageDayWhole("2026-11-22", est("2026-11-22", "16:00"))).toBe(false);
  });
});

describe("the daytime reads", () => {
  it("are the server's own timer", () => {
    const timer = readFileSync(resolve(process.cwd(), "scripts/oracle/systemd/permtracker-sweep@case-status-active.timer"), "utf8");
    const [fh] = DAYTIME_CHECKS.first.split(":");
    const [lh] = DAYTIME_CHECKS.last.split(":");
    expect(timer).toContain(`OnCalendar=Mon..Fri *-*-* ${fh}..${lh}:00/${DAYTIME_CHECKS.everyMinutes}:00 America/New_York`);
  });

  it("run on a weekday from 7 AM until 8 PM Eastern, and never on a weekend", () => {
    // Thursday Nov 19 2026.
    expect(daytimeChecksRunning(est("2026-11-19", "14:58"))).toBe(true);
    expect(daytimeChecksRunning(est("2026-11-19", "07:00"))).toBe(true);
    expect(daytimeChecksRunning(est("2026-11-19", "19:59"))).toBe(true);
    expect(daytimeChecksRunning(est("2026-11-19", "20:00"))).toBe(false);
    expect(daytimeChecksRunning(est("2026-11-19", "06:59"))).toBe(false);
    expect(daytimeChecksRunning(est("2026-11-21", "12:00"))).toBe(false);
  });
});
