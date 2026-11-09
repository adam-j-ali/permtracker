/**
 * What DOL posted about reconsideration requests, and what our own record has watched of them: the pure
 * half of the appeal guide's timing block.
 *
 * DOL's processing-times page printed the month of "Reconsideration Request to the CO" it was working on
 * until its October 31, 2026 layout dropped the queue table. The readings kept before then are the only
 * official figure there is, so they're folded here to the runs DOL posted each month for, with the day
 * the line went away.
 */
import { monthIndex } from "@convex/lib/months";

/** One reading of DOL's page, as the stored snapshots carry it. */
export interface PostedReading {
  permAsOf: string;
  permQueues: readonly { queue: string; priorityDate: string | null }[];
}

export interface PostedRun {
  /** The month DOL said it was working on, `YYYY-MM`. */
  month: string;
  /** The first and last of DOL's own page dates that showed it. */
  from: string;
  to: string;
}

export interface ReconsiderationPosted {
  /** Oldest first. */
  runs: PostedRun[];
  /** The newest posting: its month, DOL's date for it, and how many months behind that date the month was. */
  last: { month: string; asOf: string; monthsBehind: number };
  /** DOL's date on the first reading without the line, after one that had it; null while DOL still posts it. */
  droppedAsOf: string | null;
}

const RECONSIDERATION = /reconsideration/i;

/** The record of DOL's posted month, or null when no reading kept ever carried one. */
export function reconsiderationPosted(history: readonly PostedReading[]): ReconsiderationPosted | null {
  const readings = [...history].filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.permAsOf)).sort((a, b) => a.permAsOf.localeCompare(b.permAsOf));
  const runs: PostedRun[] = [];
  let droppedAsOf: string | null = null;
  for (const r of readings) {
    const month = r.permQueues.find((q) => RECONSIDERATION.test(q.queue))?.priorityDate ?? null;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      // The first reading without the line after one with it; a later reading that has it again clears this.
      if (runs.length > 0 && droppedAsOf === null) droppedAsOf = r.permAsOf;
      continue;
    }
    droppedAsOf = null;
    const run = runs[runs.length - 1];
    if (run && run.month === month) run.to = r.permAsOf;
    else runs.push({ month, from: r.permAsOf, to: r.permAsOf });
  }
  const newest = runs[runs.length - 1];
  if (!newest) return null;
  return {
    runs,
    last: { month: newest.month, asOf: newest.to, monthsBehind: monthIndex(newest.to) - monthIndex(newest.month) },
    droppedAsOf,
  };
}

/** One point of a stage's stay curve (`StageCurvePoint`). */
interface CurvePoint {
  days: number;
  eligible: number;
  left: number;
}

/**
 * The furthest point our record can speak to: of the requests we watched arrive and have watched for at
 * least `days` days, how many had an answer by then. The furthest day with at least `floor` such requests,
 * or null when no day has that many.
 */
export function furthestWatched(curve: readonly CurvePoint[], floor = 60): CurvePoint | null {
  let best: CurvePoint | null = null;
  for (const pt of curve) if (pt.eligible >= floor && (!best || pt.days > best.days)) best = pt;
  return best;
}
