import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Privacy Policy says what the search boxes keep in the browser: the recent searches, how many (from the module's
 * own constant, so the number can't drift), never a USCIS receipt number, never sent to us, and how they go.
 */

const page = readFileSync(join(process.cwd(), "src/app/(site)/(public)/privacy/page.tsx"), "utf8").replace(/\s+/g, " ");

const START = "The search boxes keep your last {RECENT_SEARCHES_KEPT} searches on this device";
const item = page.includes(START) ? page.slice(page.indexOf(START), page.indexOf("</li>", page.indexOf(START))) : "";

describe("the privacy page and recent searches", () => {
  it("says the boxes keep them on this device, how many, and never a receipt number", () => {
    expect(item).not.toBe("");
    expect(item).toContain("the case numbers and names you searched for, never a USCIS receipt number");
    expect(item).toContain("They stay in your browser’s storage, and we never receive them");
  });

  it("says how they're removed", () => {
    expect(item).toContain("Clear under any search box removes them, and so does signing out");
  });

  it("names them among what local storage holds", () => {
    const storage = page.slice(page.indexOf("<strong>LocalStorage:</strong>"), page.indexOf("<strong>Error Monitoring:</strong>"));
    expect(storage).toContain("your recent searches");
  });

  it("reads the number from the module that keeps them", () => {
    expect(page).toContain('import { RECENT_SEARCHES_KEPT } from "@/lib/search/recentSearches";');
  });

  it("is dated the day it changed, or a later change's day", () => {
    // A later change moves the date on; it can never go back before this one.
    const dated = /Last Updated: ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(page)?.[1];
    expect(dated).toBeDefined();
    expect(Date.parse(dated!)).toBeGreaterThanOrEqual(Date.parse("November 23, 2026"));
  });
});
