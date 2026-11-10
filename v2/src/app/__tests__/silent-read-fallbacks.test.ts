import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A failed read is never "no record". On the server, `.catch(() => null)` (or `[]`, `0`, `{}`) turns a database
 * blip into a page that says nothing is there, records nothing, and is then cached for the page's whole window. The
 * Nov 4 2026 sweep moved 220 such reads to `softFail` (src/lib/softRead.ts), which keeps the fallback and records
 * the failure; the case status page still held 24 of them on Nov 9, and nothing stopped new ones.
 *
 * So: no server file under src/app, src/components or src/lib may have one. The few listed below aren't reads of a
 * record answered with nothing (a cache dropping a failed load, a request or response body that isn't JSON), and
 * each list says what its entries are. A new entry needs the same kind of reason.
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

/** Under src/components, the one deliberate kind: an error screen's own report, which must never throw a second error. */
const COMPONENTS_ALLOWED: Record<string, number> = {
  "src/components/error/recovery.ts": 2,
};

/**
 * The database readers' deliberate ones, each not a read answered with nothing: a cache dropping a load that failed,
 * so it isn't served for hours (entities, entityBrowse, nameSuggest, socTitles), and the embed's lookup, which turns
 * a failure into the named miss "unavailable" that the embed prints. Every other reader records or throws
 * (Nov 10 2026: 60 listed that morning, these 7 by the evening). A new one here needs the same kind of reason.
 */
const DB_REMAINING: Record<string, number> = {
  "src/lib/db/embedLookup.ts": 2,
  "src/lib/db/entities.ts": 1,
  "src/lib/db/entityBrowse.ts": 1,
  "src/lib/db/nameSuggest.ts": 1,
  "src/lib/db/socTitles.ts": 2,
};

/**
 * The rest of src/lib (the sitemap, the badges, the public API, the chat's tools): a body that isn't JSON read as
 * none (a request's or USCIS's answer), and the employer lookup's cache dropping a check that failed.
 */
const LIB_ALLOWED: Record<string, number> = {
  "src/lib/api/employerLookup.ts": 1,
  "src/lib/api/webhooksApi.ts": 1,
  "src/lib/auth/authGate.ts": 1,
  "src/lib/uscis/torchClient.ts": 2,
};

/** Fewer server files than this under src/components means the walk has stopped seeing them. */
const SERVER_COMPONENTS_FLOOR = 250;

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
    expect(serverFiles("src/components").length).toBeGreaterThan(SERVER_COMPONENTS_FLOOR);
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

  it("has none in a server file under src/components, beyond an error screen's own report", () => {
    expect(counts("src/components")).toEqual(COMPONENTS_ALLOWED);
  });

  it("has none in src/lib/db beyond the deliberate ones", () => {
    expect(counts("src/lib/db")).toEqual(DB_REMAINING);
  });

  it("has none in the rest of src/lib beyond the deliberate ones", () => {
    const all = counts("src/lib");
    const rest = Object.fromEntries(Object.entries(all).filter(([file]) => !file.startsWith("src/lib/db/")));
    expect(rest).toEqual(LIB_ALLOWED);
    // The walk must still be seeing the readers, or the line above says nothing.
    expect(Object.keys(all).filter((file) => file.startsWith("src/lib/db/")).length).toBe(Object.keys(DB_REMAINING).length);
  });
});
