/**
 * Our daily read of State's visa bulletin page (the `bulletin-read` browser check, recorded in `ingest_runs` as
 * `browser-timer:bulletin-read`), as the visa bulletin pages may report it. The pure half.
 *
 * A read that loads the new bulletin stores it at once, so while the newest bulletin this site holds is still the
 * one before `next`, a fresh read of State's page means `next` wasn't there yet. Only a read of the page counts: the
 * check also records a run when it stopped early ("checked, nothing due") or couldn't read the page ("could not read
 * ..."). Before Nov 19 2026 the page guessed from past years alone and told readers the December 2026 bulletin "may
 * well be up" on a day our own read had found it wasn't.
 */
import { MS_PER_HOUR } from "@convex/lib/time";
import { shiftMonth } from "@convex/lib/months";
import { easternDay } from "@/lib/time";

export interface BulletinRead {
  /** When the check finished, epoch milliseconds. */
  checkedAt: number;
  /** The check's own note: "loaded State bulletin page, December 2026 not out yet". */
  note: string;
}

/** Past this, a read is too old to say anything about today. */
export const CHECK_FRESH_HOURS = 36;

/**
 * The read that shows `next` wasn't out, or null when there's none to stand on: no check, one that didn't read the
 * page, one older than 36 hours, or one made before the month `next` is due in.
 */
export function waitingCheck(next: string, check: BulletinRead | null, nowMs: number = Date.now()): { checkedAt: number } | null {
  if (!check || !/^loaded\b/i.test(check.note.trim())) return null;
  if (nowMs - check.checkedAt > CHECK_FRESH_HOURS * MS_PER_HOUR || check.checkedAt > nowMs + MS_PER_HOUR) return null;
  if (easternDay(check.checkedAt).slice(0, 7) < shiftMonth(next, -1)) return null;
  return { checkedAt: check.checkedAt };
}
