import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A link that stands alone on its own line is a tap target, and on a phone it gets the site's 44px floor. Seven
 * kinds of such link were 17 to 42px tall on a phone (Nov 12 2026): a job's name in a company's list of jobs, an
 * employer's name above its bar on the H-1B ranking, a milestone's link on the About page, a program's name on the
 * case search, a status name on the RFI page, an employer's name on the under-review page, and every name in a
 * city's ranked lists. Each sat inside a list item, which the phone sweep read as "in a sentence".
 */
const SRC = join(__dirname, "..", "..");
const FLOOR = ["max-sm:inline-flex", "max-sm:min-h-11", "max-sm:items-center"];
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/** The className of the link that follows `anchor` in the source. */
function linkClassAfter(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const m = /className=(?:"([^"]+)"|\{`([^`]+)`\})/.exec(src.slice(at));
  return m?.[1] ?? m?.[2] ?? "";
}

describe("a link alone on its line has the phone tap floor", () => {
  it.each([
    ["a job's name in a company's list of jobs", "components/entities/FilingMakeup.tsx", 'href={entityHref("occupation", r.key)}'],
    ["an employer's name on the H-1B ranking", "components/h1b/H1bEmployerRanks.tsx", 'href={entityHref("employer", r.slug)}'],
    ["a milestone's link on the About page", "app/(site)/(public)/about/page.tsx", "<Link href={m.href}"],
    ["a program's name on the case search", "components/data/RecordShares.tsx", "href={r.href}"],
    ["a status name on the RFI page", "components/rfi/StageCensus.tsx", "href={`/perm-rfi-audit/${stageSlug(stage.status)}`}"],
  ])("%s", (_what, path, anchor) => {
    const cls = linkClassAfter(read(path), anchor);
    for (const c of FLOOR) expect(cls, `${path}: ${cls}`).toContain(c);
  });

  // A name above a line of its own (the under-review list) reaches 44px by 12px of padding above and below, taken back
  // off as margin: a one-line name then sits as close to the line under it as a two-line name does.
  it("an employer's name on the under-review page", () => {
    const src = read("app/(site)/(public)/perm-employers/under-review/page.tsx");
    // The end of the name's wrapper, so the next className is the link's own.
    const cls = linkClassAfter(src, 'font-bold [overflow-wrap:anywhere]">');
    for (const c of ["link", "max-sm:block", "max-sm:py-3", "max-sm:-my-3"]) expect(cls.split(" "), cls).toContain(c);
  });

  // A ranked list holds forty names on a city's page, so its links reach 44px the same way, and the row keeps its
  // height.
  it("every name in a ranked list on a city, state, industry or country page", () => {
    const src = read("components/groups/GroupView.tsx");
    const cls = /const RANKED_LINK = "([^"]+)"/.exec(src)?.[1] ?? "";
    for (const c of ["link", "max-sm:py-3", "max-sm:-my-3"]) expect(cls.split(" "), cls).toContain(c);
    // No ranked link is left on the bare style, and the clip sits on the name itself, never around its tap box.
    expect(src).not.toContain('className="link"');
    expect(src.match(/className=\{RANKED_LINK\}/g)?.length).toBe(5);
    expect(src).toContain("[&>*]:block [&>*]:truncate");
    expect(src).toContain('typeof it.label === "string" ? <span>{it.label}</span> : it.label');
  });
});
