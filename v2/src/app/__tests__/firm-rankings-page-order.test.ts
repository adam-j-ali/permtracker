import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The order of /law-firm-rankings and each state's: the title and its answer line (the busiest firm for each
 * program), the way to another state one press away, then each program's three figures, its split, its bars and the
 * rest folded. Nothing a reader used was removed: the busiest firm moved from a lime figure into the answer line, and
 * the state list moved up from the foot of the page into a fold.
 */
const SRC = readFileSync(join(process.cwd(), "src/components/firms/FirmRankingsPage.tsx"), "utf8");

function positions(src: string, marks: string[]): number[] {
  return marks.map((m) => {
    const at = src.indexOf(m);
    expect(at, `not found: ${m}`).toBeGreaterThan(-1);
    return at;
  });
}

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);

describe("the law firm rankings page", () => {
  const page = SRC.slice(SRC.indexOf("export async function FirmRankingsPage"));
  const ranking = SRC.slice(SRC.indexOf("async function Ranking("), SRC.indexOf("export async function FirmRankingsPage"));

  it("opens on the title, the answer line, and the way to another state, before the rankings", () => {
    expect(
      increasing(positions(page, ["<h1", "{answer ?", "<ChapterFold", 'aria-label="Rankings by state"', '<Ranking program="perm"', '<Ranking program="lca"']))
    ).toBe(true);
    expect(page).toContain("firmRanksAnswer(state, permLead, lcaLead)");
  });

  it("gives each program three figures, none of them lime", () => {
    const row = ranking.slice(ranking.indexOf("<FigureRow>"), ranking.indexOf("</FigureRow>"));
    expect(row.match(/<Figure\b/g)).toHaveLength(3);
    expect(row).not.toContain('tone="lime"');
  });

  it("shows the bars open and the long tail folded", () => {
    expect(increasing(positions(ranking, ["<FigureRow>", "<Split", "<BarRows", "<FinePrint summary={`Ranks"]))).toBe(true);
  });

  it("says what will show when a ranking is empty, and offers the next step", () => {
    expect(ranking).toMatch(/list\.length === 0\) \{\s*return \(\s*<PageSection[^>]*>\s*<EmptyState/);
    expect(page).toMatch(/\) : \(\s*<EmptyState\s+title="The rankings will show here"/);
  });
});
