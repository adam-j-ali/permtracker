/**
 * Does a path on permtracker.app lead somewhere? Read from the files that serve it, never from a list kept by hand.
 *
 * - A Next.js page or route under src/app, route groups dropped: `(site)/(public)/visa-bulletin/page.tsx` serves
 *   `/visa-bulletin`, and `[slug]` takes one segment.
 * - A dynamic page whose values come from files must name a file: a guide, blog post or changelog entry is its
 *   `.mdx` under content/, a USCIS form's processing-time page is a form in `FORM_PAGES`.
 * - The email-link relay: nginx sends `/prefs`, `/unsubscribe`, `/<kind>-alert/...` and the rest of the mail
 *   routes to Convex (scripts/oracle/nginx/permtracker.conf), so those are read from that location's own pattern.
 * - A file under public/.
 *
 * An anchor (`#bulletin-alert`) must be an id some page or component under src/ writes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { formPage } from "../src/lib/uscisForms";

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");
const SERVES = new Set(["page.tsx", "page.ts", "route.ts", "route.tsx"]);

type Segment = { lit: string } | { one: string } | { rest: string; optional: boolean };

interface Route {
  segments: Segment[];
  file: string;
}

function segmentOf(name: string): Segment | null {
  if (/^\(.*\)$/.test(name)) return null; // a route group adds nothing to the path
  const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(name);
  if (optional) return { rest: optional[1]!, optional: true };
  const rest = /^\[\.\.\.(.+)\]$/.exec(name);
  if (rest) return { rest: rest[1]!, optional: false };
  const one = /^\[(.+)\]$/.exec(name);
  if (one) return { one: one[1]! };
  return { lit: name };
}

let cache: Route[] | null = null;

function routes(): Route[] {
  if (cache) return cache;
  const out: Route[] = [];
  const walk = (dir: string, segments: Segment[]) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        // Private folders and tests serve nothing.
        if (name.startsWith("_") || name.startsWith("@")) continue;
        const seg = segmentOf(name);
        walk(full, seg ? [...segments, seg] : segments);
      } else if (SERVES.has(name)) {
        out.push({ segments, file: full });
      }
    }
  };
  walk(APP, []);
  cache = out;
  return out;
}

function matches(segments: Segment[], parts: string[]): Record<string, string[]> | null {
  const params: Record<string, string[]> = {};
  let i = 0;
  for (let s = 0; s < segments.length; s += 1) {
    const seg = segments[s]!;
    if ("lit" in seg) {
      if (parts[i] !== seg.lit) return null;
      i += 1;
    } else if ("one" in seg) {
      if (parts[i] === undefined) return null;
      params[seg.one] = [parts[i]!];
      i += 1;
    } else {
      const left = parts.slice(i);
      if (left.length === 0 && !seg.optional) return null;
      params[seg.rest] = left;
      i = parts.length;
    }
  }
  return i === parts.length ? params : null;
}

const CONTENT_KINDS = new Set(["guides", "blog", "changelog"]);

/** A dynamic page whose values are files: the value has to be one of them. */
function valueExists(parts: string[]): boolean {
  if (parts.length === 2 && CONTENT_KINDS.has(parts[0]!)) {
    return existsSync(join(ROOT, "content", parts[0]!, `${parts[1]}.mdx`));
  }
  if (parts.length === 2 && parts[0] === "uscis-processing-times") return formPage(parts[1]!) !== null;
  return true;
}

let relay: RegExp | null = null;

/** The nginx location that relays the email links to Convex, as written in the server's config. */
export function mailRelayPattern(): RegExp {
  if (relay) return relay;
  const conf = readFileSync(join(ROOT, "scripts/oracle/nginx/permtracker.conf"), "utf8");
  const m = /location ~ (\^\/\(prefs[^\s]*\$) \{/.exec(conf);
  if (!m) throw new Error("the mail relay location is missing from permtracker.conf");
  relay = new RegExp(m[1]!);
  return relay;
}

/**
 * The file that serves `path` (a pathname, query and hash allowed and ignored), or null when nothing does. The
 * mail relay answers with "nginx mail relay".
 */
export function sitePageFor(path: string): string | null {
  const clean = path.split(/[?#]/)[0]!;
  const parts = clean.split("/").filter(Boolean).map(decodeURIComponent);
  if (mailRelayPattern().test(`/${parts.join("/")}`)) return "nginx mail relay";
  if (parts.length > 0 && existsSync(join(ROOT, "public", ...parts)) && statSync(join(ROOT, "public", ...parts)).isFile()) {
    return join(ROOT, "public", ...parts);
  }
  // The most literal match wins, as Next.js routes it: a fixed segment before a dynamic one.
  const found = routes()
    .filter((r) => matches(r.segments, parts) !== null)
    .sort((a, b) => b.segments.filter((s) => "lit" in s).length - a.segments.filter((s) => "lit" in s).length)[0];
  if (!found) return null;
  const dynamic = found.segments.some((s) => !("lit" in s));
  return !dynamic || valueExists(parts) ? found.file : null;
}

let sources: string[] | null = null;

function sourceFiles(): string[] {
  if (sources) return sources;
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full);
      } else if (/\.(tsx?|mdx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(join(ROOT, "src"));
  sources = out;
  return out;
}

/** True when some page or component under src/ writes `id` as a string: the anchor a link's `#id` scrolls to. */
export function anchorExists(id: string): boolean {
  const needles = [`"${id}"`, `'${id}'`, `\`${id}\``];
  return sourceFiles().some((f) => {
    const text = readFileSync(f, "utf8");
    return needles.some((n) => text.includes(n));
  });
}
