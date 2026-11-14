/**
 * REAL answers against the published schemas.
 *
 * The other tests hold the schemas to the samples and the examples. This one holds them to what the API really
 * sends: it calls every assistant tool on a running copy of the site (which runs the same reads as /v1) and checks
 * each answer's `data` against its operation's schema. It found the queue answer's schema and the sandbox sample
 * both wrong on its first run (Nov 14 2026), which no sample-based test could.
 *
 * It needs a server and real data, so it's SKIPPED unless told where to ask. Before a release that touches a
 * read or a schema, run it against the local preview on production data:
 *
 *   API_ANSWERS_BASE=http://localhost:3000 pnpm exec vitest run src/lib/api/__tests__/live-answers.ssr.test.ts
 *
 * About 28 tool calls, all through the keyless pool. Never point it at the live site in a loop.
 */
import { describe, expect, it } from "vitest";

import { TOOL_ENDPOINTS, toolName } from "../openapi";

const BASE = process.env.API_ANSWERS_BASE;

type ToolAnswer = { isError?: boolean; content: { text: string }[]; structuredContent?: { data: Record<string, unknown> } };

let id = 0;
async function call(name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const body = (line ? JSON.parse(line.slice(6)) : JSON.parse(text)) as { result?: ToolAnswer; error?: unknown };
  return body.result ?? { isError: true, content: [{ text: JSON.stringify(body.error ?? body).slice(0, 200) }] };
}

const byTool = new Map(TOOL_ENDPOINTS.map((e) => [toolName(e.id), e]));
const problems: string[] = [];
const asked = new Set<string>();

/** One real call: its answer's data, or null for a refusal or a not-found. A shape that misses its schema is recorded. */
async function check(name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  asked.add(name);
  const r = await call(name, args);
  const data = r.structuredContent?.data;
  const where = `${name} ${JSON.stringify(args)}`;
  if (r.isError || !data) {
    problems.push(`${where}: refused: ${r.content?.[0]?.text?.slice(0, 160)}`);
    return null;
  }
  if (data.found === false) return null;
  const parsed = byTool.get(name)!.response.schema.safeParse(data);
  if (!parsed.success) {
    problems.push(`${where}: ${JSON.stringify(parsed.error.issues.slice(0, 4).map((i) => ({ at: i.path.join("."), saying: i.message })))}`);
  }
  return data;
}

describe.skipIf(!BASE)("real answers fit the published schemas", () => {
  it(
    "answers every tool with data in its documented shape",
    async () => {
      await check("get_queue", {});
      await check("get_visa_bulletin", {});
      await check("get_visa_bulletin", { month: "2015-06" });
      await check("estimate_decision", { filed: "2026-03-10" });
      await check("estimate_decision", { filed: "2024-01-10" });
      for (const [search, get, q] of [
        ["search_employers", "get_employer", "google"],
        ["search_law_firms", "get_law_firm", "fragomen"],
        ["search_occupations", "get_occupation", "software"],
      ] as const) {
        const found = (await check(search, { q, limit: 5 })) as { results?: { slug: string }[] } | null;
        const slug = found?.results?.[0]?.slug;
        expect(slug, `${search} found nothing for "${q}"`).toBeTruthy();
        await check(get, { slug });
      }
      await check("lookup_employer", { name: "Google" });
      await check("lookup_employer", { name: "Zzyzx Nonexistent Holdings" });
      await check("lookup_soc", { q: "data scientist" });
      await check("lookup_soc", { q: "15-1252" });
      // A case of each program, found first, then read by its number: pending and decided where both exist.
      for (const program of ["perm", "pwd", "lca", "seasonal"]) {
        const found = (await check("find_cases", { employer: program === "seasonal" ? "farms" : "google", from: "2026-08-01", to: "2026-09-30", program })) as {
          cases?: { caseNumber: string; isFinal: boolean }[];
        } | null;
        const cases = found?.cases ?? [];
        expect(cases.length, `find_cases found no ${program} case`).toBeGreaterThan(0);
        const pending = cases.find((c) => !c.isFinal) ?? cases[0]!;
        const decided = cases.find((c) => c.isFinal);
        await check("get_case", { caseNumber: pending.caseNumber });
        if (decided && decided !== pending) await check("get_case", { caseNumber: decided.caseNumber });
        if (program === "perm") await check("estimate_decision", { case: pending.caseNumber });
      }
      await check("find_cases", { job: "software engineer", filed: "2026-09-15" });
      await check("find_cases", { firm: "fragomen", from: "2026-01-01", to: "2026-03-31" });

      expect(problems, "real answers that miss their schema").toEqual([]);
      // Control: a run that asked only some of the tools proves nothing about the rest.
      expect([...asked].sort()).toEqual(TOOL_ENDPOINTS.map((e) => toolName(e.id)).sort());
    },
    400_000,
  );
});
