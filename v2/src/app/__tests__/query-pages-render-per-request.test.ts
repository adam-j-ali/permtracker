import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A page that reads `searchParams` renders per request, so it must not also declare itself static: an exported
 * generateStaticParams (even an empty one) or `dynamic = "force-static"`. In a production build the two together
 * fail every request with DYNAMIC_SERVER_USAGE (a 500), and the dev server never shows it, because it renders every
 * page per request anyway. With force-static the query is silently read as empty instead. Found on the live site the
 * night a block's receipt-number list shipped (its pager reads ?page= and ?per=).
 */

const ROOT = join(process.cwd(), "src/app");

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

// The code alone: a comment that mentions searchParams doesn't read it.
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const reading = pages(ROOT).filter((p) => /\bsearchParams\b/.test(code(readFileSync(p, "utf8"))));

describe("pages that read the query render per request", () => {
  it("found the pages it is meant to check", () => {
    expect(reading.length).toBeGreaterThanOrEqual(5);
  });

  it.each(reading.map((p) => [p.slice(ROOT.length + 1), p]))("%s declares nothing static", (_name, p) => {
    const src = code(readFileSync(p, "utf8"));
    expect(src).not.toMatch(/export (async )?function generateStaticParams|export \{[^}]*\bgenerateStaticParams\b/);
    expect(src).not.toMatch(/export const dynamic\s*=\s*["']force-static["']/);
  });
});
