import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The browser keeps no history of a search box; the site's own recent searches do, under the visitor's control.
 *
 * A box that leaves the browser's own autocomplete on can show a list of what was typed into it before, case
 * numbers included, to whoever uses the device next, with no way to clear it from the page. Every search-like box
 * says autoComplete="off": a type="search" input, or one named q, case, receipt, job, firm or employer.
 *
 * In its place, every such box offers the visitor's recent searches (`RecentSearchesField`): only what was
 * searched for, never a receipt number, with Clear under the box and cleared on sign-out. A box left out says why.
 *
 * The command palettes (cmdk's Command.Input, through src/components/ui/command.tsx) aren't read here: cmdk
 * draws its input with autoComplete="off" itself, which a test below reads from cmdk's own build, and each
 * palette draws the recent list in its own rows (PaletteRecentSearches.test.tsx).
 */

const ROOT = process.cwd();
const SEARCH_NAMES = /\bname=(?:"|\{")(q|case|receipt|job|firm|employer)"/;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${name}`;
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(join(ROOT, path)).isDirectory()) yield* sources(path);
    else if (name.endsWith(".tsx") && !/\.(test|stories)\.tsx$/.test(name)) yield path;
  }
}

/** Each <input ...> or <Input ...> opening tag in a file, read to its closing > past any {expression}. */
function inputTags(text: string): { line: number; at: number; tag: string }[] {
  const tags: { line: number; at: number; tag: string }[] = [];
  for (const m of text.matchAll(/<(?:input|Input)(?=[\s/>])/g)) {
    let depth = 0;
    let quote = "";
    let i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && (c === '"' || c === "'")) quote = c;
      else if (depth === 0 && c === ">") break;
    }
    tags.push({ line: text.slice(0, m.index).split("\n").length, at: m.index, tag: text.slice(m.index, i + 1) });
  }
  return tags;
}

/** A tag for a search box: a type="search" input, or one named for a search, never a hidden field. */
function searchLike(tag: string): boolean {
  if (/\btype=(?:"|\{")hidden"/.test(tag)) return false;
  return /\btype=(?:"|\{")search"/.test(tag) || SEARCH_NAMES.test(tag);
}

/** A tag for a search box that leaves the browser's autocomplete on. */
function keepsHistory(tag: string): boolean {
  return searchLike(tag) && !/\bautoComplete=(?:"|\{")off"/.test(tag);
}

/** Whether the tag at `at` sits inside a RecentSearchesField: an opening tag before it, and no closing one since. */
function offersRecent(text: string, at: number): boolean {
  const before = text.slice(0, at);
  return before.lastIndexOf("<RecentSearchesField") > before.lastIndexOf("</RecentSearchesField>");
}

/** The search boxes that don't offer recent searches, each with its reason. */
const WITHOUT_RECENT: Readonly<Record<string, string>> = {
  "src/components/search/SiteSearch.tsx": "the header's box opens the palette on focus, and the palette offers them",
  "src/components/tools/UscisReceiptForm.tsx":
    "it takes only USCIS receipt numbers, which are never kept; the saved list under it (SavedReceipts) keeps one when asked",
  "src/components/admin/SignalsPanel.tsx": "an admin tool, and it takes email addresses",
  "src/components/timeline/CaseSelectionModal.tsx": "it picks one of the account's own cases for the timeline: a picker, not a search",
};

describe("search boxes keep no history", () => {
  it("reads every component and page", () => {
    expect([...sources("src")].length).toBeGreaterThan(500);
  });

  it("turns the browser's autocomplete off on every search box", () => {
    const found: string[] = [];
    for (const path of sources("src")) {
      for (const { line, tag } of inputTags(readFileSync(join(ROOT, path), "utf8"))) {
        if (keepsHistory(tag)) found.push(`${path}:${line}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("would catch a box written either way, and reads a tag past its arrow functions", () => {
    const [one] = inputTags('<input\n  type="search"\n  onChange={(e) => set(e.target.value > "" ? 1 : 0)}\n  placeholder="Case"\n/>');
    expect(one!.tag).toContain('placeholder="Case"');
    expect(keepsHistory(one!.tag)).toBe(true);
    expect(keepsHistory('<Input name="receipt" value={v} />')).toBe(true);
    expect(keepsHistory('<input type={"search"} autoComplete={"off"} />')).toBe(false);
    expect(keepsHistory('<input type="search" autoComplete="off" />')).toBe(false);
    expect(keepsHistory('<input type="hidden" name="employer" value={x} />')).toBe(false);
    expect(keepsHistory('<input type="email" name="email" />')).toBe(false);
  });

  it("leaves cmdk's inputs to cmdk, which turns autocomplete off itself", () => {
    const cmdk = readFileSync(join(ROOT, "node_modules/cmdk/dist/index.mjs"), "utf8");
    expect(cmdk).toContain('autoComplete:"off"');
  });
});

describe("every search box offers the visitor's recent searches", () => {
  it("wraps each one in RecentSearchesField, or names it with its reason", () => {
    const found: string[] = [];
    for (const path of sources("src")) {
      if (path in WITHOUT_RECENT) continue;
      const text = readFileSync(join(ROOT, path), "utf8");
      for (const { line, at, tag } of inputTags(text)) {
        if (searchLike(tag) && !offersRecent(text, at)) found.push(`${path}:${line}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("names only boxes that are still there and still left out", () => {
    for (const path of Object.keys(WITHOUT_RECENT)) {
      const text = readFileSync(join(ROOT, path), "utf8");
      const leftOut = inputTags(text).filter(({ at, tag }) => searchLike(tag) && !offersRecent(text, at));
      expect(leftOut.length, path).toBeGreaterThan(0);
    }
  });

  it("would catch a box outside the wrapper, and passes one inside it, label and all", () => {
    const text =
      '<RecentSearchesField record="submit">\n  <label>Name <input type="search" /></label>\n</RecentSearchesField>{" "}\n<input name="q" />';
    const [inside, outside] = inputTags(text);
    expect(offersRecent(text, inside!.at)).toBe(true);
    expect(offersRecent(text, outside!.at)).toBe(false);
    expect(searchLike('<input type="hidden" name="q" value={x} />')).toBe(false);
  });
});
