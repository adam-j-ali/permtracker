/**
 * When the server asks DOL about every pending PERM case, on an Eastern clock.
 *
 * The daily page says when its list was last read and when the next read starts. Those times are the server's
 * timers (scripts/oracle/systemd/permtracker-sweep@case-status-*.timer), and sweepSchedule.test.ts reads the timer
 * files, so a timer that moves fails the build until this list moves with it.
 *
 * A pass takes about half an hour before the pages show it, so a page says "starts at", never "updates at".
 */

import { easternDay } from "@/lib/time";

export interface CaseCheck {
  /** "HH:MM", 24-hour, Eastern. */
  at: string;
  /** Monday to Friday only. */
  weekdays: boolean;
}

export const CASE_CHECKS: readonly CaseCheck[] = [
  { at: "04:10", weekdays: false },
  { at: "10:40", weekdays: true },
  { at: "15:40", weekdays: false },
  { at: "20:10", weekdays: false },
];

const EASTERN_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" });

function easternClock(ms: number): string {
  const parts = EASTERN_PARTS.formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}`;
}

/** The instant an Eastern wall-clock time falls on, or null for a time a clock change skips. */
function easternInstant(day: string, at: string): number | null {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = at.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined) return null;
  // Eastern is UTC-4 or UTC-5: one of the two lands on the asked-for wall clock.
  for (const offset of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, hh + offset, mm);
    if (easternDay(ms) === day && easternClock(ms) === at) return ms;
  }
  return null;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const isWeekday = (day: string) => {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
};

/** When the next check starts after `ms`, epoch ms. Looks a week ahead, which always holds one. */
export function nextCheckAfter(ms: number): number | null {
  let day = easternDay(ms);
  for (let i = 0; i < 8; i++, day = nextDay(day)) {
    for (const c of CASE_CHECKS) {
      if (c.weekdays && !isWeekday(day)) continue;
      const at = easternInstant(day, c.at);
      if (at !== null && at > ms) return at;
    }
  }
  return null;
}

/** "3:40 PM" for "15:40". */
export function clockLabel(at: string): string {
  const [hh, mm] = at.split(":").map(Number);
  if (hh === undefined || mm === undefined) return at;
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/** "3:40 PM" on the same Eastern day as `from`, or "4:10 AM tomorrow", or "10:40 AM Monday" further out. */
export function nextCheckLabel(from: number): string | null {
  const next = nextCheckAfter(from);
  if (next === null) return null;
  const clock = clockLabel(easternClock(next));
  const today = easternDay(from);
  const day = easternDay(next);
  if (day === today) return clock;
  if (day === nextDay(today)) return `${clock} tomorrow`;
  return `${clock} ${new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" })}`;
}

/**
 * When the server reads the wage requests (permtracker-sweep@pwd-pending.timer, then pwd-active.timer): the pending
 * ones at 5:40 AM every day, the likeliest to move at 3:10 PM on weekdays. The weekly read of every one (Sundays 6:40
 * AM) is left out: Saturday's work has already arrived at 5:40. sweepSchedule.test.ts holds this to the timer files.
 */
export const WAGE_CHECKS: readonly CaseCheck[] = [
  { at: "05:40", weekdays: false },
  { at: "15:10", weekdays: true },
];

/** About how long after a read starts the pages show what it found. */
const READ_SHOWS_MS = 30 * 60_000;

/**
 * The read that makes a DOL day's wage count whole: 5:40 AM the next morning, before DOL's day turns at 7 AM, so what
 * it finds is dated to the day before (src/lib/dolDay.ts). On a weekend it's the only read, so a Sunday's count
 * arrives with Monday's.
 */
export function wageDayWholeAt(day: string): number | null {
  return easternInstant(nextDay(day), WAGE_CHECKS[0]!.at);
}

/** Whether the pages already show a DOL day's whole wage count at `now`. */
export function wageDayWhole(day: string, now: number): boolean {
  const at = wageDayWholeAt(day);
  return at !== null && now >= at + READ_SHOWS_MS;
}

/**
 * The daytime pass (permtracker-sweep@case-status-active.timer, since Nov 19 2026): every 15 minutes on weekdays from
 * 7 AM to 7:45 PM Eastern, it reads the pending cases DOL is deciding now, so the day's counts rise through the day
 * between the full reads above. sweepSchedule.test.ts holds this to the timer file.
 */
export const DAYTIME_CHECKS = { first: "07:00", last: "19:45", everyMinutes: 15, weekdays: true } as const;

/** Whether a daytime read is due within the quarter hour at `ms`: a weekday between 7 AM and 8 PM Eastern. */
export function daytimeChecksRunning(ms: number): boolean {
  if (DAYTIME_CHECKS.weekdays && !isWeekday(easternDay(ms))) return false;
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const now = minutes(easternClock(ms));
  return now >= minutes(DAYTIME_CHECKS.first) && now < minutes(DAYTIME_CHECKS.last) + DAYTIME_CHECKS.everyMinutes;
}
