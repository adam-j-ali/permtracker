/**
 * The MCP server behind permtracker.app/mcp: the API's reads as tools an AI
 * assistant can call.
 *
 * THE TOOLS ARE BUILT FROM THE API'S OWN REGISTRY (./openapi.ts): one tool per
 * read operation, named after it (getCase is get_case), with the endpoint's
 * parameters, limits and description. Each tool calls the same function as its
 * /v1 endpoint, so an answer in an assistant and an answer from the API can't
 * disagree. Every tool only reads.
 *
 * NO KEY NEEDED. Assistants connected by URL (Claude's custom connectors, for
 * one) can't send a header, and they arrive from their maker's own addresses,
 * so calls without a key share one pool per copy of the site. A key, in
 * clients that can send one (Claude Code, Cursor), gets its plan's own limits
 * and is counted like an API call.
 */
import "server-only";

import { McpServer, type AuthInfo, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ApiCaller } from "./auth";
import { lookupEmployer } from "./employerLookup";
import { logShapeMiss } from "./mcpLog";
import { API_VERSION, TOOL_ENDPOINTS, toolName, type EndpointDoc } from "./openapi";
import { findCases, readBulletin, readCase, readEntity, readEstimate, readQueue, searchEntities, type ReadResult } from "./reads";
import { lookupSoc } from "./socLookup";
import { ANONYMOUS_ACCOUNT, checkAllowance, countCall, takeMinute } from "./usage";

/** Tool calls a minute from every caller without a key together, in one copy of the site. */
export const ANONYMOUS_PER_MINUTE = 300;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

export function callerFromAuthInfo(authInfo: AuthInfo | undefined): ApiCaller {
  const c = authInfo?.extra?.caller as ApiCaller | undefined;
  return c && c.kind === "key" ? c : { kind: "anonymous" };
}

/** A refusal message, or null when the call may go ahead. */
async function admit(caller: ApiCaller): Promise<string | null> {
  if (caller.kind === "anonymous") {
    const m = takeMinute(`mcp:${ANONYMOUS_ACCOUNT}`, ANONYMOUS_PER_MINUTE);
    return m.ok
      ? null
      : `PERM Tracker is answering many assistants at once. Try again in ${m.reset} seconds, or connect with a free API key for your own limit. Keys: https://permtracker.app/developers`;
  }
  if (caller.sandbox) {
    return "Sandbox keys (pt_test_) answer the /v1 API's sample data only. Connect without a key, or with a live key, for real records.";
  }
  const plan = caller.plan;
  const m = takeMinute(caller.keyId, plan.perMinute);
  if (!m.ok) return `Your ${plan.label} plan allows ${plan.perMinute} calls a minute. Try again in ${m.reset} seconds.`;
  const a = await checkAllowance(caller.account, plan);
  if (!a.ok) {
    return a.which === "day"
      ? `Your ${plan.label} plan's ${plan.perDay} calls today are used. They reset at midnight UTC.`
      : `Your ${plan.label} plan's ${plan.perMonth} calls this month are used. They reset on the first of the month, UTC.`;
  }
  return null;
}

/** Run a read under the caller's limits and turn its answer into tool output. */
async function answer(caller: ApiCaller, e: EndpointDoc, read: () => Promise<ReadResult<unknown>>): Promise<ToolResult> {
  const refused = await admit(caller);
  if (refused) return text(refused, true);
  let r: ReadResult<unknown>;
  try {
    r = await read();
  } catch (err) {
    console.error("[mcp] read failed", err instanceof Error ? err.message : err);
    return text("Something went wrong reading PERM Tracker's records. Try again shortly.", true);
  }
  if (r.ok || r.status === 404) {
    if (caller.kind === "key") countCall(caller.account, caller.keyId);
    else countCall(ANONYMOUS_ACCOUNT, "mcp");
  }
  if (!r.ok) {
    const said = r.url ? `${r.message} ${r.url}` : r.message;
    if (r.status !== 404) return text(said, true);
    // "No such record" is an answer, not a failure: the assistant should say so, not retry. It goes out in the
    // same shape as any answer, with `data.found` false, so a client reading typed output gets it too.
    return {
      content: [{ type: "text", text: said }],
      structuredContent: { source: "PERM Tracker", asOf: null, page: r.url ?? "https://permtracker.app/developers", data: { found: false, message: r.message } },
    };
  }
  // Source, date and page first, so an assistant has what it needs to cite. The same object goes out as text
  // (every client reads that) and as structured content (for clients that take typed output).
  const payload = { source: r.meta.source, asOf: r.meta.asOf, page: r.meta.url, data: (r.data ?? {}) as Record<string, unknown> };
  // The answer goes out whatever its shape. One that misses the shape we publish is our fault to hear about.
  const fits = e.response.schema.safeParse(r.data);
  if (!fits.success) {
    logShapeMiss(toolName(e.id), fits.error.issues.slice(0, 3).map((i) => i.path.join(".") || "(the answer itself)").join(", "));
  }
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }], structuredContent: payload };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type ToolArgs = Record<string, string | number | undefined>;
const str = (v: string | number | undefined): string | null => (v === undefined || v === "" ? null : String(v));

/**
 * What each tool runs: the same function its /v1 endpoint calls, keyed by the operation's id. A read operation
 * in the registry with no runner here fails `buildMcpServer`, and the tests with it.
 */
const RUNNERS: Record<string, (a: ToolArgs) => Promise<ReadResult<unknown>>> = {
  getCase: (a) => readCase(String(a.caseNumber ?? "")),
  findCases: (a) =>
    findCases({ employer: str(a.employer), job: str(a.job), firm: str(a.firm), filed: str(a.filed), from: str(a.from), to: str(a.to), program: str(a.program) }),
  estimateDecision: (a) => readEstimate({ caseNumber: str(a.case), filed: str(a.filed) }),
  getQueue: () => readQueue(),
  getVisaBulletin: (a) => readBulletin(str(a.month)),
  searchEmployers: (a) => searchEntities("employer", String(a.q ?? ""), Number(a.limit ?? SEARCH_DEFAULT)),
  getEmployer: (a) => readEntity("employer", String(a.slug ?? "")),
  searchLawFirms: (a) => searchEntities("attorney", String(a.q ?? ""), Number(a.limit ?? SEARCH_DEFAULT)),
  getLawFirm: (a) => readEntity("attorney", String(a.slug ?? "")),
  searchOccupations: (a) => searchEntities("occupation", String(a.q ?? ""), Number(a.limit ?? SEARCH_DEFAULT)),
  getOccupation: (a) => readEntity("occupation", String(a.slug ?? "")),
  lookupEmployer: (a) => lookupEmployer(String(a.name ?? "")),
  lookupSoc: (a) => lookupSoc(String(a.q ?? "")),
};

/** Results a search tool returns when the assistant names no limit: enough to choose from, small enough to read. */
const SEARCH_DEFAULT = 10;

/** A tool's inputs, from its operation's parameters: the same names, limits and descriptions as the endpoint's. */
function inputSchema(e: EndpointDoc) {
  const shape: Record<string, z.ZodType> = {};
  for (const p of (e.params ?? []).filter((x) => !x.apiOnly)) {
    let field: z.ZodType;
    if (p.enum) {
      field = z.enum(p.enum as [string, ...string[]]);
    } else if (p.type === "integer") {
      let n = z.number().int();
      if (p.minimum !== undefined) n = n.min(p.minimum);
      if (p.maximum !== undefined) n = n.max(p.maximum);
      field = n;
    } else {
      // Length only: a malformed date or number is answered by the read itself, in a sentence that says what
      // to send, which helps an assistant more than a pattern mismatch.
      let t = z.string().max(p.maxLength ?? (p.format === "date" ? 10 : p.format === "month" ? 7 : 120));
      if (p.minLength !== undefined) t = t.min(p.minLength);
      field = t;
    }
    const isSearchLimit = p.name === "limit" && e.id.startsWith("search");
    const text = isSearchLimit ? `Results to return, 1 to 100. ${SEARCH_DEFAULT} when left out.` : p.description;
    field = field.describe(`${text} Example: ${p.example}.`);
    shape[p.name] = p.required ? field : field.optional();
  }
  return z.object(shape);
}

/** "No such record" as data: an answer too, so it has a shape of its own. */
const NotFoundSchema = z
  .object({
    found: z.literal(false).describe("False: no record matched."),
    message: z.string().describe("What wasn't found and what to try, in a sentence."),
  })
  .describe("No such record. Say so; don't retry the same call.");

/**
 * What a tool answers, published in full: where it came from first, so an assistant has what it needs to cite,
 * then the data in the operation's own shape (the one the OpenAPI document publishes), or "no such record".
 *
 * IT DESCRIBES, IT NEVER REFUSES. The server checks a tool's output with this object's `validate`, and a schema
 * that refused would turn a real answer into a failed call the day a read gains a variant. So `validate` passes
 * everything, the JSON Schema is the full one, and `answer` logs any answer that misses it (`logShapeMiss`).
 */
function outputSchema(e: EndpointDoc): StandardSchemaWithJSON {
  const full = z.object({
    source: z.string().describe("Who published the underlying records."),
    asOf: z.string().nullable().describe("The date the data is true for, YYYY-MM-DD, when one applies."),
    page: z.string().describe("The page on permtracker.app that shows the same thing. Cite it."),
    data: z.union([e.response.schema, NotFoundSchema]).describe("The answer, or found: false when no record matched."),
  });
  const { $schema: _drop, ...json } = z.toJSONSchema(full, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  void _drop;
  return {
    "~standard": {
      version: 1,
      vendor: "permtracker",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

function toolDescription(e: EndpointDoc): string {
  const args = Object.fromEntries((e.params ?? []).filter((p) => !p.apiOnly && (p.required || e.example.includes(`${p.name}=`))).map((p) => [p.name, p.example]));
  return `${e.description} Example: ${JSON.stringify(args)}.`;
}

export function buildMcpServer(caller: ApiCaller): McpServer {
  const server = new McpServer(
    { name: "permtracker", title: "PERM Tracker", version: API_VERSION, websiteUrl: "https://permtracker.app/developers" },
    {
      instructions:
        "Federal records on U.S. employment-based immigration: PERM labor certification, prevailing wage requests, " +
        "H-1B LCAs, DOL processing times and the State Department visa bulletin. Every answer names its source and " +
        "the page it came from. Cite that page. Estimates are labelled as estimates and make no promise. " +
        "To read one employer, law firm or occupation, search for it by name first: the search returns the slug the get tool takes.",
      // Every tool takes a few short strings, so a call's arguments never hold
      // more than a handful of keys. Without a cap a 256 KB body of one big
      // array can exhaust memory during validation (GHSA-46jr-4wx8-v453).
      maxToolInputElements: 100,
    },
  );

  for (const e of TOOL_ENDPOINTS) {
    const run = RUNNERS[e.id];
    if (!run) throw new Error(`mcp: the read operation ${e.id} has no runner`);
    server.registerTool(
      toolName(e.id),
      {
        title: e.tool!.title,
        description: toolDescription(e),
        inputSchema: inputSchema(e),
        outputSchema: outputSchema(e),
        annotations: readOnly,
      },
      async (args) => answer(caller, e, () => run(args as ToolArgs)),
    );
  }

  return server;
}

/**
 * A call under a tool name version 1.0 used, as the call it is now. Null for a current name. The route applies it
 * before the server sees the request, so an assistant or a script that learned the old names keeps working while
 * the list shows only the new ones.
 */
export function legacyToolCall(name: string, args: Record<string, unknown> = {}): { name: string; arguments: Record<string, unknown> } | null {
  const kind = String(args.kind ?? "");
  const family = kind === "law firm" ? "law_firm" : kind === "occupation" ? "occupation" : "employer";
  const plural = family === "law_firm" ? "law_firms" : `${family}s`;
  switch (name) {
    case "lookup_case":
      return { name: "get_case", arguments: { caseNumber: args.case_number } };
    case "find_case":
      return { name: "find_cases", arguments: args };
    case "estimate_decision":
      // The same name then and now; only its case argument was renamed.
      return "case_number" in args ? { name, arguments: { case: args.case_number, filed: args.filed } } : null;
    case "queue_status":
      return { name: "get_queue", arguments: {} };
    case "visa_bulletin":
      return { name: "get_visa_bulletin", arguments: { month: args.month } };
    case "search_sponsors":
      return { name: `search_${plural}`, arguments: { q: args.name } };
    case "employer_profile":
      return { name: `get_${family}`, arguments: { slug: args.slug } };
    case "find_soc_code":
      return { name: "lookup_soc", arguments: { q: args.query } };
    default:
      return null;
  }
}
