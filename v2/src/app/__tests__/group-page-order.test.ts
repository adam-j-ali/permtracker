import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The order of a city's, an industry's and a country's page (one template, components/groups): the employer page's
 * pattern. The name and its answer line, the case box first on a phone, three figures, then who files here and for
 * what, the years, the rest folded, and the page ends on the case box. Nothing a reader used was removed: the fourth
 * figure (the span of years) is the decisions' note and the answer line, and the long lists fold.
 * The page is an async server component over several reads, so its order is held here in the source.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const PAGES = read("src/components/groups/GroupPages.tsx");
const VIEW = read("src/components/groups/GroupView.tsx");

/** The published detail page: from its PERM branch on (the H-1B-only city comes before). */
function detailPage(): string {
  const from = PAGES.indexOf("const c = COPY[kind];\n  const [years, h1b, freshness]");
  expect(from, "the detail page's PERM branch").toBeGreaterThan(-1);
  return PAGES.slice(from, PAGES.indexOf("\n}\n", from));
}

function positions(src: string, marks: string[]): number[] {
  return marks.map((m) => {
    const at = src.indexOf(m);
    expect(at, `not found: ${m}`).toBeGreaterThan(-1);
    return at;
  });
}

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);

describe("a city's, an industry's or a country's page", () => {
  it("opens on the name, its answer line, the case box, and three figures", () => {
    const src = detailPage();
    expect(increasing(positions(src, ["<ProfileHeader", "answer={groupAnswer(", "<CaseNextStep", "<EntityStatCards"]))).toBe(true);
    expect(src).toContain('aria-label="Its record in three figures"');
    expect(src).toContain("groupFigures(g, series, partialFy)");
    // The old fourth figure (the years) and the grey tiles are gone from the view.
    expect(VIEW).not.toContain('["Years",');
    expect(VIEW).not.toMatch(/bg-sage p-4 border-2/);
  });

  it("runs who files, the years, then the rest folded, and ends on the case box", () => {
    const src = detailPage();
    expect(increasing(positions(src, ["<ProfileHeader", "<GroupView", "<CityReference", 'summary="Its H-1B record"', "<DataProvenance"]))).toBe(true);
    expect(src.lastIndexOf("<CaseNextStep")).toBeGreaterThan(src.indexOf("<DataProvenance"));
    expect(src).toMatch(/source=\{`\$\{kind\}-page-end`\}/);
    const view = VIEW.slice(VIEW.indexOf("export function GroupView("));
    expect(increasing(positions(view, ['<Chapter id="who"', '<Chapter id="years"', '<ChapterFold summary="More of the record"']))).toBe(true);
  });

  it("keeps the sponsors and the jobs open, and folds every other list", () => {
    const view = VIEW.slice(VIEW.indexOf("export function GroupView("));
    for (const open of ['title="Top sponsors"', 'title="Top occupations"']) {
      const at = view.indexOf(open);
      expect(view.lastIndexOf("lead.push(", at), open).toBeGreaterThan(view.lastIndexOf("more.push(", at));
    }
    for (const folded of [
      'title="Worksite states"',
      'title="Worksite cities"',
      'title="Industries"',
      'title="Countries of citizenship"',
      "title=\"Worker's education\"",
      'title="Visa held when filed"',
    ]) {
      const at = view.indexOf(folded);
      expect(at, folded).toBeGreaterThan(-1);
      expect(view.lastIndexOf("more.push(", at), folded).toBeGreaterThan(view.lastIndexOf("lead.push(", at));
    }
  });

  it("says what will appear on an empty index, and offers the next step", () => {
    const index = PAGES.slice(PAGES.indexOf("export async function GroupIndexPage"), PAGES.indexOf("async function h1bOnlyCity"));
    expect(index).toMatch(/rows\.length === 0 \? \(\s*<EmptyState/);
    expect(index).toContain('action={{ href: "/case-search"');
  });
});
