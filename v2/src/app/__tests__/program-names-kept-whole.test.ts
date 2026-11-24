/**
 * No program or form name typed into the site's JSX can split across two lines: every H-1B, CW-1, I-140 or
 * ETA-9089 written as page text sits in KeepWhole (src/components/ui/keep-whole.tsx), which keeps it in a
 * no-wrap span. A browser may break a line after any hyphen, and on a phone "CW-" ended one line with "1." on
 * the next (Nov 23 2026: the phone sweep found about 35 on 37 pages).
 *
 * The finder is scripts/lib_keep_whole.mjs: a JSX text node, a string or template child, or a child that comes
 * out as one of several strings. Props, code, options, titles and a drawing's text are left alone. The fix for a
 * failure here is the codemod, which rewrites without changing a character of what renders:
 *   node scripts/keep_whole_codemod.mjs --write <file>
 * Text a shared part prints from data (a label, a title) is kept whole by that part (keepWhole), not here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findLooseNames, LEFT_LOOSE, leftLoose, NOT_PAGE_TEXT, pageSources } from "../../../scripts/lib_keep_whole.mjs";

const ROOT = join(__dirname, "..", "..", "..");

/** Parsing every page source takes a few seconds, and more on a busy machine. */
const SCAN_MS = 120_000;

describe("program and form names typed into the site's pages", () => {
  const sources = pageSources(ROOT);

  it("are kept whole: run `node scripts/keep_whole_codemod.mjs --write <file>` on any listed here", { timeout: SCAN_MS }, () => {
    const loose = sources.flatMap(({ file, source }) =>
      findLooseNames(source, file)
        .filter((r) => !leftLoose(file, r))
        .map((r) => `${file}:${r.line} ${r.rendered.replace(/\s+/g, " ").slice(0, 90)}`),
    );
    expect(loose).toEqual([]);
  });

  it("are read from every page source, so a scan that reads nothing can't pass", () => {
    expect(sources.length).toBeGreaterThan(500);
    expect(sources.some((s) => s.file === "src/app/(site)/(public)/compare/page.tsx")).toBe(true);
    expect(sources.filter((s) => s.source.includes("<KeepWhole>")).length).toBeGreaterThan(100);
  });

  it("would catch a name typed today, in text, a template and a choice", () => {
    const probe = `export const A = ({ x }: { x: string }) => (
      <section>
        <h2>Top H-1B employers</h2>
        <p>{\`The I-485 at \${x}\`}</p>
        <p>{x ? "an EB-2 case" : "none"}</p>
      </section>
    );`;
    expect(findLooseNames(probe, "probe.tsx").map((r) => r.kind)).toEqual(["text", "template", "choice"]);
  });

  it("leaves out only the sources and runs listed with a reason, each still there", { timeout: SCAN_MS }, () => {
    for (const [path, reason] of Object.entries(NOT_PAGE_TEXT)) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(reason.length, path).toBeGreaterThan(10);
    }
    for (const [file, runs] of Object.entries(LEFT_LOOSE as Record<string, Record<string, string>>)) {
      const source = sources.find((s) => s.file === file);
      expect(source, file).toBeDefined();
      const found = findLooseNames(source!.source, file);
      for (const [start, reason] of Object.entries(runs)) {
        expect(found.some((r) => r.rendered.startsWith(start)), `${file}: ${start}`).toBe(true);
        expect(reason.length, `${file}: ${start}`).toBeGreaterThan(10);
      }
    }
  });
});
