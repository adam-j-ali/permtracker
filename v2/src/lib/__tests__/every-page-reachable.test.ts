import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DATA_MENU_FOOTER, FOOTER_COLUMNS, FOOTER_LEGAL, HEADER_PAGES, LEARN_PAGES, PAGE_NAMES, SECTIONS } from "@/lib/siteMap";

/**
 * Every public page is easy to reach, and every page has a name of its own (the owner's rule, Nov 24 2026: one page
 * per question, within reach of the homepage, one name in the header, menu, title, heading and search).
 *
 * Reachable means one click from any page (the header, the footer) or two (the Data and Learn menus), or linked from a
 * parent page those reach, listed in scripts/data/child_pages.json; scripts/audit_headings.py checks on the rendered
 * site that each parent really links its pages, and that each H1 holds its page's name.
 */

const ROOT = join(__dirname, "..", "..", "..");
const PUBLIC_DIR = join(ROOT, "src", "app", "(site)", "(public)");
const CHILD_PAGES: Record<string, string> = (
  JSON.parse(readFileSync(join(ROOT, "scripts", "data", "child_pages.json"), "utf8")) as { pages: Record<string, string> }
).pages;

/** Every static public route, from the file system, so a page added tomorrow is held too. */
function publicRoutes(): string[] {
  const out: string[] = readdirSync(PUBLIC_DIR).includes("page.tsx") ? ["/"] : [];
  const walk = (dir: string, seg: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory() || entry.startsWith("[") || entry.startsWith("_")) continue;
      const next = entry.startsWith("(") ? seg : `${seg}/${entry}`;
      if (!entry.startsWith("(") && readdirSync(full).includes("page.tsx")) out.push(next);
      walk(full, next);
    }
  };
  walk(PUBLIC_DIR, "");
  return [...new Set(out)].sort();
}

const linked = new Set<string>([
  "/",
  ...Object.values(HEADER_PAGES).map((p) => p.href),
  ...SECTIONS.map((p) => p.href),
  ...DATA_MENU_FOOTER.map((p) => p.href),
  ...LEARN_PAGES.map((p) => p.href),
  ...FOOTER_COLUMNS.flatMap((c) => c.pages.map((p) => p.href)),
  ...FOOTER_LEGAL.map((p) => p.href),
]);

describe("every public page is easy to reach", () => {
  const routes = publicRoutes();

  it("finds the public pages (a walk that finds few is broken, not clean)", () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it("links every page from the header, a menu or the footer, or from a parent page that is", () => {
    const lost = routes.filter((r) => !linked.has(r) && !(CHILD_PAGES[r] && linked.has(CHILD_PAGES[r])));
    expect(lost).toEqual([]);
  });

  it("lists only real pages, each under a parent the menus reach", () => {
    const stale = Object.entries(CHILD_PAGES).filter(([child, parent]) => !routes.includes(child) || !linked.has(parent));
    expect(stale).toEqual([]);
  });
});

describe("one name per page", () => {
  it("gives no two pages the same name, so a menu or search never shows two of one name", () => {
    const byName = new Map<string, string[]>();
    for (const [href, name] of PAGE_NAMES) byName.set(name, [...(byName.get(name) ?? []), href]);
    const shared = [...byName].filter(([, hrefs]) => hrefs.length > 1);
    expect(shared).toEqual([]);
  });
});
