/**
 * Online receipts USCIS issues a day, from the sample's census (Batch 3, Nov 25 2026).
 *
 * Online (IOE) numbers aren't issued in the order cases are received, so a day's receipts can't be counted by received
 * day. The census walks each online block up to the newest issued number every day; the cases it finds between two
 * walks that each reached that edge are the cases issued in between (the kit's issued_runs, loaded as
 * perm_docs 'uscis_sample_issued'). One walk's span can be a few overnight hours, when few people file, so the figure
 * is never one run: it's the newest runs of each block summed until they cover a full week, so every weekday and the
 * weekend count once.
 */

export interface IssuedRun {
  /** The Eastern day of the walk that reached the edge. */
  day: string;
  /** The number's first five characters: IOE09. */
  block: string;
  issued: number;
  /** Hours since the block's previous walk that reached the edge. */
  hours: number;
  per_day: number | null;
  by_form: Record<string, number>;
}

export interface IssuedWeek {
  perDay: number;
  issued: number;
  hours: number;
  /** The first and last walk days the window holds. */
  from: string;
  to: string;
  /** The forms with the most cases a day, most first; a case with no form read is left out. */
  forms: { form: string; perDay: number }[];
}

/** A full week, so a weekend's quiet days and a Monday's rush each count once. */
export const ISSUED_WINDOW_HOURS = 168;
const ONLINE = /^IOE\d{2}$/;

export function issuedWeek(runs: readonly IssuedRun[], topForms = 3): IssuedWeek | null {
  const byBlock = new Map<string, IssuedRun[]>();
  for (const r of runs) {
    if (!ONLINE.test(r.block) || !(r.hours > 0)) continue;
    byBlock.set(r.block, [...(byBlock.get(r.block) ?? []), r]);
  }
  let perDay = 0;
  let issued = 0;
  let hours = 0;
  let from = "";
  let to = "";
  const forms = new Map<string, number>();
  for (const blockRuns of byBlock.values()) {
    const newestFirst = [...blockRuns].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    const window: IssuedRun[] = [];
    let spanned = 0;
    for (const r of newestFirst) {
      window.push(r);
      spanned += r.hours;
      if (spanned >= ISSUED_WINDOW_HOURS) break;
    }
    // A block without a full week of walks yet says nothing rather than a weekday-only rate.
    if (spanned < ISSUED_WINDOW_HOURS) continue;
    const n = window.reduce((sum, r) => sum + r.issued, 0);
    perDay += (n * 24) / spanned;
    issued += n;
    hours = Math.max(hours, spanned);
    const first = window[window.length - 1]!.day;
    const last = window[0]!.day;
    if (!from || first < from) from = first;
    if (!to || last > to) to = last;
    for (const r of window) {
      for (const [form, k] of Object.entries(r.by_form)) {
        if (!form) continue;
        forms.set(form, (forms.get(form) ?? 0) + (k * 24) / spanned);
      }
    }
  }
  if (!issued) return null;
  return {
    perDay: Math.round(perDay),
    issued,
    hours: Math.round(hours),
    from,
    to,
    forms: [...forms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topForms)
      .map(([form, k]) => ({ form, perDay: Math.round(k) })),
  };
}
