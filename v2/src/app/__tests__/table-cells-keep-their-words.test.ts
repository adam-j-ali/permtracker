import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A table cell is never allowed to break anywhere.
 *
 * A table sizes each column from its narrowest possible content. A cell that may break between any two letters
 * (`overflow-wrap: anywhere`, `break-all`) reports one letter as that width, so beside cells that can't wrap it is
 * given one letter's room: on a phone, the admin page's alert list printed each address a letter or two a line
 * (Nov 10 2026). A long value in a table gets a real width (a `min-w-` box inside the cell). Rows read on a phone are
 * a list that restacks (`FilingRows`, the admin page's latest alerts), where a grid column keeps the width it's given.
 */

const ROOT = join(process.cwd(), "src");
const BREAKS_ANYWHERE = /<t[dh]\b[^>]*className=(?:"[^"]*|\{[^}]*)(?:overflow-wrap:anywhere|\bbreak-all\b|word-break:break-all)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

describe("table cells keep their words", () => {
  it("the pattern finds the shape it exists to catch, and passes a cell with a real width", () => {
    expect(BREAKS_ANYWHERE.test('<td className="px-3 py-2 [overflow-wrap:anywhere]">')).toBe(true);
    expect(BREAKS_ANYWHERE.test('<td className={cn("px-3", "break-all")}>')).toBe(true);
    expect(BREAKS_ANYWHERE.test('<th className="[word-break:break-all]">')).toBe(true);
    expect(BREAKS_ANYWHERE.test('<td className="px-3 py-2">\n  <span className="block min-w-[14rem] [overflow-wrap:anywhere]">')).toBe(false);
    expect(BREAKS_ANYWHERE.test('<div className="min-w-0 [overflow-wrap:anywhere]">')).toBe(false);
  });

  it("no <td> or <th> may break between any two letters", () => {
    const files = walk(ROOT);
    expect(files.length).toBeGreaterThan(300);
    const found = files
      .filter((f) => BREAKS_ANYWHERE.test(readFileSync(f, "utf8")))
      .map((f) => relative(process.cwd(), f));
    expect(found).toEqual([]);
  });
});
