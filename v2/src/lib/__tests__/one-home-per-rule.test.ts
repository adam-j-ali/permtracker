import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

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
  /** Code shaped like a copy that shipped, which the pattern must find once. */
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
  {
    name: "the day difference",
    homes: ["convex/lib/time.ts", "scripts/lib_days.py"],
    // Two parsed days subtracted (on one line or split over several), a parsed day divided by a day's milliseconds
    // (a day number), or a helper named for either. Elapsed time from an instant (Date.now() less a stamp) is a
    // different measure and isn't matched.
    copy: /(?:Date\.parse|Date\.UTC)\([^;]*?\)\s*\)?\s*-\s*(?:Date\.parse|Date\.UTC)\(|Date\.parse\([^;()]*\)\s*\/\s*\(?(?:MS_PER_DAY|86_?400_?000|DAY_MS)\b|\b(?:function|const)\s+(?:daysBetween|daysFrom|dayNum|dayNumber|dayIndex)\b|\bdef\s+days_between\b/,
    probe: `  const span = Math.round(
    (Date.parse(\`\${to}T12:00:00Z\`) -
      Date.parse(\`\${from}T12:00:00Z\`)) /
      MS_PER_DAY,
  );`,
    spare: "  const age = Math.floor((Date.now() - row.computedAt) / MS_PER_DAY);",
  },
  {
    name: "a new figure's floor words and margin words",
    homes: ["src/lib/floors.ts", "scripts/lib_floors.py"],
    // The words live in scripts/data/floors.json; a margin or a "not enough yet" sentence put together in code is a
    // second copy of them.
    copy: /give or take (?:\$\{|\{)|f"give or take|Not enough [^"`\n]*yet to give/,
    probe: "  const said = `give or take ${margin.toFixed(1)} points`;",
    spare: "# Filed within two weeks of the quiet period's end: as soon as the rules allow, give or take.",
  },
  {
    name: "the approval and denial rate",
    homes: ["convex/lib/approval.ts", "scripts/lib_shares.py"],
    // A certified, approved or denied count divided by the decisions (a variable named for them, or certified plus
    // denied written out) or by every outcome (a total). Comment lines and an API field's description state the rule in
    // words and are passed.
    copy: /^(?![^\n]*\.describe\()(?![ \t]*(?:\/\*|\*|\/\/|#))[^\n]*?[\w.]*(?:[cC]ertified|[aA]pproved|[dD]enied)\w*[ \t]*\/[ \t]*\(?[ \t]*(?:\w*decided\w*\b|[\w.]*(?:[cC]ertified|[aA]pproved)\w*[ \t]*\+[ \t]*[\w.]*denied\b|[\w.]*(?:[tT]otal|[oO]utcomes)\b)/m,
    probe: "  return decided > 0 ? t.approved / decided : null;",
    spare: [
      "                  const width = (decided / maxDecided) * 100;",
      " * denied / (approved + denied). A rate over receipts drifts with the backlog",
      '  certifiedShare: z.number().nullable().describe("certified / (certified + denied), from 0 to 1."),',
      "  return { decided: moves, grantedShare: granted / moves };",
      "    /** certified / (certified + denied), or null under the floor. */",
    ].join("\n"),
  },
  {
    name: "a day on the reader's own calendar",
    // Nine calculators and the case import each typed this (Nov 25 2026); one more copy is how a fix reaches eight.
    homes: ["src/lib/readerToday.ts"],
    copy: /getFullYear\(\)\}-\$\{String\(\w+\.getMonth\(\) \+ 1\)/,
    probe: '  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;',
    spare: "  const year = d.getUTCFullYear(); // a UTC day, the server's count",
  },
  {
    name: "a PERM case's decision estimate, assembled",
    // Each assembler passes every input (stragglers, the measured range, the stage figures, the RFI clock); one that
    // left five out quoted employer pages a different range than the case page gave a case filed the same day
    // (Nov 25 2026). A new surface calls estimatePermCase (src/lib/db/permEstimate.ts) instead of a sixth assembler.
    homes: [
      "src/lib/caseEstimate.ts",
      "src/lib/db/permEstimate.ts",
      "src/components/tools/CaseStatusResult.tsx",
      "src/components/tools/CaseEstimate.tsx",
      "src/lib/appCaseEstimate.ts",
      "src/lib/__tests__/caseEstimate.test.ts",
    ],
    copy: /\bbuildCaseEstimate\(/,
    probe: "  const est = buildCaseEstimate({ filingDate: today, status: \"ANALYST REVIEW\", isFinal: false, estimator, today });",
    spare: 'import { buildCaseEstimate, type CaseEstimate } from "@/lib/caseEstimate";',
  },
];

/** Where a file computes a rule outside its homes, as file:line (a copy may run over several lines). */
function copiesOf(rule: Rule, path: string, source: string): string[] {
  if (rule.homes.includes(path) || path === THIS_FILE) return [];
  const all = new RegExp(rule.copy.source, `${rule.copy.flags}g`);
  return [...source.matchAll(all)].map((m) => `${path}:${source.slice(0, m.index).split("\n").length}`);
}

describe("one home per rule", () => {
  const all = ROOTS.flatMap(files);
  // Read once for every rule: the tree is a few thousand files, and three reads of it ran past the default timeout.
  let sources: readonly (readonly [string, string])[] = [];
  beforeAll(() => {
    sources = all.map((f) => [f, readFileSync(f, "utf8")] as const);
  }, 60_000);

  it("reads the whole tree", () => {
    expect(all.length).toBeGreaterThan(2000);
    expect(sources).toHaveLength(all.length);
  });

  describe.each(RULES)("$name", (rule) => {
    it("finds a copy shaped like one that shipped, and spares a line that only looks like one", () => {
      expect(copiesOf(rule, "x.ts", rule.probe)).toHaveLength(1);
      expect(copiesOf(rule, "x.ts", rule.spare)).toEqual([]);
    });

    it("has its homes", () => {
      for (const home of rule.homes) expect(statSync(home).isFile()).toBe(true);
    });

    it("is computed nowhere else", () => {
      const found = sources.flatMap(([f, source]) => copiesOf(rule, f, source));
      expect(found).toEqual([]);
    }, 30_000);
  });
});
