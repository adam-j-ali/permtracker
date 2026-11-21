/**
 * No link from one page of the site to another carries rel="nofollow", unless it's listed below with its reason.
 *
 * Ahrefs flagged the compare page's three example pairs (Nov 20 2026): an internal nofollow tells a crawler the site
 * doesn't vouch for its own page. The pairs' addresses are closed to crawlers by robots.txt (`/perm-employers/compare?`)
 * and the page itself is noindex, so plain links lose nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");

/** Internal links that keep nofollow on purpose, by file, with the reason. */
const ALLOWED: Record<string, string> = {
  // The case numbered beside the one looked up: each a live DOL lookup, closed to crawlers by robots.txt
  // (`/perm-case-status?`), and drawn only on a lookup's own page, which crawlers can't reach.
  "src/components/tools/SameDayCases.tsx": "a live lookup per link, on a page crawlers can't reach",
};

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") files(p, out);
    } else if (name.endsWith(".tsx") && !/\.(test|stories)\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** The text an attribute's value starts with, when it's written in the source. */
function attrText(attr: ts.JsxAttribute | undefined): string | null {
  const init = attr?.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text;
  }
  return null;
}

function internalNofollow(file: string): number[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const get = (n: string) => attrs.find((a) => a.name.getText() === n);
      const href = attrText(get("href"));
      const rel = attrText(get("rel"));
      if (href !== null && href.startsWith("/") && !href.startsWith("//") && rel !== null && /\bnofollow\b/.test(rel)) {
        lines.push(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return lines;
}

describe("internal links", () => {
  const found = files(join(ROOT, "src")).flatMap((f) => internalNofollow(f).map((line) => ({ file: relative(ROOT, f), line })));

  it("carry no nofollow, but for the ones listed with a reason", () => {
    expect(found.filter((h) => !ALLOWED[h.file]).map((h) => `${h.file}:${h.line}`)).toEqual([]);
  });

  it("sees the ones it allows, so a scan that reads nothing can't pass", () => {
    for (const file of Object.keys(ALLOWED)) expect(found.some((h) => h.file === file), file).toBe(true);
  });
});
