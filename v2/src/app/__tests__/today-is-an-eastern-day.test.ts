import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * "Today" on a public page is the Eastern day (`easternDay` from `@/lib/time`), the day DOL counts in.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which after 8 PM Eastern is already tomorrow: on June 30
 * in the evening the wage tools defaulted to a series DOL hadn't published, and the queue figure and the change feed
 * counted a day ahead. A file name can keep the UTC date; so can the two places listed below, each with its reason.
 */
const ROOTS = ["src/components"];
const UTC_TODAY = /new Date\(\)\.toISOString\(\)\.(?:slice\(0, 10\)|split\("T"\)\[0\])/g;
/** Where the UTC day is the right one, and why. */
const KEEPS_UTC: Record<string, string> = {
  "src/components/figures/rfi-path/RfiFigure.tsx": "dates an RFI as the signed-in case page does, so the two agree",
  "src/components/cases/detail/VerticalTimeline.tsx": "a signed-in case's day follows the app's shared rule, which has its own review",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Each UTC "today" outside a file name, as file:line. */
function utcTodays(path: string, source: string): string[] {
  if (KEEPS_UTC[path]) return [];
  const lines = source.split("\n");
  return [...source.matchAll(UTC_TODAY)]
    .map((m) => source.slice(0, m.index).split("\n").length)
    .filter((n) => !/\bdownload\b|\btimestamp\b|\.json`|\.csv`/.test(lines[n - 1] ?? ""))
    .map((n) => `${path}:${n}`);
}

describe("today is an Eastern day", () => {
  it("finds a UTC today shaped like the wage tools' default series, and spares a file name", () => {
    // Arrange
    const shipped = "const currentSeries = useMemo(() => seriesYearFor(new Date().toISOString().slice(0, 10)), []);";
    const fileName = 'a.download = `perm-tracker-export-${new Date().toISOString().split("T")[0]}.json`;';
    // Act / Assert
    expect(utcTodays("x.tsx", shipped)).toHaveLength(1);
    expect(utcTodays("x.tsx", fileName)).toHaveLength(0);
  });

  it("no component takes today from the UTC date", () => {
    // Arrange
    const all = ROOTS.flatMap(files);
    // Act
    const found = all.flatMap((f) => utcTodays(f, readFileSync(f, "utf8")));
    // Assert
    expect(all.length).toBeGreaterThan(200);
    expect(found).toEqual([]);
  });

  it("each exception still takes the UTC day, so the list can't outlive its reason", () => {
    for (const path of Object.keys(KEEPS_UTC)) {
      expect(readFileSync(path, "utf8")).toMatch(new RegExp(UTC_TODAY.source));
    }
  });
});
