import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An eCFR link names the subpart eCFR files its section under.
 *
 * eCFR's addresses carry the subpart (`part-656/subpart-C/section-656.10`), and a
 * wrong one is easy to type and hard to see: eight links pointed 656.10 at subpart
 * A and 656.30 and 656.31 at subpart D (found Nov 9 2026). Each subpart below was
 * read from eCFR's own ancestry API
 * (`/api/versioner/v1/ancestry/<date>/title-<n>.json?part=<p>&section=<s>`) on
 * Nov 9 2026. A section cited for the first time fails here until its subpart is
 * read the same way and added.
 */

const SUBPART: Record<string, string> = {
  "656.3": "A",
  "656.10": "C",
  "656.11": "C",
  "656.12": "C",
  "656.15": "C",
  "656.17": "C",
  "656.20": "C",
  "656.30": "C",
  "656.31": "C",
  "656.40": "D",
  "655.715": "H",
  "655.731": "H",
  "655.740": "H",
  "204.5": "A",
  "214.2": "A",
  "274a.13": "B",
};

const ROOTS = ["content", "src", "convex", "scripts"];
const LINK = /ecfr\.gov\/[^\s)"'>]*?\/subpart-([A-Za-z]+)\/section-([0-9]+[a-z]?\.[0-9]+[a-z]?)/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|mdx|py|json)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

export function subpartFindings(text: string, where: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(LINK)) {
    const [, subpart, section] = m as unknown as [string, string, string];
    const want = SUBPART[section];
    if (!want) found.push(`${where}: section ${section} isn't in the table; read its subpart from eCFR and add it`);
    else if (want !== subpart) found.push(`${where}: section ${section} is in subpart ${want}, the link says ${subpart}`);
  }
  return found;
}

describe("eCFR links name the right subpart", () => {
  const files = ROOTS.flatMap((r) => walk(r));
  const links = files.reduce((n, f) => n + [...readFileSync(f, "utf8").matchAll(LINK)].length, 0);

  it("finds the site's eCFR links", () => {
    // A gate that sees no links reads exactly like a pass.
    expect(links).toBeGreaterThan(40);
  });

  it("every link's subpart matches eCFR's", () => {
    expect(files.flatMap((f) => subpartFindings(readFileSync(f, "utf8"), f))).toEqual([]);
  });

  it("catches a wrong subpart and an unknown section", () => {
    const bad = "https://www.ecfr.gov/current/title-20/chapter-V/part-656/subpart-A/section-656.10";
    const unknown = "https://www.ecfr.gov/current/title-20/chapter-V/part-656/subpart-C/section-656.99";
    expect(subpartFindings(bad, "x")).toEqual(["x: section 656.10 is in subpart C, the link says A"]);
    expect(subpartFindings(unknown, "x")).toHaveLength(1);
    expect(subpartFindings(bad.replace("subpart-A", "subpart-C"), "x")).toEqual([]);
  });
});
