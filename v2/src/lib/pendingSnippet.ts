/**
 * The search-result sentence for an employer with cases still waiting on DOL.
 *
 * A search like "adobe perm on hold" comes from someone whose case is waiting,
 * so the description leads with the live count when there is one: "Adobe Inc.
 * has 218 PERM cases waiting with DOL, 216 of them on hold." The figures come
 * from `perm_entity_pending`, refreshed after every sweep, and the nightly
 * rebuild expires the pages whose counts moved, so the sentence stays within a
 * day of DOL's record. With nothing waiting it returns null and the page keeps
 * its published-record description.
 */
import { formatInt } from "@/lib/format";
import { longDate } from "@convex/lib/months";

/** DOL's status for a case it has set aside, as the sweep stores it. */
export const ON_HOLD = "APPLICATION ON HOLD";

export interface PendingCounts {
  pending: number;
  stages: { status: string; n: number }[];
}

export function pendingSentence(name: string, counts: PendingCounts | null): string | null {
  if (!counts || counts.pending <= 0) return null;
  const p = counts.pending;
  const hold = counts.stages.find((s) => s.status === ON_HOLD)?.n ?? 0;
  const held =
    hold <= 0 ? "" : hold >= p ? (p === 1 ? ", on hold" : ", all of them on hold") : `, ${formatInt(hold)} of them on hold`;
  return `${name} has ${formatInt(p)} PERM case${p === 1 ? "" : "s"} waiting with DOL${held}.`;
}

/** "where they stand", or "where it stands" for one case. */
export function whereTheyStand(counts: PendingCounts): string {
  return counts.pending === 1 ? "where it stands" : "where they stand";
}

/**
 * The line under an employer's name: whether it sponsors green cards now,
 * answered from its own record, and its queue, in one sentence. People search
 * the question in those words, and PERM is the step an employer files to
 * sponsor one. No filings in a year isn't proof an employer won't sponsor, so
 * that half says nothing rather than "no". The heading already names the
 * employer, so this line doesn't; the sentence above keeps the name because it
 * stands alone in a search result.
 *
 * A sponsor with nothing filed in the year and nothing waiting still gets an
 * answer: the day of its newest filing, which says how long it has been, and
 * that nothing is waiting. "None in the last 12 months" is said only when the
 * count says 0 and the newest filing is older than a year; with the count
 * unknown, or two sources that disagree, the day stands alone. `today` is the
 * Eastern day (YYYY-MM-DD).
 */
export function profileLine(
  recent12m: number | null,
  newestFiled: string | null,
  counts: PendingCounts | null,
  today?: string,
): string | null {
  const year =
    recent12m && recent12m > 0
      ? `${formatInt(recent12m)} PERM case${recent12m === 1 ? "" : "s"} filed in the last 12 months${newestFiled ? `, the newest on ${longDate(newestFiled)}` : ""}`
      : null;
  let queue: string | null = null;
  if (counts && counts.pending > 0) {
    const p = counts.pending;
    const hold = counts.stages.find((s) => s.status === ON_HOLD)?.n ?? 0;
    const held = hold <= 0 ? "" : hold >= p ? (p === 1 ? ", on hold" : ", all of them on hold") : `, ${formatInt(hold)} of them on hold`;
    queue = `${formatInt(p)}${year ? "" : ` PERM case${p === 1 ? "" : "s"}`} waiting with DOL${held}`;
  }
  if (year && queue) return `Sponsors green cards: ${year}, and ${queue}.`;
  if (year) return `Sponsors green cards: ${year}.`;
  if (queue) return `${queue}.`;
  if (!newestFiled) return null;
  const day = longDate(newestFiled);
  if (!day) return null;
  if (recent12m === 0 && today && newestFiled.slice(0, 10) < yearBefore(today)) {
    return `No PERM filings in the last 12 months. The newest was filed on ${day}, and nothing is waiting with DOL.`;
  }
  return `The newest PERM filing on record was on ${day}, and nothing is waiting with DOL.`;
}

/** The day 365 days before an ISO day, as the nightly 12-month count measures its window. */
function yearBefore(isoDay: string): string {
  const t = Date.parse(`${isoDay.slice(0, 10)}T12:00:00Z`);
  return new Date(t - 365 * 86_400_000).toISOString().slice(0, 10);
}
