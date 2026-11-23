import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The order of the employer, law firm and job pages (owner, Nov 23 2026: "ours has a lot but not super organized
 * easy to see, confusing overwhelming disorienting"). Nothing a reader used was removed: each part moved or folded.
 * The pages are async server components over a dozen reads, so their order is held here in the source, the way the
 * warning-above-the-figures rule is (EntityContext.test.tsx).
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const EMPLOYER = "src/app/(site)/(public)/perm-employers/[slug]/page.tsx";

/** The published employer page: from its default export on (the live-only and other-employer pages come before). */
function employerPage(): string {
  const src = read(EMPLOYER);
  return src.slice(src.indexOf("const row = found.subject;\n  // Every read below keys on the SURVIVING slug"));
}

/** Where each of `marks` first appears after `from`, failing on any that's missing. */
function positions(src: string, marks: string[]): number[] {
  return marks.map((m) => {
    const at = src.indexOf(m);
    expect(at, `not found: ${m}`).toBeGreaterThan(-1);
    return at;
  });
}

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);

/** The text from `start` to the end of the first `<Chapter` or `<ChapterFold` element that follows `start`. */
function block(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a);
  expect(b, `not found after ${start}: ${end}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe("the employer page", () => {
  it("opens on the name, its answer line, the case box, and three figures", () => {
    const src = employerPage();
    expect(increasing(positions(src, ["<ProfileHeader", "answer={profileLine(", "<CaseNextStep", "<EntityStatCards"]))).toBe(true);
    const figures = block(src, "<EntityStatCards", "/>\n            </section>");
    expect(figures.match(/Card\(/g)).toHaveLength(3);
    expect(figures).toMatch(/volumeCard\("Filings"/);
    expect(figures).toMatch(/approvalCard\(reliability, baselineDenialPct, row\)/);
    expect(figures).toMatch(/medianDaysCard\(/);
    expect(src).toContain('aria-label="Its record in three figures"');
  });

  it("runs its chapters in the order the reader needs them, and ends on the case box", () => {
    const src = employerPage();
    const order = [
      '<Chapter id="now"',
      'id="where"',
      '<Chapter id="wait"',
      'id="work"',
      '<Chapter id="programs"',
      'id="compare"',
      'id="records"',
      '<Chapter id="history"',
      '<Chapter id="notes"',
    ];
    expect(increasing(positions(src, order))).toBe(true);
    // The case box is the last thing, after the notes.
    expect(src.lastIndexOf("<CaseNextStep")).toBeGreaterThan(src.indexOf('<Chapter id="notes"'));
    // The bar names eight parts at most; the notes are reached at the page's foot.
    const bar = block(src, "const chapters: ChapterItem[] = [", "];");
    expect(bar.match(/id: "/g)).toHaveLength(8);
    expect(bar).not.toContain('"notes"');
  });

  it("keeps the queue, the newest filings and the follow form in Right now, and moves the layoff notices to Records", () => {
    const src = employerPage();
    const now = block(src, '<Chapter id="now"', "</Chapter>");
    expect(increasing(positions(now, ["<LiveQueueBand", "Its newest filings", "<EmployerFollow"]))).toBe(true);
    expect(now).toMatch(/<LiveQueueBand[^>]*compact/);
    expect(now).not.toContain("<WarnNoticeBand");
    const records = block(src, 'id="records"', "</Chapter>");
    expect(records).toContain("<WarnNoticeBand");
  });

  it("draws the state map in Where, only when the facet holds every state and two or more are named", () => {
    const src = employerPage();
    const where = block(src, 'id="where"', "</Chapter>");
    expect(where).toContain("{showMap ? <EntityStateMap");
    expect(where).toContain("<PlaceMix");
    expect(src).toMatch(/canDrawStateMap\(e\.states, true\)/);
    expect(src).toMatch(/coverage\.current \?/);
    // On a withheld employer's neutral page a state leads nowhere: its search is by no name.
    expect(src).toMatch(/\.\.\.\(byName\s*\?\s*\{ href: caseSearchHref\(\{ q: row\.name, state: s\.state \}\)/);
  });

  it("folds what a first visit needn't read, and leaves the rest open", () => {
    const src = employerPage();
    const work = block(src, 'id="work"', "</Chapter>");
    expect(work).toMatch(/<ChapterFold summary="Search their filings by job, state or program">\s*<FilingsSearch/);
    const programs = block(src, '<Chapter id="programs"', "</Chapter>");
    expect(programs.indexOf("<EmployerPrograms")).toBeLessThan(programs.indexOf("<ChapterFold"));
    expect(programs.indexOf("<StartYears")).toBeLessThan(programs.indexOf("<ChapterFold"));
    expect(programs.indexOf("<WageAndLcaFilings")).toBeGreaterThan(programs.indexOf("<ChapterFold"));
    const compare = block(src, 'id="compare"', "</Chapter>");
    expect(compare.indexOf("<FieldPositionPlate")).toBeLessThan(compare.indexOf("<ChapterFold"));
    expect(compare.indexOf("<PeerList")).toBeGreaterThan(compare.indexOf("<ChapterFold"));
    const history = block(src, '<Chapter id="history"', "</Chapter>");
    expect(history).toMatch(/<EmployerYears[\s\S]*?show="chart"/);
    expect(history.indexOf('show="chart"')).toBeLessThan(history.indexOf("<ChapterFold"));
    for (const part of ['show="cases"', "<LcaYears", "<HistoryMakeup", "<WorkerMix"]) {
      expect(history.indexOf(part), part).toBeGreaterThan(history.indexOf("<ChapterFold"));
    }
  });

  it("moves the median wage into The work rather than dropping it", () => {
    const src = employerPage();
    expect(block(src, 'id="work"', "</Chapter>")).toMatch(/formatDollars\(medianWage\)/);
    expect(src).not.toMatch(/medianWageCard\(/);
  });
});
