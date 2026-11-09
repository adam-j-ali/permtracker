import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A calendar date pinned to noon UTC prints in UTC, or it prints the next day east of UTC+12.
 *
 * `new Date("2026-06-30T12:00:00Z")` is already July 1 in New Zealand's summer (UTC+13), so formatting it in the
 * reader's zone shows the wrong day, and a server render and a browser render of the same page disagree there.
 * Either pass `timeZone: "UTC"` or use the central formatters in `convex/lib/months.ts`, which do no time zone
 * arithmetic at all.
 */
const ROOTS = ["src/components"];
const PINNED = /new Date\(`[^`]*T(?:12|00):00:00(?:\.000)?Z`\)\.toLocale(?:Date|Time)?String\(/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Each pinned date formatted with no time zone, as file:line. */
function localFormats(path: string, source: string): string[] {
  return [...source.matchAll(PINNED)]
    .filter((m) => {
      const rest = source.slice(m.index, m.index + 400);
      const call = rest.slice(0, rest.indexOf(";") < 0 ? rest.length : rest.indexOf(";"));
      return !/\btimeZone\b/.test(call);
    })
    .map((m) => `${path}:${source.slice(0, m.index).split("\n").length}`);
}

describe("noon-UTC dates print their own day", () => {
  it("finds a pinned date formatted in the reader's zone, shaped like the calculators' helper", () => {
    // Arrange
    const shipped = 'const fmt = (iso: string) =>\n  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });';
    const fixed = 'new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {\n  month: "short",\n  ...(y ? { year: "numeric" } : {}),\n  timeZone: "UTC",\n});';
    // Act / Assert
    expect(localFormats("x.tsx", shipped)).toHaveLength(1);
    expect(localFormats("x.tsx", fixed)).toHaveLength(0);
  });

  it("no component formats a pinned date in the reader's zone", () => {
    // Arrange
    const all = ROOTS.flatMap(files);
    // Act
    const found = all.flatMap((f) => localFormats(f, readFileSync(f, "utf8")));
    // Assert
    expect(all.length).toBeGreaterThan(200);
    expect(found).toEqual([]);
  });
});
