import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A clock time on the site names its zone: Eastern, the zone DOL and the site count in, as "Nov 9, 7:10 AM EST".
 *
 * A time formatted in the viewer's own zone, with no zone named, reads as Eastern to the owner and to every reader
 * who compares it with DOL's day, and the admin panels' send and sign-in times disagreed with the emails they
 * describe. Any component that formats an hour passes `timeZone`.
 */
const ROOTS = ["src/components"];
const CLOCK_CALL = /\.toLocale(?:Time)?String\(/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Each call that formats an hour with no time zone, as file:line. */
function zonelessClocks(path: string, source: string): string[] {
  return [...source.matchAll(CLOCK_CALL)]
    .filter((m) => {
      const rest = source.slice(m.index, m.index + 400);
      const end = rest.indexOf(";");
      const call = end < 0 ? rest : rest.slice(0, end);
      const formatsHour = /\bhour\s*:/.test(call) || m[0].includes("Time");
      return formatsHour && !/\btimeZone\b/.test(call);
    })
    .map((m) => `${path}:${source.slice(0, m.index).split("\n").length}`);
}

describe("clock times are Eastern", () => {
  it("finds a clock time with no zone, shaped like the admin panels' helper", () => {
    // Arrange
    const shipped = 'const when = (ms: number) =>\n  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });';
    const fixed = 'new Date(ms).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone: EASTERN_TIMEZONE });';
    const dateOnly = 'new Date(ms).toLocaleString("en-US", { month: "short", year: "numeric" });';
    // Act / Assert
    expect(zonelessClocks("x.tsx", shipped)).toHaveLength(1);
    expect(zonelessClocks("x.tsx", fixed)).toHaveLength(0);
    expect(zonelessClocks("x.tsx", dateOnly)).toHaveLength(0);
  });

  it("no component formats a clock time without its zone", () => {
    // Arrange
    const all = ROOTS.flatMap(files);
    // Act
    const found = all.flatMap((f) => zonelessClocks(f, readFileSync(f, "utf8")));
    // Assert
    expect(all.length).toBeGreaterThan(200);
    expect(found).toEqual([]);
  });
});
