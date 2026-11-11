import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * In text a machine reads out (the MCP server's messages, the API's errors, llms.txt, the assistant plugin's
 * commands), one of our addresses is never followed by a sentence's punctuation.
 *
 * An assistant shows "(permtracker.app/developers)." and whatever turns it into a link takes the marks along: in the
 * 30 days to Nov 10 2026, /developers)., /api-terms). and /v1. were each asked for and answered 404. A redirect now
 * catches those; this keeps new ones from being written. The address goes last in its sentence with nothing after
 * it, or has a space after it.
 */
const ROOTS = ["src/lib/api", "src/app/llms.txt", "src/app/mcp", "claude-plugin"];
const READ = /\.(ts|tsx|md|json)$/;
const ADDRESS_THEN_MARK = /permtracker\.app\/[A-Za-z0-9/_#?=&%.-]*[A-Za-z0-9/_#-][).,;:]+(?=\s|$|["'`\\<])/g;
const COMMENT = /^\s*(\*|\/\/|\/\*)/;
/** A Markdown link's own closing bracket, and the standard "(+address)" of a crawler's user-agent line. */
const ALLOWED = [/\]\(https:\/\/permtracker\.app\/[^)\s]*\)[.,;:]?$/, /\(\+https:\/\/permtracker\.app\/[^)\s]*\)$/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return READ.test(p) && !/\.test\./.test(p) ? [p] : [];
  });
}

function found(path: string, text: string): string[] {
  return text.split("\n").flatMap((line, i) => {
    if (COMMENT.test(line)) return [];
    return [...line.matchAll(ADDRESS_THEN_MARK)]
      .filter((m) => !ALLOWED.some((ok) => ok.test(line.slice(0, m.index + m[0].length))))
      .map((m) => `${path}:${i + 1} ${m[0]}`);
  });
}

describe("our addresses in machine-read text", () => {
  it("the check finds an address with punctuation after it, and passes the allowed shapes", () => {
    expect(found("x.ts", 'const a = "for your own limit (permtracker.app/developers).";')).toHaveLength(1);
    expect(found("x.ts", 'const a = "See https://permtracker.app/developers#sandbox.";')).toHaveLength(1);
    expect(found("x.md", "point to https://permtracker.app/perm-case-status, which asks DOL")).toHaveLength(1);
    expect(found("x.ts", 'const a = "Keys: https://permtracker.app/developers";')).toHaveLength(0);
    expect(found("x.ts", 'const a = "an API at https://permtracker.app/v1 with keys";')).toHaveLength(0);
    expect(found("x.md", "Reference: [permtracker.app/developers](https://permtracker.app/developers).")).toHaveLength(0);
    expect(found("x.ts", '"User-Agent": "PERMTrackerWebhooks/1.0 (+https://permtracker.app/developers#webhooks)",')).toHaveLength(0);
    expect(found("x.ts", " * The MCP server behind permtracker.app/mcp: the tools")).toHaveLength(0);
  });

  it("holds in the MCP server, the API, llms.txt and the assistant plugin", () => {
    const all = ROOTS.flatMap(files);
    expect(all.length).toBeGreaterThan(20);
    expect(all.flatMap((f) => found(f, readFileSync(f, "utf8")))).toEqual([]);
  });
});
