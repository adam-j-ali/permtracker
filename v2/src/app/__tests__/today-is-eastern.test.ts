import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Today" on a server page is the Eastern day (easternDay in convex/lib/time.ts, the same rule as the scripts'
 * et_today): DOL works on Eastern days, and the UTC date is already tomorrow from about 8 PM Eastern, so an estimate
 * or a "days left" counted from it is a day off every evening.
 *
 * The files below still take the UTC date. Some do on purpose (the case status page and the scorecard's run agree
 * with each other on it); the rest wait their own review. None may gain one, and a file that loses one is lowered here.
 */
const V2 = join(__dirname, "..", "..", "..");
const UTC_TODAY = /new Date\(\)\.toISOString\(\)\.(?:slice\(0, ?10\)|split\(["']T["']\)\[0\])/g;

const STILL_UTC: Record<string, number> = {
  "src/app/(site)/(public)/debarments/page.tsx": 1,
  "src/app/(site)/(public)/debarments/settlements/page.tsx": 1,
  "src/app/(site)/(public)/estimate-scorecard/page.tsx": 1,
  "src/app/(site)/(public)/perm-attorneys/[slug]/page.tsx": 1,
  "src/app/(site)/(public)/perm-case-status/CaseStatusPage.tsx": 1,
  "src/app/(site)/(public)/perm-employers/[slug]/page.tsx": 3,
  "src/app/(site)/(public)/tools/ead-extension/page.tsx": 1,
  "src/app/(site)/(public)/tools/perm-timeline-calculator/page.tsx": 1,
  "src/app/api/case-changes/route.ts": 1,
  "src/app/api/cron/scorecard/route.ts": 1,
  "src/app/api/decided-cases/route.ts": 1,
  "src/app/sitemap.xml/route.ts": 1,
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p);
    return /\.tsx?$/.test(name) && !/\.(test|stories)\./.test(name) ? [p] : [];
  });
}

describe("a server page's today is the Eastern day", () => {
  it("catches the UTC date written either way", () => {
    expect("new Date().toISOString().slice(0, 10)".match(UTC_TODAY)).toHaveLength(1);
    expect('new Date().toISOString().split("T")[0]'.match(UTC_TODAY)).toHaveLength(1);
    expect("easternDay()".match(UTC_TODAY)).toBeNull();
  });

  it("gains no new UTC today, and the list is lowered when one goes", () => {
    const counts: Record<string, number> = {};
    for (const f of walk(join(V2, "src", "app"))) {
      const src = readFileSync(f, "utf8");
      if (/^\s*["']use client["']/.test(src)) continue;
      const n = (src.match(UTC_TODAY) ?? []).length;
      if (n > 0) counts[relative(V2, f).split("\\").join("/")] = n;
    }
    expect(counts).toEqual(STILL_UTC);
  });
});
