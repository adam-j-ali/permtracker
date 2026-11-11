/**
 * The small pictures a list page's summary figures carry, worked out from the
 * summary the page already loads. One rule for every list, so the same figure
 * is drawn the same way on each of them.
 */
import type { FigureTrend } from "@/components/data/FigureRow";
import type { SplitPart } from "@/components/data/FigureVisual";
import { formatInt } from "@/lib/format";
import { formatMonth } from "@/lib/dolFormat";

interface Counted {
  total: number;
  pending: number;
  decided: number;
}

/** Waiting against decided, of everything DOL's service holds: the split bar under "Waiting at DOL now". */
export function waitingSplit(
  summary: Counted | null | undefined,
  nouns: string,
): { parts: SplitPart[]; label: string } | undefined {
  if (!summary || summary.total <= 0) return undefined;
  return {
    parts: [
      { value: summary.decided, tone: "good" },
      { value: summary.pending, tone: "wait" },
    ],
    label: `${formatInt(summary.pending)} of ${formatInt(summary.total)} ${nouns} are still waiting, and ${formatInt(summary.decided)} are decided.`,
  };
}

/**
 * The last complete month's filings, with the twelve complete months up to it
 * as a spark line and the change on the month before as the chip. The month
 * in progress is left out: a part-month always reads as a fall.
 */
export function filedLastMonth(
  byMonth: readonly { month: string; total: number }[] | null | undefined,
  today: string,
): { label: string; value: string; spark: number[]; trend?: FigureTrend } | undefined {
  if (!byMonth) return undefined;
  const thisMonth = today.slice(0, 7);
  const done = byMonth
    .filter((m) => /^\d{4}-\d{2}$/.test(m.month) && m.month < thisMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
  const last = done[done.length - 1];
  if (!last) return undefined;
  const before = done[done.length - 2];
  const name = formatMonth(last.month) ?? last.month;
  let trend: FigureTrend | undefined;
  if (before && before.total > 0) {
    const pct = Math.round(((last.total - before.total) / before.total) * 100);
    const prior = (formatMonth(before.month) ?? before.month).split(" ")[0];
    trend =
      Math.abs(pct) < 1
        ? { text: `Level with ${prior}`, dir: "level", tone: "neutral" }
        : { text: `${Math.abs(pct)}% ${pct > 0 ? "more" : "fewer"} than ${prior}`, dir: pct > 0 ? "up" : "down", tone: "info" };
  }
  return { label: `Filed in ${name}`, value: formatInt(last.total), spark: done.map((m) => m.total), ...(trend ? { trend } : {}) };
}
