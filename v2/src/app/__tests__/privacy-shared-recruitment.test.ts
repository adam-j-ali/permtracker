import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Privacy Policy says what sharing a recruitment record by link does (convex/recruitmentShares.ts,
 * src/app/share): anyone with the link sees that record, and only it, until the link is turned off; the link is
 * kept only as a hash; the page records no analytics and isn't indexed; the day it was last opened is noted; and
 * the link goes with its case and the account. The Ahrefs line no longer says it loads on every page.
 */
const SRC = join(process.cwd(), "src");
const flat = (s: string) => s.replace(/\s+/g, " ");
const page = flat(readFileSync(join(SRC, "app/(site)/(public)/privacy/page.tsx"), "utf8"));
const section = page.slice(page.indexOf('id="shared-recruitment-records"'), page.indexOf("User Preferences"));

describe("the privacy page and shared recruitment records", () => {
  it("has the section, under Case Data's neighbours", () => {
    expect(section.length).toBeGreaterThan(400);
    expect(page.indexOf('id="shared-recruitment-records"')).toBeGreaterThan(page.indexOf('id="counted-cases"'));
  });

  it("says anyone with the link sees the record, and what it holds, until the link is off, and nothing else", () => {
    expect(section).toContain("anyone with the link can see that record");
    for (const part of ["employer", "job title", "recruitment steps and their dates", "filing window", "recruitment log"]) {
      expect(section).toContain(part);
    }
    expect(section).toContain("until you turn the link off");
    expect(section).toMatch(/nothing else from your account/i);
    for (const left of ["beneficiary identifier", "notes", "documents", "case numbers", "wage"]) expect(section).toContain(left);
  });

  it("says how the link is kept, that the page records no analytics and isn't indexed, and what's noted", () => {
    expect(section).toContain("one-way hash");
    expect(section).toMatch(/no analytics/);
    expect(section).toMatch(/search engines/);
    expect(section).toContain("the day the link was last opened");
  });

  it("says the link goes with its case and the account", () => {
    expect(section).toMatch(/deleted when you delete its case or your account/);
  });

  it("no longer says Ahrefs loads on every page", () => {
    expect(page).not.toContain("page-view analytics loaded on every page.");
  });

  it("is dated the day it changed", () => {
    expect(page).toContain("Last Updated: November 20, 2026");
  });
});
