import { differenceInCalendarDays, isValid, parseISO } from "date-fns";

/**
 * How far along a pending case is by its own estimate: the days left to the estimated date, and the share of the
 * estimated wait (filing to that date) already behind it.
 *
 * Both are read off the estimate the page already shows, so they can never say more than it does: when the estimate
 * moves, they move with it. Null when there's nothing honest to count: a date that can't be read, an estimate that
 * isn't after the filing, a clock before the filing, or an estimated day already behind us (a stale estimate).
 */
export interface EstimateProgress {
  /** Whole calendar days from today to the estimated date; 0 on the day itself. */
  daysLeft: number;
  /** Whole calendar days from filing to today. */
  daysPassed: number;
  /** Whole calendar days from filing to the estimated date. */
  totalDays: number;
  /** The share of the estimated wait that has passed, rounded down and never 100 while the case waits. */
  passedPct: number;
}

export function estimateProgress({
  filingDate,
  estimatedDate,
  today,
}: {
  filingDate: string | null;
  estimatedDate: string | null;
  /** "YYYY-MM-DD", the page's one clock. */
  today: string;
}): EstimateProgress | null {
  if (!filingDate || !estimatedDate) return null;
  const filed = parseISO(filingDate);
  const due = parseISO(estimatedDate);
  const now = parseISO(today);
  if (!isValid(filed) || !isValid(due) || !isValid(now)) return null;
  const totalDays = differenceInCalendarDays(due, filed);
  const daysPassed = differenceInCalendarDays(now, filed);
  const daysLeft = differenceInCalendarDays(due, now);
  if (totalDays <= 0 || daysPassed < 0 || daysLeft < 0) return null;
  return { daysLeft, daysPassed, totalDays, passedPct: Math.min(99, Math.floor((daysPassed / totalDays) * 100)) };
}
