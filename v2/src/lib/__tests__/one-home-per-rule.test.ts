import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * One home per rule: each rule below has its module in each language, and nothing else in src/, convex/ or scripts/
 * computes it again. A second copy drifts (the Wilson interval was typed four times, the day difference over forty),
 * so each rule is a pattern that finds a copy, a probe that proves the pattern finds the shape that shipped, and a
 * scan of the tree that must come back empty.
 */

const ROOTS = ["src", "convex", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "_generated", ".next", "__pycache__"]);
const THIS_FILE = "src/lib/__tests__/one-home-per-rule.test.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : files(p);
    return /\.(ts|tsx|mjs|py)$/.test(name) ? [p] : [];
  });
}

interface Rule {
  name: string;
  /** The module(s) that hold the rule. */
  homes: readonly string[];
  /** Lines that compute the rule again. */
  copy: RegExp;
  /** A line shaped like a copy that shipped, which the pattern must find. */
  probe: string;
  /** A line that only looks similar, which the pattern must pass. */
  spare: string;
}

const RULES: readonly Rule[] = [
  {
    name: "the Wilson interval",
    homes: ["convex/lib/wilson.ts", "scripts/lib_wilson.py"],
    // The interval's square root over p(1 - p), in either language, and any function named for it. A plain
    // plus-or-minus has the same root, so a hand-made margin is caught too.
    copy: /sqrt\(.*\b1 - p\b|\b(?:function|def)\s+wilson|\bconst\s+wilson\w*\s*=\s*\(|1\.959963/i,
    probe: "  const half = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / denom;",
    spare: "  const share = certified / decided; // 1.96M rows read",
  },
];

/** Each line of a file that computes a rule outside its homes, as file:line. */
function copiesOf(rule: Rule, path: string, source: string): string[] {
  if (rule.homes.includes(path) || path === THIS_FILE) return [];
  return source
    .split("\n")
    .flatMap((line, i) => (rule.copy.test(line) ? [`${path}:${i + 1}`] : []));
}

describe("one home per rule", () => {
  const all = ROOTS.flatMap(files);

  it("reads the whole tree", () => {
    expect(all.length).toBeGreaterThan(2000);
  });

  describe.each(RULES)("$name", (rule) => {
    it("finds a copy shaped like one that shipped, and spares a line that only looks like one", () => {
      expect(copiesOf(rule, "x.ts", rule.probe)).toEqual(["x.ts:1"]);
      expect(copiesOf(rule, "x.ts", rule.spare)).toEqual([]);
    });

    it("has its homes", () => {
      for (const home of rule.homes) expect(statSync(home).isFile()).toBe(true);
    });

    it("is computed nowhere else", () => {
      const found = all.flatMap((f) => copiesOf(rule, f, readFileSync(f, "utf8")));
      expect(found).toEqual([]);
    });
  });
});
