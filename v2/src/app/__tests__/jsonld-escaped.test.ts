import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every JSON-LD script goes through JsonLdScript (or the article StructuredData component), which writes "<" as
 * <. A raw JSON.stringify inside <script type="application/ld+json"> would let a string that carries
 * "</script>" (an employer name from a DOL file, a title) close the element early (the Nov 9 2026 security audit).
 */
const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ESCAPING = new Set(["components/seo/JsonLdScript.tsx", "components/content/StructuredData.tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

describe("JSON-LD", () => {
  it("is written only by the components that escape it", () => {
    const raw = files(SRC)
      .filter((f) => !ESCAPING.has(path.relative(SRC, f)))
      .filter((f) => /application\/ld\+json/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(raw).toEqual([]);
  });
});
