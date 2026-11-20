import { checkedLabel, clockLabel, easternDay } from "@/lib/time";

/**
 * The two times a page can print for DOL's PERM record.
 *
 * Every pass that asks DOL stamps its finish (perm_docs['latest_check']): the daytime pass every 15 minutes on
 * weekdays, for the cases DOL is deciding, and the four complete reads of every waiting case. The figures on a page
 * are as new as the newest of those, so that's the time it prints. The last complete read (sweep_coverage) goes
 * beside it when it's older, so a reader knows when the rest of the record was read.
 */
export interface CheckTimes {
  /** When the newest check of DOL's record finished, epoch ms. */
  newest: number;
  /** When the last complete read of every waiting case finished, epoch ms; null when none is recent. */
  full: number | null;
}

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** The newest check and the last complete read, or null when neither is on record. */
export function checkTimes(latest: number | null | undefined, full: number | null | undefined): CheckTimes | null {
  const l = finite(latest);
  const f = finite(full);
  if (l === null && f === null) return null;
  return { newest: Math.max(l ?? Number.NEGATIVE_INFINITY, f ?? Number.NEGATIVE_INFINITY), full: f };
}

/** Whether the newest check is the complete read itself (its record is written after its pass's own stamp). */
export function newestIsFullRead(t: CheckTimes): boolean {
  return t.full !== null && t.full >= t.newest;
}

/**
 * "checked 12:45 PM ET, Nov 20 (every waiting case read in full by 10:55 AM ET)", or "checked 10:55 AM ET, Nov 20"
 * when the newest check was the complete read. The complete read's day is named only when it isn't the newest
 * check's day.
 */
export function checkedPhrase(t: CheckTimes): string {
  const head = `checked ${checkedLabel(t.newest)}`;
  if (t.full === null || newestIsFullRead(t)) return head;
  const fullAt = easternDay(t.full) === easternDay(t.newest) ? clockLabel(t.full) : checkedLabel(t.full);
  return `${head} (every waiting case read in full by ${fullAt})`;
}
