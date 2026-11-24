import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The data pages end on the reader's own next step, as the employer page does, and an empty USCIS quarterly page
 * shows the shared empty box. The pages are async server components over many reads, so their order is held here
 * in the source.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** The source of a page's default export, from its signature to the end of the file. */
function pageOf(rel: string): string {
  const src = read(rel);
  const at = src.indexOf("export default");
  expect(at, rel).toBeGreaterThan(-1);
  return src.slice(at);
}

describe.each([
  ["/perm-queue", "src/app/(site)/(public)/perm-queue/page.tsx", "perm-queue-end"],
  ["/perm-by-the-numbers", "src/app/(site)/(public)/perm-by-the-numbers/page.tsx", "by-the-numbers-end"],
])("%s", (_path, rel, source) => {
  it("ends on the case box, after its sources", () => {
    const page = pageOf(rel);
    // The default export's own JSX ends where its first top-level helper starts.
    const body = page.slice(0, page.search(/\n}\n/));
    const box = body.lastIndexOf("<CaseNextStep");
    expect(box).toBeGreaterThan(body.lastIndexOf("<DataProvenance"));
    expect(body.slice(box)).toContain(`source="${source}"`);
  });
});

describe("/visa-bulletin", () => {
  const page = pageOf("src/app/(site)/(public)/visa-bulletin/page.tsx");

  it("keeps what the bulletin did and when the next comes out open, and folds the year's limits", () => {
    const did = page.indexOf("What the {monthLabel(last.bulletinMonth)} bulletin did");
    const release = page.indexOf('id="bulletin-release"');
    const fold = page.indexOf("<ChapterFold\n          summary={`The spillover for fiscal year ${spill.fiscalYear}`}");
    for (const [name, at] of Object.entries({ did, release, fold })) expect(at, name).toBeGreaterThan(-1);
    expect(did).toBeLessThan(release);
    expect(release).toBeLessThan(fold);
    // The spillover's table sits inside the fold.
    expect(page.indexOf('label="The spillover by category"')).toBeGreaterThan(fold);
    expect(page.indexOf('label="The spillover by category"')).toBeLessThan(page.indexOf("</ChapterFold>"));
  });
});

describe("a consulate's page", () => {
  const src = read("src/app/(site)/(public)/consular-posts/[post]/page.tsx");

  it("opens on three figures, one per immigrant visa category", () => {
    expect(read("src/lib/consular/scheduling.ts")).toMatch(/IV_CATEGORIES: readonly IvCategory\[\] = \["employment", "family", "immediate"\]/);
    expect(src).toMatch(/<FigureRow className="mt-8">\s*\{IV_CATEGORIES\.map/);
  });

  it("says what will show where State or the embassy has nothing, never a bare grey line", () => {
    expect(src).toMatch(/\) : \(\s*<EmptyState\s+title="Its scheduling months will show here"/);
    expect(src).toMatch(/\) : \(\s*<EmptyState title="Its notices will list here" heading="h3"/);
    expect(src).not.toMatch(/<p className="mt-\d+[^"]*text-muted-foreground">\s*State&apos;s scheduling table doesn&apos;t list/);
  });
});

describe("an empty USCIS quarterly page", () => {
  it("is the shared empty box, never a grey paragraph", () => {
    const src = read("src/components/data/BarRows.tsx");
    const fn = src.slice(src.indexOf("export function QuarterlyEmpty"));
    expect(fn).toMatch(/return \(\s*<EmptyState title="USCIS's quarterly figures will show here"/);
    expect(fn).not.toContain("bg-sage");
  });
});
