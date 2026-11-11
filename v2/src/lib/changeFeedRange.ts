/**
 * A range of days on the change feed, for dates DOL hasn't published yet.
 *
 * The feed loads one day per request (`/api/case-changes?date=`), each cached at the edge once the day has
 * settled. Until Nov 11 2026 a range over such days loaded nothing and printed zeros, with no line saying why.
 * A range now loads each of its days and adds them up: `observedDaysIn` picks the days, `mergeChangeDays` makes
 * one feed of them.
 *
 * THE CAP IS SAID, NEVER SILENT. A range longer than RANGE_DAYS_MAX days of changes loads the newest ones and the
 * page names how many it left out.
 */

// One line, deliberately: no-server-only-in-client.test.ts checks each import line on its own.
import type { ChangeCalendar, ChangeDayFeed, TransitionCount } from "@/lib/db/changes";
import { CHANGE_PROGRAMS, type ChangeProgram } from "@/lib/changeProgram";

/** The most days one range loads. Each is one request of up to 5,000 rows. */
export const RANGE_DAYS_MAX = 7;

export interface RangePlan {
  /** The days to load, newest first. */
  dates: string[];
  /** Days inside the range that hold changes and aren't loaded, because the range is longer than the cap. */
  left: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Which days of a range to load. The calendar lists every day that holds a change, so a day it doesn't list is
 * skipped without a request. Days older than the calendar reaches (it's cut off at its oldest day when
 * `truncated`) can't be ruled out, so each of those is asked for.
 */
export function observedDaysIn(
  range: { from: string; to: string },
  calendar: Pick<ChangeCalendar, "days" | "truncated">,
  max: number = RANGE_DAYS_MAX,
): RangePlan {
  if (range.to < range.from) return { dates: [], left: 0 };
  const listed = new Set(calendar.days.filter((d) => d.total > 0).map((d) => d.date));
  const oldestListed = calendar.days.length ? calendar.days.map((d) => d.date).sort()[0]! : null;
  const wanted: string[] = [];
  // Newest first, a day at a time. Bounded so a decade-long range can't spin: past the cap only a count is kept.
  const day = new Date(`${range.to}T00:00:00Z`);
  const stop = new Date(`${range.from}T00:00:00Z`);
  for (let i = 0; i < 4000 && day >= stop; i++, day.setUTCDate(day.getUTCDate() - 1)) {
    const d = iso(day);
    const beyondCalendar = calendar.truncated && (oldestListed === null || d < oldestListed);
    if (listed.has(d) || beyondCalendar) wanted.push(d);
  }
  return { dates: wanted.slice(0, max), left: Math.max(0, wanted.length - max) };
}

/** Several days as one feed: `date` is the newest day in it, `since` the oldest, `days` how many were added up. */
export interface ChangeRangeFeed extends ChangeDayFeed {
  since: string;
  days: number;
}

/** Add days up. Rows keep each day's own order, newest day first; every count is a sum. Null for no days. */
export function mergeChangeDays(feeds: readonly ChangeDayFeed[]): ChangeRangeFeed | null {
  if (feeds.length === 0) return null;
  const ordered = [...feeds].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const byProgram = Object.fromEntries(CHANGE_PROGRAMS.map((p) => [p, 0])) as Record<ChangeProgram, number>;
  const kinds = new Map<string, TransitionCount>();
  let total = 0;
  let expiriesExcluded = 0;
  let bulkExcluded = 0;
  for (const f of ordered) {
    total += f.total;
    expiriesExcluded += f.expiriesExcluded;
    bulkExcluded += f.bulkExcluded;
    for (const p of CHANGE_PROGRAMS) byProgram[p] += f.byProgram[p] || 0;
    for (const t of f.transitions) {
      const key = `${t.fromStatus}\u0000${t.toStatus}`;
      const held = kinds.get(key);
      if (held) held.n += t.n;
      else kinds.set(key, { ...t });
    }
  }
  return {
    date: ordered[0]!.date,
    since: ordered[ordered.length - 1]!.date,
    days: ordered.length,
    changes: ordered.flatMap((f) => f.changes),
    total,
    byProgram,
    transitions: [...kinds.values()].sort((a, b) => b.n - a.n || a.fromStatus.localeCompare(b.fromStatus) || a.toStatus.localeCompare(b.toStatus)),
    expiriesExcluded,
    bulkExcluded,
  };
}
