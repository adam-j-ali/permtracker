import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The legal pages (Terms, Privacy, API terms) read as one spread on a wide screen: the contents beside the text,
 * held in view while it scrolls, and above the text on a phone, as before. The words themselves are untouched; only
 * where the contents sit changed.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const PAGES = {
  terms: "src/app/(site)/(public)/terms/page.tsx",
  privacy: "src/app/(site)/(public)/privacy/page.tsx",
  "api-terms": "src/app/(site)/(public)/api-terms/page.tsx",
} as const;

describe.each(Object.entries(PAGES))("the %s page", (_name, path) => {
  const src = read(path);
  const page = src.slice(src.indexOf("export default function"));

  it("puts its contents beside the text on a wide page and above it on a phone", () => {
    expect(page).toContain("<SplitColumns asideFirst sticky aside={<SectionIndex sections={SECTIONS} side />}>");
    // One contents list, inside the split, and the split closes after the last section.
    expect(page.match(/<SectionIndex\b/g)).toHaveLength(1);
    const open = page.indexOf("<SplitColumns");
    const close = page.indexOf("</SplitColumns>");
    expect(page.indexOf("<h1")).toBeLessThan(open);
    expect(close).toBeGreaterThan(page.lastIndexOf('id="contact'));
  });

  it("widens the page to hold the two columns", () => {
    expect(page).toMatch(/className="mx-auto max-w-6xl /);
  });
});

describe("the contents list beside the text", () => {
  const src = read("src/components/legal/SectionIndex.tsx");

  it("runs one column and no taller than the window there, two columns on a phone's wider widths as before", () => {
    expect(src).toContain("@[56rem]:max-h-[calc(100dvh-8rem)] @[56rem]:overflow-y-auto");
  });

  it("is a plain outlined list beside the text, never the tinted card with a hard shadow that outweighed the page", () => {
    const sideBox = src.match(/side\s*\?\s*"([^"]+)"/)?.[1] ?? "";
    expect(sideBox).toContain("border-2");
    expect(sideBox).not.toMatch(/bg-tint|shadow-hard/);
    expect(src).toContain('"sm:grid-cols-2 @[56rem]:grid-cols-1"');
  });
});
