import { dolDayOf } from "@/lib/dolDay";

/**
 * A case's status history: every status DOL's record showed, in order, from the changes our checks saw.
 *
 * Each change is dated to the day DOL worked when our checks first saw it (`dolDayOf`, the rule every count on
 * the site uses since Oct 27 2026). Our record of changes began Aug 26 2026 and its first full sweeps caught up
 * through Aug 29: 94,859 and 46,172 changes on Aug 28 and 29 against about 1,000 to 1,600 a day after, changes
 * that happened at any time before. So a change seen by then isn't dated: it only says where the case stood by
 * Aug 29, and that is the first step. Plain module: the page and its test read it.
 */

/**
 * The last day of the record's catch-up: a change seen on or before it says where a case stood, not when it moved.
 * MUST MATCH `HISTORY_FROM` in `scripts/ingest_case_status_direct.py`, which leaves the same changes out of the
 * stage statistics, the RFI path and the RFI clock; `statusHistory.test.ts` reads that file and holds the two equal.
 */
export const HISTORY_FROM = "2026-08-29";

/** One change as the event log holds it. */
export interface StatusEvent {
  /** When our check saw it, epoch ms. */
  at: number;
  from: string;
  to: string;
}

export interface HistoryStep {
  status: string;
  /**
   * The DOL day the case reached this status. For the first step: the filing day when the case was filed after our
   * record began, else null (it held the status before the record began, since when we can't say).
   */
  since: string | null;
  /** Whole days it held the status before the next change; null for the status it holds now, or an unknown start. */
  days: number | null;
  /** The first step of a case filed after our record began: it dates from the filing. */
  filed?: true;
}

const norm = (s: string) => s.trim().toUpperCase();
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);

/**
 * The steps, oldest first, or [] when nothing changed on our record. A change to the same status (a correction
 * of DOL's own wording) isn't a step, and two changes on one DOL day keep the later.
 */
export function statusHistory(events: readonly StatusEvent[], filedOn?: string | null): HistoryStep[] {
  const changes = [...events]
    .filter((e) => Number.isFinite(e.at) && norm(e.from) !== norm(e.to))
    .sort((a, b) => a.at - b.at);
  if (changes.length === 0) return [];
  const filedInRecord = !!filedOn && /^\d{4}-\d{2}-\d{2}$/.test(filedOn) && filedOn > HISTORY_FROM;
  const steps: HistoryStep[] = [
    filedInRecord
      ? { status: norm(changes[0]!.from), since: filedOn!, days: null, filed: true }
      : { status: norm(changes[0]!.from), since: null, days: null },
  ];
  for (const e of changes) {
    const day = dolDayOf(e.at);
    const last = steps[steps.length - 1]!;
    // Seen during the catch-up: where the case stood by its end, not a dated move.
    if (day <= HISTORY_FROM && steps.length === 1 && last.since === null) {
      last.status = norm(e.to);
      continue;
    }
    if (last.since === day && steps.length > 1) {
      last.status = norm(e.to);
      // Back to where it was that morning: the day's moves cancel out.
      if (steps[steps.length - 2]!.status === last.status) steps.pop();
      continue;
    }
    if (last.status === norm(e.to)) continue;
    steps.push({ status: norm(e.to), since: day, days: null });
  }
  for (let i = 0; i < steps.length - 1; i += 1) {
    const s = steps[i]!;
    if (s.since === null) continue;
    const next = steps[i + 1]!;
    s.days = Math.round((dayMs(next.since!) - dayMs(s.since!)) / 86_400_000);
  }
  return steps.length > 1 ? steps : [];
}

/**
 * The DOL day our checks first saw a case in the status it holds now, "YYYY-MM-DD", or null when the record can't
 * date it (no change on record, or one seen during the record's catch-up, which says where the case stood and
 * never when it moved). For a case decided in DOL's live record before its quarterly file names a decision date.
 */
export function seenInStatusSince(events: readonly StatusEvent[], status: string): string | null {
  const want = status.trim().toUpperCase().split(/\s+/).join(" ");
  const last = [...events]
    .filter((e) => e.to.trim().toUpperCase().split(/\s+/).join(" ") === want)
    .sort((a, b) => b.at - a.at)[0];
  if (!last) return null;
  const day = dolDayOf(last.at);
  return day > HISTORY_FROM ? day : null;
}
