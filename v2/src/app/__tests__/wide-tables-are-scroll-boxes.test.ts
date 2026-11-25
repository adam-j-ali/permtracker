import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A table that scrolls sideways is a `ScrollBox`, links in its rows or not: a link takes focus in its own column,
 * so the columns beside it with no link stay out of a keyboard's reach. The scroll-box scan spares a box whose
 * table holds a control; these wide tables, found by the Nov 9 review, are held to the rule itself.
 */
const WIDE_TABLES = [
  "src/components/activity/DecidedTable.tsx",
  "src/components/activity/ChangeTable.tsx",
  "src/components/entities/EmployerYears.tsx",
  "src/components/data/SevpRowsTable.tsx",
  // The case lists (Nov 11): ten columns beside the rail are wider than most laptop screens.
  "src/components/tools/CaseBrowser.tsx",
  "src/components/tools/LiveCaseBrowser.tsx",
  "src/components/tools/FlagCaseBrowser.tsx",
];

const PLAIN_BOX = /<div\b[^>]*\boverflow-x-auto\b[^>]*>\s*(?:\{\/\*[^*]*\*\/\}\s*)?<table\b/g;

describe("wide tables are scroll boxes", () => {
  it("finds a plain sideways box around a table, comment and all", () => {
    // Arrange, Act, Assert
    expect('<div className="mt-4 overflow-x-auto">\n<table>'.match(PLAIN_BOX)).toHaveLength(1);
    expect('<div className="mt-4 overflow-x-auto">\n  {/* Fixed columns. */}\n  <table>'.match(PLAIN_BOX)).toHaveLength(1);
    expect('<ScrollBox label="Rows" className="mt-4">\n<table>'.match(PLAIN_BOX)).toBeNull();
  });

  it.each(WIDE_TABLES)("%s draws its table in a ScrollBox", (path) => {
    expect(readFileSync(path, "utf8").match(PLAIN_BOX)).toBeNull();
  });
});

/**
 * Any plain sideways box around a table is positioned (`relative`, as ScrollBox is). An absolutely placed element (a
 * cell's sr-only label) belongs to its nearest positioned ancestor, so in an unpositioned box it escapes the box's
 * scroll and widens the page: on Nov 25 2026 /badges ran 271 px past a 390 px phone, hidden only by the body's clip,
 * from the badge table's sr-only labels.
 */
const POSITIONED = /\b(?:relative|absolute|sticky|fixed)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return name.endsWith(".tsx") && !name.includes(".test.") && !name.includes(".stories.") ? [full] : [];
  });
}

function unpositioned(src: string): string[] {
  return [...src.matchAll(PLAIN_BOX)].map((m) => /<div\b[^>]*>/.exec(m[0])![0]).filter((tag) => !POSITIONED.test(tag));
}

describe("a plain sideways box around a table holds what's placed inside it", () => {
  it("tells a positioned box from an unpositioned one", () => {
    expect(unpositioned('<div className="mt-4 overflow-x-auto">\n<table>')).toHaveLength(1);
    expect(unpositioned('<div className="mt-4 relative overflow-x-auto">\n<table>')).toEqual([]);
  });

  it("finds every plain box positioned, across the app", () => {
    const files = sourceFiles(join(__dirname, "..", ".."));
    expect(files.length).toBeGreaterThan(500);
    const offenders = files.flatMap((f) => unpositioned(readFileSync(f, "utf8")).map((tag) => `${f}: ${tag.slice(0, 80)}`));
    expect(offenders).toEqual([]);
  });
});
