/**
 * The admin's view of our figures scored against DOL's own (figure_scores, scripts/score_official_figures.py): one
 * line per figure and scope, newest day first, in plain words, with whether it's inside its tolerance.
 */
import { describe, expect, it } from "vitest";

import { scoreLines } from "../figureScores";

const row = (o: Record<string, string | number | null>) => ({
  figure: "perm.pending", scope: "every open case", as_of: "2026-09-30", unit: "cases", ours: 92931, theirs: 90121,
  tolerance: 901, gap: 2810, gap_pct: 3.12, within: 0, ours_source: "x", theirs_source: "y", theirs_read_on: "2026-11-25",
  note: "n", computed_at: 1, ...o,
});

describe("scoreLines", () => {
  it("names each figure in words, newest day first, with the gap and whether it's inside the tolerance", () => {
    const lines = scoreLines([
      row({}),
      row({ scope: "DOL's apparent scope", ours: 89969, gap: -152, gap_pct: -0.17, within: 1 }),
      row({ figure: "perm.analyst_review_mean_30d", scope: "analyst review decisions", as_of: "2026-10-31", unit: "days",
            ours: 300.8, theirs: 300, tolerance: 3, gap: 0.8, gap_pct: 0.27, within: 1 }),
    ]);
    expect(lines.map((l) => l.title)).toEqual([
      "Days to a decision out of analyst review, last 30 days",
      "PERM cases pending",
      "PERM cases pending",
    ]);
    expect(lines[1]).toMatchObject({ scope: "DOL's apparent scope", within: true, gapText: "-152 cases (-0.17%)" });
    expect(lines[2]).toMatchObject({ within: false, gapText: "+2,810 cases (+3.12%)" });
  });
  it("reads libSQL's string numbers the same as numbers", () => {
    const [l] = scoreLines([row({ ours: "92931", theirs: "90121", gap: "2810", gap_pct: "3.12", within: "0" })]);
    expect(l).toMatchObject({ ours: 92931, theirs: 90121, within: false });
  });
});
