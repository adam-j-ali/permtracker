/**
 * The layoff check on a case: the employer's WARN notices dated within the six months before the ETA 9089's filing
 * day, the look-back 20 CFR 656.17(k)(1) names (read from eCFR, Nov 20 2026). Before the filing, the window ends today:
 * what a filing today would look back on. Information only: a WARN notice is a state's record of a planned layoff at a
 * site, and whether it was in this job's occupation or a related one, in the area of intended employment, is the
 * employer's to check.
 */
import { format, parseISO, subMonths } from "date-fns";

export interface LayoffWindow {
  from: string;
  to: string;
  /** True when the window ends on the ETA 9089's filing day; false when it ends today. */
  filed: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function layoffWindow(eta9089FilingDate: string | null | undefined, today: string): LayoffWindow {
  const filed = typeof eta9089FilingDate === "string" && DAY.test(eta9089FilingDate);
  const to = filed ? eta9089FilingDate : today;
  return { from: format(subMonths(parseISO(to), 6), "yyyy-MM-dd"), to, filed };
}

/**
 * Whether a notice's date falls in the window. A state that prints the month alone ("2026-10": New Jersey,
 * Pennsylvania) counts when that month overlaps the window, since the notice may be from any day of it.
 */
export function inLayoffWindow(noticeDate: string, w: Pick<LayoffWindow, "from" | "to">): boolean {
  if (DAY.test(noticeDate)) return noticeDate >= w.from && noticeDate <= w.to;
  if (/^\d{4}-\d{2}$/.test(noticeDate)) return noticeDate >= w.from.slice(0, 7) && noticeDate <= w.to.slice(0, 7);
  return false;
}
