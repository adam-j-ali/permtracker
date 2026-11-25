import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { easternDay } from "@convex/lib/time";

/**
 * An article whose title names a year is one of two kinds. One about a single period (a quarter's DOL file, a month's
 * layoff notices) keeps its year for good. An evergreen one ("The ultimate PERM guide for 2026") is refreshed for the
 * new year by January 15: its figures read again and its title moved on, the address kept (Batch 10's "2026 titles
 * planned for January"). This test fails from January 15 of the next year on any evergreen title still naming the
 * past year, and fails any new dated title that isn't sorted into one kind or the other.
 */

const ROOT = join(process.cwd(), "content");
const KINDS = ["guides", "blog"] as const;

/** Articles about one period, by slug: their year is part of what they cover. */
const PERIOD_BOUND = new Set([
  "dol-perm-file-fy2026-q3",
  "dol-perm-file-fy2026-q4",
  "h1b-sponsors-layoff-notices-october-2026",
]);

/** Evergreen articles that name the current year, refreshed each January. */
const EVERGREEN = new Set([
  "complete-perm-filing-guide",
  "ultimate-perm-guide-2026",
  "best-immigration-case-management-tools",
  "free-immigration-case-management-software",
  "immigration-software-pricing-2026",
  "perm-processing-times-2026",
]);

interface Dated {
  slug: string;
  title: string;
  year: number;
}

function datedTitles(): Dated[] {
  const out: Dated[] = [];
  for (const kind of KINDS) {
    for (const file of readdirSync(join(ROOT, kind)).filter((f) => f.endsWith(".mdx"))) {
      const text = readFileSync(join(ROOT, kind, file), "utf8");
      const title = /^title:\s*"?(.*?)"?\s*$/m.exec(text)?.[1] ?? "";
      const year = /\b(20\d\d)\b/.exec(title)?.[1];
      if (year) out.push({ slug: file.replace(/\.mdx$/, ""), title, year: Number(year) });
    }
  }
  return out;
}

/** True from January 15 of the year after `year`, Eastern. */
function pastRefresh(year: number, today: string): boolean {
  return today >= `${year + 1}-01-15`;
}

describe("articles whose titles name a year", () => {
  const dated = datedTitles();

  it("finds the dated titles", () => {
    expect(dated.length).toBeGreaterThanOrEqual(EVERGREEN.size);
  });

  it("sorts every dated title as one period or evergreen", () => {
    const unsorted = dated.filter((d) => !PERIOD_BOUND.has(d.slug) && !EVERGREEN.has(d.slug)).map((d) => d.slug);
    expect(unsorted, "add each to PERIOD_BOUND or EVERGREEN in this file").toEqual([]);
  });

  it("has no evergreen title still naming a past year after January 15", () => {
    const today = easternDay();
    const stale = dated.filter((d) => EVERGREEN.has(d.slug) && pastRefresh(d.year, today)).map((d) => `${d.slug}: ${d.title}`);
    expect(stale, "refresh each article's figures and move its title to this year; keep its address").toEqual([]);
  });

  it("counts the refresh day from the title's own year", () => {
    expect(pastRefresh(2026, "2027-01-14")).toBe(false);
    expect(pastRefresh(2026, "2027-01-15")).toBe(true);
    expect(pastRefresh(2027, "2027-06-01")).toBe(false);
  });
});
