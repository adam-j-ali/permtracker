import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A link off the site opens in a new tab, so the reader keeps their place here.
 *
 * Read from the tag: an `<a>` is taken as off-site when its address is a full URL, a SHOUTING_CASE constant (the
 * government sources are kept that way), or when it already carries `rel="noopener"`, which only an off-site link
 * needs. Each of those needs `target="_blank"`.
 */
const ROOTS = ["src/components"];
const ANCHOR = /<a\b[^>]*>/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") && !p.endsWith(".stories.tsx") ? [p] : [];
  });
}

/** Off-site anchors with no new tab, as file:line. */
function sameTab(path: string, source: string): string[] {
  return [...source.matchAll(ANCHOR)]
    .filter((m) => {
      const tag = m[0];
      const offSite = /href=["{]`?https?:/.test(tag) || /href=\{[A-Z][A-Z0-9_]+\}/.test(tag) || /rel="[^"]*noopener/.test(tag);
      return offSite && !/target="_blank"/.test(tag) && !/\{\.\.\./.test(tag);
    })
    .map((m) => `${path}:${source.slice(0, m.index).split("\n").length}`);
}

describe("external links open a new tab", () => {
  it("finds an off-site link with no new tab, shaped like the source lines'", () => {
    // Arrange, Act, Assert
    expect(sameTab("x.tsx", '<a href={DOL_CASE_STATUS_URL} className="link">')).toHaveLength(1);
    expect(sameTab("x.tsx", '<a href={r.sourceUrl} rel="noopener noreferrer" className="link">')).toHaveLength(1);
    expect(sameTab("x.tsx", '<a href={SOURCE} target="_blank" rel="noopener noreferrer" className="link">')).toHaveLength(0);
    expect(sameTab("x.tsx", '<a href="#estimate" className="link">')).toHaveLength(0);
  });

  it("no component opens an off-site link in the same tab", () => {
    // Arrange
    const all = ROOTS.flatMap(files);
    // Act
    const found = all.flatMap((f) => sameTab(f, readFileSync(f, "utf8")));
    // Assert
    expect(all.length).toBeGreaterThan(200);
    expect(found).toEqual([]);
  });
});
