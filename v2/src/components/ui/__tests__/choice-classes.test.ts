import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A choice's extra classes go through `cn(choiceVariants(...), "...")`, never cva's own `className`: cva only
 * appends, so the base `px-4` stayed beside a `px-0` and Tailwind's order kept the padding, squeezing the case list's
 * 24px view icons to 8px wide (found signed in, Nov 17 2026). `cn` merges and drops the loser.
 */
const SRC = join(__dirname, "..", "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("choice classes", () => {
  it("never pass a className into choiceVariants", () => {
    const hits = files(SRC).flatMap((f) => {
      const src = readFileSync(f, "utf8");
      return [...src.matchAll(/choiceVariants\(\{[^}]*\bclassName\s*:/g)].map(() => f.slice(SRC.length + 1));
    });
    expect(hits).toEqual([]);
  });
});
