import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lime is the action and the picked option. A figure card may take the lime fill only when it marks where DOL is
 * working now or the reader's own figure; a total takes the ink card instead. Each allowed file says which.
 */
const ALLOWED: Record<string, string> = {
  "src/app/(site)/(public)/perm-queue/page.tsx": "DOL is working: where the line is now",
  "src/app/(site)/(public)/perm-queue/[month]/page.tsx": "DOL is working: where the line is now",
  "src/app/(site)/(public)/tools/page.tsx": "DOL is deciding cases filed: where the line is now",
  "src/components/tools/CaseStatusResult.tsx": "the cases ahead of the reader's own case",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path);
    return /\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("lime figure cards", () => {
  const root = join(__dirname, "..", "..", "..");
  const files = sources(join(root, "src")).map((p) => relative(root, p));
  const lime = files.filter((f) => /tone="lime"|tone: "lime"/.test(readFileSync(join(root, f), "utf8")));

  it("appear only where they mark now or the reader's own figure", () => {
    expect(lime.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it("keep each allowed file honest: it still uses the lime card", () => {
    expect(Object.keys(ALLOWED).filter((f) => !lime.includes(f))).toEqual([]);
  });
});
