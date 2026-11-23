import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RIVALS } from "@/lib/compare/rivals";

/**
 * Other trackers are named on /compare only; everywhere else, in pages, articles, comments, scripts and tests, they're
 * "a third party". The names come from /compare's own list, so a tracker added there is held here the same day.
 * Whole words, case as the tracker writes it, so our own title "PERM Timeline and Deadline Calculators" is listed
 * below by file, with its reason, rather than hidden by a loose match.
 */

const ROOT = process.cwd();
const FOLDERS = ["src", "convex", "scripts", "content", "public", "extension", "sdk", "workers", "tests", "test-utils", "docs"];
const SKIP_DIR = new Set(["node_modules", "_generated", "dist", ".next", "notes"]);
const TEXT = /\.(ts|tsx|mts|mjs|js|py|sh|mdx|md|json|txt|yml|yaml|html|css)$/;
/** /compare itself, where every tracker is named and checked. */
const COMPARE = ["src/lib/compare/", "src/app/(site)/(public)/compare/"];
/** Our own words that happen to be a tracker's name, each with why it stays. */
const OUR_OWN: Record<string, string[]> = {
  // The searched phrase, as the page's own title.
  "src/app/(site)/(public)/calculators/page.tsx": ["PERM Timeline"],
  "src/app/(site)/(public)/tools/perm-timeline-calculator/page.tsx": ["PERM Timeline"],
  // "Today's PERM Update": the daily page's own title.
  "src/app/(site)/(public)/today/page.tsx": ["PERM Update"],
  "src/app/__tests__/rivals-named-on-compare-only.test.ts": [],
};

function* files(dir: string): Generator<string> {
  let names: string[];
  try {
    names = readdirSync(join(ROOT, dir));
  } catch {
    return;
  }
  for (const name of names) {
    const path = `${dir}/${name}`;
    const stat = statSync(join(ROOT, path));
    if (stat.isDirectory()) {
      if (!SKIP_DIR.has(name)) yield* files(path);
    } else if (TEXT.test(name) && stat.size < 2_000_000) {
      yield path;
    }
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAMES = RIVALS.map((r) => r.name);
const NAMED = new RegExp(`\\b(?:${NAMES.map(escape).join("|")})\\b`, "g");

describe("other trackers are named on /compare only", () => {
  it("reads the names from /compare's list", () => {
    expect(NAMES.length).toBeGreaterThan(5);
  });

  it("names none of them anywhere else", () => {
    const found: string[] = [];
    for (const folder of FOLDERS) {
      for (const path of files(folder)) {
        if (COMPARE.some((c) => path.startsWith(c))) continue;
        const text = readFileSync(join(ROOT, path), "utf8");
        const allowed = OUR_OWN[path] ?? [];
        if (path === "src/app/__tests__/rivals-named-on-compare-only.test.ts") continue;
        for (const m of text.matchAll(NAMED)) {
          if (!allowed.includes(m[0])) found.push(`${path}: ${m[0]}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("would catch a name in a comment, and leaves a lowercase word alone", () => {
    const name = NAMES[0]!;
    expect(`// as ${name} does`.match(NAMED)).not.toBeNull();
    expect("the bulletin's monthly update and its timeline".match(NAMED)).toBeNull();
  });
});
