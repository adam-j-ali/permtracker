import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No search box keeps a history. The site stores no past searches, and a box that leaves the browser's own
 * autocomplete on can show a list of what was typed into it before, case numbers included, to whoever uses
 * the device next. Every search-like box says autoComplete="off": a type="search" input, or one named q,
 * case, receipt, job, firm or employer.
 *
 * The command palettes (cmdk's Command.Input, through src/components/ui/command.tsx) aren't read here: cmdk
 * draws its input with autoComplete="off" itself, which the last test reads from cmdk's own build.
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
function inputTags(text: string): { line: number; tag: string }[] {
  const tags: { line: number; tag: string }[] = [];
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
    tags.push({ line: text.slice(0, m.index).split("\n").length, tag: text.slice(m.index, i + 1) });
  }
  return tags;
}

/** A tag for a search box that leaves the browser's autocomplete on. */
function keepsHistory(tag: string): boolean {
  if (/\btype=(?:"|\{")hidden"/.test(tag)) return false;
  const searchLike = /\btype=(?:"|\{")search"/.test(tag) || SEARCH_NAMES.test(tag);
  return searchLike && !/\bautoComplete=(?:"|\{")off"/.test(tag);
}

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
