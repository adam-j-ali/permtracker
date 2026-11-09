import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A failed read is never "no record". On the server, `.catch(() => null)` (or `[]`, `0`, `{}`) turns a database
 * blip into a page that says nothing is there, records nothing, and is then cached for the page's whole window. The
 * Nov 4 2026 sweep moved 220 such reads to `softFail` (src/lib/softRead.ts), which keeps the fallback and records
 * the failure; the case status page still held 24 of them on Nov 9, and nothing stopped new ones.
 *
 * So: no server file under src/app may have one, and src/lib/db may not gain one. The readers listed below still
 * hold theirs (each a reviewed read, a cache eviction or a parse guard, or not yet moved); a count may only fall,
 * and when it falls this list is lowered with it.
 *
 *   fine:     getX().catch(softFail("page.getX", null))
 *   fine:     getX()                                  // throws, so the last good render stays
 *   refused:  getX().catch(() => null)
 */
const V2 = join(__dirname, "..", "..", "..");
const BARE = /\.catch\(\s*\(\s*(?:_\w*)?\s*\)(?:\s*:[^=]*?)?\s*=>/g;
// Comments mention the pattern; a URL's "//" sits after a colon, so only a "//" after a space or a line start is one.
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm;

/** Each a deliberate fallback that isn't a read of a record: a request body, a best-effort note after a failure. */
const APP_ALLOWED: Record<string, number> = {
  "src/app/api/client-error/route.ts": 1,
  "src/app/api/chat/execute-tool/route.ts": 1,
};

/** The database readers' remaining ones, Nov 9 2026. Lower an entry when its file loses one. */
const DB_REMAINING: Record<string, number> = {
  "src/lib/db/bulletinLine.ts": 1,
  "src/lib/db/caseSearchReads.ts": 2,
  "src/lib/db/dateSources.ts": 1,
  "src/lib/db/debarments.ts": 1,
  "src/lib/db/decidedDays.ts": 5,
  "src/lib/db/embedLookup.ts": 2,
  "src/lib/db/employerHistory.ts": 3,
  "src/lib/db/employerPrograms.ts": 2,
  "src/lib/db/employerSlugs.ts": 1,
  "src/lib/db/employerStages.ts": 1,
  "src/lib/db/entities.ts": 1,
  "src/lib/db/entityBrowse.ts": 1,
  "src/lib/db/greenCardLine.ts": 1,
  "src/lib/db/h1bRanks.ts": 1,
  "src/lib/db/h2bGroups.ts": 1,
  "src/lib/db/lcaProfile.ts": 1,
  "src/lib/db/monthDetail.ts": 1,
  "src/lib/db/nameSuggest.ts": 2,
  "src/lib/db/openData.ts": 1,
  "src/lib/db/publicData.ts": 1,
  "src/lib/db/recordCounts.ts": 2,
  "src/lib/db/reference.ts": 8,
  "src/lib/db/scorecard.ts": 2,
  "src/lib/db/socTitles.ts": 2,
  "src/lib/db/uscisCaseStatus.ts": 2,
  "src/lib/db/uscisQuarterly.ts": 12,
  "src/lib/db/visaIssuances.ts": 2,
  "src/lib/db/warn.ts": 2,
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p);
    return /\.tsx?$/.test(name) && !/\.(test|stories)\./.test(name) ? [p] : [];
  });
}

/** Files that run on the server: a "use client" file and the service worker run in the browser. */
function serverFiles(tree: string): string[] {
  return walk(join(V2, tree)).filter((f) => {
    const src = readFileSync(f, "utf8");
    return !/^\s*["']use client["']/.test(src) && !f.endsWith(join("src", "app", "sw.ts"));
  });
}

function counts(tree: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of serverFiles(tree)) {
    const n = (readFileSync(f, "utf8").replace(COMMENTS, "$1").match(BARE) ?? []).length;
    if (n > 0) out[relative(V2, f).split("\\").join("/")] = n;
  }
  return out;
}

describe("a failed server read is recorded, never a silent fallback", () => {
  it("sees the trees it guards", () => {
    expect(serverFiles("src/app").length).toBeGreaterThan(300);
    expect(serverFiles("src/lib/db").length).toBeGreaterThan(100);
  });

  it("catches the pattern it's meant to, and not a recorded fallback or a comment", () => {
    const n = (s: string) => (s.replace(COMMENTS, "$1").match(BARE) ?? []).length;
    expect(n("getX().catch(() => null)")).toBe(1);
    expect(n("getX().catch((): Row[] => [])")).toBe(1);
    expect(n("getX().catch((_e) => 0)")).toBe(1);
    expect(n('getX().catch(softFail("x", null))')).toBe(0);
    expect(n("getX().catch((e) => { console.error(e); return null; })")).toBe(0);
    expect(n("// was getX().catch(() => null)\n/* and .catch(() => []) */")).toBe(0);
    expect(n('fetch("https://x.test").catch(() => null)')).toBe(1);
  });

  it("has none in a server file under src/app", () => {
    expect(counts("src/app")).toEqual(APP_ALLOWED);
  });

  it("has no new one in src/lib/db, and the list is lowered when one goes", () => {
    expect(counts("src/lib/db")).toEqual(DB_REMAINING);
  });
});
