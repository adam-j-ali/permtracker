/**
 * A possessive built on a value the code fills in: `${row.name}'s`, `{firmName}&apos;s`, `{who}’s`. DOL prints
 * names in capitals and with their own endings ("MERIT LOGISTICS", "ACME HOLDINGS, LLC"), so "MERIT
 * LOGISTICS's" reached a heading on Nov 23 2026. The copy says "the filings of", "cases at" or "the page for"
 * instead. Read by two source tests: email-voice.test.ts holds the email templates, and
 * no-possessive-on-names.test.ts holds every other file.
 *
 * The match is the interpolation, `${...}` or `{...}`, then an apostrophe (straight, curly, an entity or the
 * ’ escape) and an s that ends the word, so "{count}s" and "${x}'ll" are left alone.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const POSSESSIVE_ON_VALUE = /(\$\{[^{}]*\}|\{[^{}]*\})(?:'|’|&apos;|&rsquo;|&#39;|\\u2019)s\b/g;

export interface PossessiveHit {
  file: string;
  line: number;
  /** The interpolation the possessive is built on, braces included: `${row.name}`. */
  value: string;
}

/** Every possessive on a value in `text`, one hit each. */
export function possessivesIn(file: string, text: string): PossessiveHit[] {
  return text.split("\n").flatMap((ln, i) => [...ln.matchAll(POSSESSIVE_ON_VALUE)].map((m) => ({ file, line: i + 1, value: m[1]! })));
}

/** The source files under `dir` (relative to `root`), tests and generated code left out. */
export function sourceFiles(root: string, dir: string, skip: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel))) {
      const path = `${rel}/${name}`;
      if (skip(path) || name === "node_modules" || name === "_generated" || name === "__tests__") continue;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name)) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/** The hits in `files`, read from disk. */
export function possessivesInFiles(root: string, files: readonly string[]): PossessiveHit[] {
  return files.flatMap((f) => possessivesIn(f, readFileSync(join(root, f), "utf8")));
}
