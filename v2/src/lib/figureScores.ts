/**
 * Our figures scored against the agency's own (scripts/score_official_figures.py writes figure_scores; the admin's
 * Scorecard tab shows these lines). One line per figure, scope and day, newest first, in words. libSQL returns numbers
 * as strings, so every number goes through Number().
 */
export interface FigureScoreRow {
  figure: string;
  scope: string;
  as_of: string;
  unit: string;
  ours: number | string;
  theirs: number | string;
  tolerance: number | string;
  gap: number | string;
  gap_pct: number | string | null;
  within: number | string;
  ours_source: string;
  theirs_source: string;
  theirs_read_on: string | null;
  note: string | null;
}

export interface ScoreLine {
  key: string;
  title: string;
  scope: string;
  asOf: string;
  ours: number;
  theirs: number;
  unit: string;
  tolerance: number;
  within: boolean;
  gapText: string;
  oursSource: string;
  theirsSource: string;
  note: string;
}

function titleOf(figure: string): string {
  if (figure === "perm.pending") return "PERM cases pending";
  const m = /^perm\.analyst_review_mean_(\d+)d$/.exec(figure);
  if (m) return `Days to a decision out of analyst review, last ${m[1]} days`;
  return figure;
}

const signed = (n: number, digits = 0) =>
  `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: digits })}`;

export function scoreLines(rows: FigureScoreRow[]): ScoreLine[] {
  return rows
    .map((r) => {
      const gap = Number(r.gap);
      const pct = r.gap_pct === null || r.gap_pct === "" ? null : Number(r.gap_pct);
      return {
        key: `${r.figure}|${r.scope}|${r.as_of}`,
        title: titleOf(r.figure),
        scope: r.scope,
        asOf: r.as_of,
        ours: Number(r.ours),
        theirs: Number(r.theirs),
        unit: r.unit,
        tolerance: Number(r.tolerance),
        within: Number(r.within) === 1,
        gapText: `${signed(gap, 1)} ${r.unit}${pct === null ? "" : ` (${pct > 0 ? "+" : ""}${pct.toFixed(2)}%)`}`,
        oursSource: r.ours_source,
        theirsSource: r.theirs_source,
        note: r.note ?? "",
      };
    })
    .sort((a, b) => b.asOf.localeCompare(a.asOf) || a.title.localeCompare(b.title) || a.scope.localeCompare(b.scope));
}
