import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `fetchQuery` from `convex/nextjs` always fetches with `cache: "no-store"`,
 * which makes a whole route dynamic whatever `revalidate` it exports. On
 * 2026-09-26 one such read turned `/perm-processing-times` from prerendered
 * into a server render per visit, and two calculators had been dynamic in
 * production that way for weeks. Public pages read Convex through
 * `queryStatic` (src/lib/convexStatic.ts), which caches a good read for the page's own window.
 */
const APP = join(__dirname, "..");
const ROOT = join(APP, "(site)", "(public)");

function walk(dir: string, skip: Set<string> = new Set(["__tests__"])): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return skip.has(name) ? [] : walk(p, skip);
    return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

const importsConvexNextjs = (f: string) =>
  /from\s+["']convex\/nextjs["']/.test(readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ""));

describe("public pages read Convex without forcing a dynamic render", () => {
  const files = walk(ROOT);

  it("found the public tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("imports nothing from convex/nextjs", () => {
    expect(files.filter(importsConvexNextjs)).toEqual([]);
  });

  // Cached routes outside the public tree too: /llms.txt rendered on every request until Nov 9 2026. The signed-in
  // app and the API routes are dynamic on purpose.
  it("nor does any cached route elsewhere in the app", () => {
    const outside = walk(APP, new Set(["__tests__", "(public)", "(authenticated)", "api"]));
    expect(outside.some((f) => f.endsWith(join("llms.txt", "route.ts")))).toBe(true);
    expect(outside.filter(importsConvexNextjs).map((f) => f.slice(APP.length + 1))).toEqual([]);
  });
});
