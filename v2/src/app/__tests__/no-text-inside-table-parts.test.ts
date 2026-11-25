import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No text, a glue space included, sits directly inside a table's structure. The site puts {" "} between sibling elements
 * so words never run together (the glued-text rule), but HTML allows no text node as a child of <table>, <thead>,
 * <tbody>, <tfoot> or <tr>: React reports a hydration error and rebuilds the table in the browser. Found Nov 25 2026 on
 * /compare (`</thead>{" "}`), from the dev server's log after a full sweep.
 */
const PARTS = "table|thead|tbody|tfoot|tr|colgroup";
const AFTER_CLOSE = new RegExp(`</(?:thead|tbody|tfoot|caption|colgroup|tr)>\\s*\\{" "\\}\\s*(?=<(?:thead|tbody|tfoot|tr|/(?:${PARTS})>))`, "g");
const AFTER_OPEN = new RegExp(`<(?:${PARTS})\\b[^>]*>\\s*\\{" "\\}`, "g");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return name.endsWith(".tsx") && !name.includes(".test.") && !name.includes(".stories.") ? [full] : [];
  });
}

const offenders = (src: string) => [...(src.match(AFTER_CLOSE) ?? []), ...(src.match(AFTER_OPEN) ?? [])];

describe("no text inside a table's structure", () => {
  it("finds a glue space between table parts, on one line or across lines, and leaves one inside a cell alone", () => {
    expect(offenders('</thead>{" "}\n<tbody>')).toHaveLength(1);
    expect(offenders('</thead>\n            {" "}\n            <tbody>')).toHaveLength(1);
    expect(offenders('<tbody>{" "}<tr>')).toHaveLength(1);
    expect(offenders('<td>{a}{" "}{b}</td>')).toEqual([]);
    expect(offenders('</table>{" "}\n<p>')).toEqual([]);
  });

  it("holds across the app", () => {
    const files = sourceFiles(join(__dirname, "..", ".."));
    expect(files.length).toBeGreaterThan(500);
    const found = files.flatMap((f) => offenders(readFileSync(f, "utf8")).map((m) => `${f}: ${m.replace(/\s+/g, " ").slice(0, 60)}`));
    expect(found).toEqual([]);
  });
});
