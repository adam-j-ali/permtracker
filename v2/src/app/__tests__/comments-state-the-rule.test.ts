import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A comment states the rule. It never names the owner and never quotes a chat: this
 * repository is public, and a decision reads the same without the words it was said in
 * ("the owner's call, Oct 21 2026").
 *
 * Checked over every tracked source folder, in comment lines only, so a variable called
 * `owner` and a string a test types are left alone.
 */

const ROOT = process.cwd();
const FOLDERS = ["src", "convex", "scripts", "extension", "sdk", "workers", "tests", "test-utils"];
const SKIP_DIR = new Set(["node_modules", "_generated", "dist", ".next", "__fixtures__", "fixtures"]);
const SOURCE = /\.(ts|tsx|mts|mjs|js|py|sh|css|conf)$/;

/**
 * Files where the name is the product's own public voice: the founder's note signs with it,
 * and the About page's test reads it.
 */
const NAME_ALLOWED = new Set([
  "convex/lib/congratsNote.ts",
  "convex/lib/congratsNote.test.ts",
  "src/app/(site)/(public)/about/__tests__/about-surfaces.test.ts",
  "src/app/__tests__/comments-state-the-rule.test.ts",
]);

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${name}`;
    const stat = statSync(join(ROOT, path));
    if (stat.isDirectory()) {
      if (!SKIP_DIR.has(name)) yield* files(path);
    } else if (SOURCE.test(name)) {
      yield path;
    }
  }
}

/** A line that is comment text: `//`, `#`, or inside a block comment (tracked across lines). */
function commentLines(text: string): { n: number; line: string }[] {
  const out: { n: number; line: string }[] = [];
  let inBlock = false;
  text.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    const opens = trimmed.includes("/*") || trimmed.startsWith('"""');
    if (inBlock || opens || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) {
      out.push({ n: i + 1, line });
    }
    if (trimmed.includes("/*") && !trimmed.includes("*/")) inBlock = true;
    else if (inBlock && trimmed.includes("*/")) inBlock = false;
  });
  return out;
}

/** "owner, Oct 21 2026: “..." and "the owner: “...": a decision with the chat line it came in. */
const QUOTED_CHAT = /\b(?:owner|owner[’']s call)\b[^"“\n]{0,24}(?:\d{4}|[A-Z][a-z]{2} \d{1,2})?[^"“\n]{0,6}:\s*["“]/;
const NAMED = /\bAdam\b/;

describe("comments state the rule", () => {
  const found: string[] = [];
  for (const folder of FOLDERS) {
    for (const path of files(folder)) {
      const lines = commentLines(readFileSync(join(ROOT, path), "utf8"));
      for (const { n, line } of lines) {
        if (NAMED.test(line) && !NAME_ALLOWED.has(path)) found.push(`${path}:${n} names the owner`);
        if (QUOTED_CHAT.test(line) && !NAME_ALLOWED.has(path)) found.push(`${path}:${n} quotes a chat`);
      }
    }
  }

  it("no comment names the owner or quotes a chat", () => {
    expect(found).toEqual([]);
  });

  it("would catch the shapes it's for, and leaves ordinary comments alone", () => {
    for (const bad of [
      '// Fifty rows a page (owner, Oct 21 2026: "pagination not endless scroll").',
      ' * to stay inside it. The owner\'s call (Oct 12 2026): "if we ever pay for',
      '     faded with it; the owner: "no structure or lines".',
    ]) {
      expect(QUOTED_CHAT.test(bad), bad).toBe(true);
    }
    expect(NAMED.test(" * Adam asked for one blended number")).toBe(true);
    for (const fine of [
      "// Fifty rows a page (the owner's call, Oct 21 2026).",
      ' * The owner\'s word on a sender, from the admin page: "allow" when a held message',
      '// the owner types "Not spam" on the admin page',
    ]) {
      expect(QUOTED_CHAT.test(fine), fine).toBe(false);
    }
  });
});
