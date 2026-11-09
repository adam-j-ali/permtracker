import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A link or button stretched over its card or row (`after:absolute after:inset-0`) shows where keyboard focus is.
 *
 * The stretched target turns its own outline off, since an outline round a truncated name would look broken, so
 * something else has to show focus (WCAG 2.4.7). A background change from the card's tint to white measured about
 * 1.1:1 and can't be seen, so the replacement is a ring drawn on the stretched area itself.
 */
const ROOTS = ["src/components", "src/app"];
const CLASS_STRING = /"[^"\n]*"|`[^`\n]*`/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") && !p.endsWith(".stories.tsx") ? [p] : [];
  });
}

/** Class strings that stretch a target, turn its outline off and put nothing in its place. */
function unseenFocus(path: string, source: string): string[] {
  return [...source.matchAll(CLASS_STRING)]
    .filter((m) => /\bafter:inset-0\b/.test(m[0]) && /\bfocus-visible:outline-none\b/.test(m[0]))
    .filter((m) => !/\bfocus-visible:after:ring-\d/.test(m[0]))
    .map((m) => `${path}:${source.slice(0, m.index).split("\n").length}`);
}

describe("stretched targets show keyboard focus", () => {
  it("finds a stretched link with its outline off and no ring, shaped like the case card's", () => {
    // Arrange
    const shipped = `<Link href={\`/cases/\${c._id}\`} className="after:absolute after:inset-0 hover:text-primary-text focus-visible:outline-none">`;
    const fixed = `<Link className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">`;
    // Act / Assert
    expect(unseenFocus("x.tsx", shipped)).toHaveLength(1);
    expect(unseenFocus("x.tsx", fixed)).toHaveLength(0);
  });

  it("no stretched target hides its focus", () => {
    // Arrange
    const all = ROOTS.flatMap(files);
    // Act
    const found = all.flatMap((f) => unseenFocus(f, readFileSync(f, "utf8")));
    // Assert
    expect(all.length).toBeGreaterThan(300);
    expect(found).toEqual([]);
  });
});
