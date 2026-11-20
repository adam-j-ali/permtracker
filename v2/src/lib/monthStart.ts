import type { BacklogMonth } from "@/lib/backlogMonths";
import { HOLD_STATUS } from "@/lib/employerStages";
import { shiftDay } from "@/lib/filingsByDay";
import { addBusinessDays, countBusinessDays, isBusinessDay } from "@/lib/perm";
import { ANALYST_REVIEW } from "@/lib/searchStages";
import { shiftMonth } from "@convex/lib/months";

/**
 * When DOL starts deciding the next filing month, read from its own record.
 *
 * DOL works its PERM queue a filing month at a time, and it starts the next
 * month before the last one is finished. People waiting ask when that happens
 * every day, and the answers passed around ("once the month is 75 to 80% done",
 * "once fewer than 3,000 are left") are guesses. This module reads it from the
 * past-day census (perm_census_days): the day each month's decisions began,
 * and how far the month before had got at the end of the day before.
 *
 * MEASURED, Nov 20 2026, on the four starts the record holds (December 2025
 * on Sep 22, January 2026 on Oct 20, February 2026 on Nov 10, March 2026 on
 * Nov 17): the month before had 2,607, 2,557, 1,603 and 2,258 cases still in
 * analyst review. The estimate below dates the next start by that count.
 *
 * Until Nov 20 it used the share of the month before that was decided (on
 * hold left out): 80.0%, 80.9% and 82.5% at the first three starts, the
 * steadiest measure on those. Then March began with February 54% decided:
 * February was a small month (5,494 filings to March's 7,042), and DOL began
 * the next month at about the same count left, whatever the month's size. The
 * share rule's first live estimate, Fri Nov 20, was three working days late.
 *
 * Run on the record as it stood each working day in the two weeks before each
 * start, the count rule named the real day or a working day either side of it
 * on 22 of 23 days; the other, the first working day after February began, it
 * ran three working days late (monthStart.test.ts keeps that backtest). The
 * share rule managed 20 of 23, up to seven working days late. Four starts is
 * a short record, and the page says so.
 */

/** One filing month at the end of one past DOL day, as `perm_census_days` holds it. */
export interface MonthDay {
  /** "YYYY-MM-DD", the Eastern day the census describes the end of. */
  day: string;
  /** "YYYY-MM", the filing month. */
  month: string;
  total: number;
  /** Final statuses: certified, denied, withdrawn. */
  decided: number;
  withdrawn: number;
  /** APPLICATION ON HOLD: cases DOL has set aside. */
  held: number;
  /** ANALYST REVIEW: the ordinary line. */
  inLine: number;
}

/** The figures for one filing month right now, from the live census. */
export type LiveMonth = Pick<MonthDay, "month" | "total" | "decided" | "held" | "inLine">;

/** A day DOL began deciding a filing month, and where the month before stood. */
export interface MonthStart {
  month: string;
  day: string;
  previous: string;
  /** The month before, decided over the cases DOL can decide, at the end of the day before. */
  previousShare: number;
  previousDecided: number;
  previousWorkable: number;
  previousInLine: number;
}

/**
 * A month starts on the first day DOL decides at least this many of its cases.
 * DOL decides stragglers from later months every day (a few dozen at most in
 * the record), and a month's first day of real work ran 75 to 222.
 */
export const START_JUMP = 50;

/**
 * And only once the record has seen the month standing still for this many
 * working days first. Without it, a month already being decided when the
 * record begins would read its first recorded day as its start (November 2025
 * gained 498 on Aug 31, the record's second day).
 */
export const QUIET_DAYS = 3;

/** The newest starts the estimate reads, since DOL's habit can drift. */
export const STARTS_USED = 3;

/** The pace is read over at most this many calendar days, and never from before the month began. */
export const PACE_DAYS = 7;

/** A pace needs this many working days since the month began; its first day alone is a ramp. */
export const PACE_MIN_DAYS = 2;

/** A live census month's figures, in the series' terms: the same statuses perm_census_days sums. */
export function liveMonthFrom(m: BacklogMonth): LiveMonth {
  const count = (status: string) => m.statuses.find((s) => s.status === status)?.count ?? 0;
  return { month: m.month, total: m.total, decided: m.decided, held: count(HOLD_STATUS), inLine: count(ANALYST_REVIEW) };
}

/** Decided over the cases DOL can decide: the ones on hold are left out. Null when there are none. */
export function shareDecided(m: Pick<MonthDay, "total" | "decided" | "held">): number | null {
  const workable = m.total - m.held;
  return workable > 0 ? m.decided / workable : null;
}

/** "YYYY-MM-DD|YYYY-MM": one row of the series. */
function key(day: string, month: string): string {
  return `${day}|${month}`;
}

/**
 * Every start the record can see, oldest first.
 *
 * A start is the first day a month gains START_JUMP or more of DOL's own
 * decisions (withdrawals are the employer's and don't count), after the record
 * has seen it gain fewer on QUIET_DAYS working days. The month before is read
 * at the end of the day before that.
 */
export function findMonthStarts(series: readonly MonthDay[]): MonthStart[] {
  const days = [...new Set(series.map((r) => r.day))].sort();
  const at = new Map(series.map((r) => [key(r.day, r.month), r]));
  const months = [...new Set(series.map((r) => r.month))].sort();
  const starts: MonthStart[] = [];
  for (const month of months) {
    let quiet = 0;
    for (let i = 1; i < days.length; i++) {
      const before = at.get(key(days[i - 1]!, month));
      const now = at.get(key(days[i]!, month));
      if (!before || !now) continue;
      const jump = now.decided - now.withdrawn - (before.decided - before.withdrawn);
      if (jump < START_JUMP) {
        if (isBusinessDay(days[i]!)) quiet++;
        continue;
      }
      // The first jump decides it: a month first seen moving has no start on the record.
      if (quiet >= QUIET_DAYS) {
        const previous = shiftMonth(month, -1);
        const prev = at.get(key(days[i - 1]!, previous));
        const share = prev ? shareDecided(prev) : null;
        if (prev && share !== null) {
          starts.push({
            month,
            day: days[i]!,
            previous,
            previousShare: share,
            previousDecided: prev.decided,
            previousWorkable: prev.total - prev.held,
            previousInLine: prev.inLine,
          });
        }
      }
      break;
    }
  }
  return starts.sort((a, b) => a.day.localeCompare(b.day) || a.month.localeCompare(b.month));
}

interface Shared {
  /** The month whose start is being estimated. */
  month: string;
  /** The month DOL began most recently, the one being worked down. */
  current: string;
  currentStarted: string;
  /** The newest day of the record: every working day is counted from it. */
  asOf: string;
  decided: number;
  /** The current month's cases DOL can decide (on hold left out). */
  workable: number;
  inLine: number;
  held: number;
  share: number;
  /** The fewest and the most cases the month before still had in analyst review at the starts read. */
  inLineLow: number;
  inLineHigh: number;
  basedOn: MonthStart[];
}

export type NextStart =
  | (Shared & {
      state: "estimate";
      /** Decisions still to go before the current month is down to the most and the fewest left at those starts. */
      needLow: number;
      needHigh: number;
      /** The current month's decisions per working day; null when there's too little to measure. */
      pace: number | null;
      /** The likely first day of the next month, earliest and latest; null without a pace. */
      from: string | null;
      to: string | null;
    })
  | (Shared & {
      /** Down to the fewest left at those starts already: the next month is due on the next working day. */
      state: "due";
      from: string;
    });

/**
 * When the month after the one DOL is working will likely start.
 *
 * The current month is the newest start on record. It's down to the count
 * the month before still had in analyst review at each recent start after
 * `need / pace` working days, and the next month begins the working day after
 * that: what each start in the record did. Null when there is no start on
 * record or no live figures for the current month.
 *
 * The pace divides by working days from the federal calendar rather than by
 * days that carry a decision (dolPace.ts's businessDayPace): the census
 * records some decisions on weekends and a few on holidays, and counting those
 * as working days halved February's pace on Nov 16 2026.
 */
export function estimateNextStart({
  series,
  starts,
  live,
}: {
  series: readonly MonthDay[];
  starts: readonly MonthStart[];
  live: LiveMonth | null;
}): NextStart | null {
  const latest = starts.at(-1);
  if (!latest || !live || live.month !== latest.month) return null;
  const workable = live.total - live.held;
  if (workable <= 0) return null;
  const days = [...new Set(series.map((r) => r.day))].sort();
  const asOf = days.at(-1);
  if (!asOf) return null;

  const basedOn = starts.slice(-STARTS_USED);
  const left = basedOn.map((s) => s.previousInLine);
  const inLineLow = Math.min(...left);
  const inLineHigh = Math.max(...left);
  const shared: Shared = {
    month: shiftMonth(latest.month, 1),
    current: latest.month,
    currentStarted: latest.day,
    asOf,
    decided: live.decided,
    workable,
    inLine: live.inLine,
    held: live.held,
    share: live.decided / workable,
    inLineLow,
    inLineHigh,
    basedOn,
  };
  // The soonest start comes when the month is down to the most any recent start had left, the latest at the fewest.
  const needLow = Math.max(0, live.inLine - inLineHigh);
  const needHigh = Math.max(0, live.inLine - inLineLow);
  if (needHigh === 0) return { ...shared, state: "due", from: addBusinessDays(asOf, 1) };

  const pace = currentPace(series, days, latest, asOf);
  const startAfter = (need: number) =>
    pace === null ? null : addBusinessDays(need === 0 ? asOf : addBusinessDays(asOf, Math.ceil(need / pace)), 1);
  return { ...shared, state: "estimate", needLow, needHigh, pace, from: startAfter(needLow), to: startAfter(needHigh) };
}

/** The current month's decisions per working day since it began, over at most PACE_DAYS. */
function currentPace(series: readonly MonthDay[], days: readonly string[], latest: MonthStart, asOf: string): number | null {
  const dayBeforeStart = days[days.indexOf(latest.day) - 1];
  const weekAgo = days.find((d) => d >= shiftDay(asOf, -PACE_DAYS));
  const base = [dayBeforeStart, weekAgo].filter((d): d is string => !!d).sort().at(-1);
  if (!base) return null;
  const from = series.find((r) => r.day === base && r.month === latest.month);
  const to = series.find((r) => r.day === asOf && r.month === latest.month);
  if (!from || !to) return null;
  // Counted from the day after the base: the base's own figures are the end of that day.
  const workdays = countBusinessDays(shiftDay(base, 1), asOf);
  const gained = to.decided - from.decided;
  if (workdays < PACE_MIN_DAYS || gained <= 0) return null;
  return Math.round(gained / workdays);
}
