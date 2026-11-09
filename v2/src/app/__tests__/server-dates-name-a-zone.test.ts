import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A date a server page formats with Intl names its time zone. Without one it takes the server's own zone, so the
 * same page prints a different day on a machine in another zone, or after a move. A calendar day goes through the
 * string formatters (formatAsOf, longDate), which do no zone arithmetic; an instant goes through the Eastern helpers
 * (easternDay in convex/lib/time.ts).
 */
const V2 = join(__dirname, "..", "..", "..");
const CALL = /\.(?:toLocaleDateString|toLocaleTimeString)\(|new Intl\.DateTimeFormat\(/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p);
    return /\.tsx?$/.test(name) && !/\.(test|stories)\./.test(name) ? [p] : [];
  });
}

/** Each date-formatting call in a source whose arguments name no time zone, as "line: call". */
function zoneless(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(CALL)) {
    let i = (m.index ?? 0) + m[0].length;
    let depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") depth -= 1;
      i += 1;
    }
    if (!src.slice(start, i - 1).includes("timeZone")) out.push(`${src.slice(0, m.index).split("\n").length}: ${m[0]}`);
  }
  return out;
}

describe("a server page's dates name their time zone", () => {
  const files = walk(join(V2, "src", "app")).filter((f) => !/^\s*["']use client["']/.test(readFileSync(f, "utf8")));

  it("sees the tree it guards", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("catches a call without a zone, and passes one with it", () => {
    expect(zoneless(`d.toLocaleDateString("en-US", { month: "long" })`)).toHaveLength(1);
    expect(zoneless(`new Intl.DateTimeFormat("en-US", {\n  month: "long",\n})`)).toHaveLength(1);
    expect(zoneless(`d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })`)).toEqual([]);
    expect(zoneless(`d.toLocaleDateString("en-US", {\n  timeZone: EASTERN_TIMEZONE,\n  month: f(x),\n})`)).toEqual([]);
    expect(zoneless(`n.toLocaleString("en-US")`)).toEqual([]);
  });

  it("has none without one", () => {
    const found = files.flatMap((f) => zoneless(readFileSync(f, "utf8")).map((hit) => `${relative(V2, f)}:${hit}`));
    expect(found).toEqual([]);
  });
});
