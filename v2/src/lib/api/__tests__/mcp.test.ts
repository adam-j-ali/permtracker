import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_PLANS } from "@convex/lib/apiPlans";

const authenticate = vi.fn();
const takeMinute = vi.fn();
const checkAllowance = vi.fn();
const countCall = vi.fn();
const readQueue = vi.fn();
const readCase = vi.fn();
const findCases = vi.fn();
const readEntity = vi.fn();
const searchEntities = vi.fn();
const readEstimate = vi.fn();
const readBulletin = vi.fn();
const lookupEmployer = vi.fn();
vi.mock("../auth", () => ({ authenticate: (...a: unknown[]) => authenticate(...a) }));
vi.mock("../usage", () => ({
  ANONYMOUS_ACCOUNT: "anonymous",
  takeMinute: (...a: unknown[]) => takeMinute(...a),
  checkAllowance: (...a: unknown[]) => checkAllowance(...a),
  countCall: (...a: unknown[]) => countCall(...a),
}));
vi.mock("../reads", () => ({
  readQueue: (...a: unknown[]) => readQueue(...a),
  readCase: (...a: unknown[]) => readCase(...a),
  findCases: (...a: unknown[]) => findCases(...a),
  readBulletin: (...a: unknown[]) => readBulletin(...a),
  readEntity: (...a: unknown[]) => readEntity(...a),
  readEstimate: (...a: unknown[]) => readEstimate(...a),
  searchEntities: (...a: unknown[]) => searchEntities(...a),
}));
vi.mock("../employerLookup", () => ({ lookupEmployer: (...a: unknown[]) => lookupEmployer(...a) }));
const lookupSoc = vi.fn();
vi.mock("../socLookup", () => ({ lookupSoc: (...a: unknown[]) => lookupSoc(...a) }));

import { OPTIONS, POST } from "@/app/mcp/route";
import { legacyToolCall } from "../mcp";
import { ENDPOINTS, LEGACY_TOOLS, MCP_TOOLS, TOOL_ENDPOINTS, toolName } from "../openapi";

const meta = { source: "DOL", asOf: "2026-09-22", url: "https://permtracker.app/perm-processing-times" };

let id = 0;
async function rpc(method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const res = await POST(
    new Request("https://permtracker.app/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
  );
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return { res, body: line ? JSON.parse(line.slice(6)) : text ? JSON.parse(text) : null };
}

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ ok: true, caller: { kind: "anonymous" } });
  takeMinute.mockReset().mockReturnValue({ ok: true, remaining: 100, reset: 30 });
  checkAllowance.mockReset().mockResolvedValue({ ok: true, today: 0, month: 0 });
  countCall.mockReset();
  readQueue.mockReset().mockResolvedValue({ ok: true, data: { perm: { asOf: "2026-09-22" } }, meta });
  readCase.mockReset();
  // Every read starts each test clean and answering: a call count left by another test made one of these
  // order-dependent, which the gate's shuffled run found.
  for (const f of [readEntity, searchEntities, readEstimate, readBulletin, lookupEmployer, lookupSoc, findCases]) {
    f.mockReset().mockResolvedValue({ ok: true, data: {}, meta });
  }
});

describe("the MCP server at /mcp", () => {
  it("lists the documented tools, every one read-only", async () => {
    const { body } = await rpc("tools/list");
    const tools = body.result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("answers a tool call with the source and page first, and counts it to the shared pool", async () => {
    const { body } = await rpc("tools/call", { name: "get_queue", arguments: {} });
    const out = JSON.parse(body.result.content[0].text);
    expect(out).toMatchObject({ source: "DOL", asOf: "2026-09-22", page: meta.url });
    expect(countCall).toHaveBeenCalledWith("anonymous", "mcp");
    // The same object as typed output, for clients that take it.
    expect(body.result.structuredContent).toEqual(out);
  });

  it("finds a job's SOC code through the same read as /v1/lookup/soc", async () => {
    lookupSoc.mockResolvedValue({ ok: true, data: { query: "data scientist", code: null, titles: [{ title: "Data Scientist" }], codes: [] }, meta });
    const { body } = await rpc("tools/call", { name: "lookup_soc", arguments: { q: "data scientist" } });
    expect(lookupSoc).toHaveBeenCalledExactlyOnceWith("data scientist");
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ page: meta.url });
  });

  it("finds a case without its number through the same read as /v1/cases", async () => {
    findCases.mockReset().mockResolvedValue({ ok: true, data: { matched: 1, cases: [{ caseNumber: "G-100-26030-000001" }] }, meta });
    const { body } = await rpc("tools/call", { name: "find_cases", arguments: { employer: "Acme Robotics", filed: "2026-01-30" } });
    // What the assistant left out goes to the read as missing, and the read picks PERM.
    expect(findCases).toHaveBeenCalledExactlyOnceWith({ employer: "Acme Robotics", job: null, firm: null, filed: "2026-01-30", from: null, to: null, program: null });
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ page: meta.url, data: { matched: 1 } });

    await rpc("tools/call", { name: "find_cases", arguments: { employer: "Acme", filed: "2026-01-30", program: "pwd", job: "controls" } });
    expect(findCases).toHaveBeenLastCalledWith({ employer: "Acme", job: "controls", firm: null, filed: "2026-01-30", from: null, to: null, program: "pwd" });

    // No employer at all: a job title and a law firm over a range of days is an ask of its own.
    await rpc("tools/call", { name: "find_cases", arguments: { job: "controls engineer", firm: "Smith Immigration", from: "2026-01-05", to: "2026-02-28" } });
    expect(findCases).toHaveBeenLastCalledWith({ employer: null, job: "controls engineer", firm: "Smith Immigration", filed: null, from: "2026-01-05", to: "2026-02-28", program: null });
  });

  it("tells the assistant when the shared pool is full, and reads nothing", async () => {
    takeMinute.mockReturnValue({ ok: false, remaining: 0, reset: 12 });
    const { body } = await rpc("tools/call", { name: "get_queue", arguments: {} });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("12 seconds");
    expect(readQueue).not.toHaveBeenCalled();
  });

  it("holds a key to its own plan and counts the call to it", async () => {
    authenticate.mockResolvedValue({
      ok: true,
      caller: { kind: "key", keyId: "KEY00001", account: "acct_a", plan: API_PLANS.free, accountPlan: "free", paywall: true },
    });
    checkAllowance.mockResolvedValue({ ok: false, which: "month", today: 1, month: 3000, retryAfter: 99 });
    const { body } = await rpc("tools/call", { name: "get_queue", arguments: {} }, { authorization: "Bearer x" });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("this month are used");
    expect(takeMinute).toHaveBeenCalledWith("KEY00001", API_PLANS.free.perMinute);
  });

  it("refuses a sandbox key's tool call, reading and counting nothing", async () => {
    authenticate.mockResolvedValue({
      ok: true,
      caller: { kind: "key", keyId: "TEST0001", account: "acct_a", plan: API_PLANS.plus, accountPlan: "free", paywall: false, sandbox: true },
    });
    const { body } = await rpc("tools/call", { name: "get_queue", arguments: {} }, { authorization: "Bearer x" });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("Sandbox keys");
    expect(readQueue).not.toHaveBeenCalled();
    expect(takeMinute).not.toHaveBeenCalled();
  });

  it("returns a not-found as an answer, not an error", async () => {
    readCase.mockResolvedValue({ ok: false, status: 404, code: "not_found", message: "No record of this case yet.", url: "u" });
    const { body } = await rpc("tools/call", { name: "get_case", arguments: { caseNumber: "G-100-26045-123456" } });
    expect(body.result.isError).toBeUndefined();
    expect(body.result.content[0].text).toContain("No record");
    // In the same shape as any answer, saying nothing was found, so typed output carries it too.
    expect(body.result.structuredContent).toMatchObject({ page: "u", data: { found: false } });
  });

  it("refuses a call whose arguments hold thousands of elements before validating them", async () => {
    const big = Array.from({ length: 5_000 }, () => 0);
    const { body } = await rpc("tools/call", { name: "get_case", arguments: { caseNumber: "G-100-26045-123456", big } });
    expect(body.result.isError).toBe(true);
    expect(readCase).not.toHaveBeenCalled();
  });

  it("refuses a wrong key outright with 401", async () => {
    authenticate.mockResolvedValue({ ok: false, code: "invalid_key", message: "That isn't a key." });
    const { res } = await rpc("tools/list", {}, { authorization: "Bearer nope" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("answers a browser's preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});

describe("the tools are the API's read operations", () => {
  type Listed = { name: string; title?: string; description?: string; inputSchema: { properties?: Record<string, { description?: string }>; required?: string[] }; outputSchema?: unknown };

  it("lists each read operation as one tool, with its title, its description and typed output", async () => {
    const { body } = await rpc("tools/list");
    const tools = body.result.tools as Listed[];
    expect(tools.map((t) => t.name)).toEqual(TOOL_ENDPOINTS.map((e) => toolName(e.id)));
    for (const e of TOOL_ENDPOINTS) {
      const t = tools.find((x) => x.name === toolName(e.id))!;
      expect(t.title, e.id).toBe(e.tool!.title);
      expect(t.description, e.id).toContain(e.description);
      expect(t.outputSchema, e.id).toBeTruthy();
    }
  });

  it("takes the endpoint's own parameters, by the same names, and marks the same ones required", async () => {
    const { body } = await rpc("tools/list");
    const tools = body.result.tools as Listed[];
    for (const e of TOOL_ENDPOINTS) {
      const t = tools.find((x) => x.name === toolName(e.id))!;
      const offered = (e.params ?? []).filter((p) => !p.apiOnly);
      expect(Object.keys(t.inputSchema.properties ?? {}).sort(), e.id).toEqual(offered.map((p) => p.name).sort());
      expect([...(t.inputSchema.required ?? [])].sort(), e.id).toEqual(offered.filter((p) => p.required).map((p) => p.name).sort());
      for (const p of offered) expect(t.inputSchema.properties?.[p.name]?.description, `${e.id} ${p.name}`).toBeTruthy();
    }
    // A live DOL lookup needs a scope a tool call can't hold, so the tool doesn't offer it.
    expect(Object.keys(tools.find((t) => t.name === "get_case")!.inputSchema.properties ?? {})).toEqual(["caseNumber"]);
  });

  it("has a runner for every read operation: each tool answers", async () => {
    readCase.mockResolvedValue({ ok: true, data: {}, meta });
    findCases.mockReset().mockResolvedValue({ ok: true, data: {}, meta });
    lookupSoc.mockReset().mockResolvedValue({ ok: true, data: {}, meta });
    for (const e of TOOL_ENDPOINTS) {
      const args = Object.fromEntries((e.params ?? []).filter((p) => p.required && !p.apiOnly).map((p) => [p.name, p.example]));
      const { body } = await rpc("tools/call", { name: toolName(e.id), arguments: args });
      expect(body.result?.isError, `${e.id}: ${JSON.stringify(body.error ?? body.result?.content)}`).toBeUndefined();
    }
  });

  it("reads the right kind for each search and get tool", async () => {
    await rpc("tools/call", { name: "search_law_firms", arguments: { q: "fragomen" } });
    expect(searchEntities).toHaveBeenLastCalledWith("attorney", "fragomen", 10);
    await rpc("tools/call", { name: "search_occupations", arguments: { q: "software", limit: 3 } });
    expect(searchEntities).toHaveBeenLastCalledWith("occupation", "software", 3);
    await rpc("tools/call", { name: "get_employer", arguments: { slug: "google-llc" } });
    expect(readEntity).toHaveBeenLastCalledWith("employer", "google-llc");
    await rpc("tools/call", { name: "get_occupation", arguments: { slug: "software-developers" } });
    expect(readEntity).toHaveBeenLastCalledWith("occupation", "software-developers");
    await rpc("tools/call", { name: "lookup_employer", arguments: { name: "Google" } });
    expect(lookupEmployer).toHaveBeenLastCalledWith("Google");
    await rpc("tools/call", { name: "estimate_decision", arguments: { case: "G-100-26045-123456" } });
    expect(readEstimate).toHaveBeenLastCalledWith({ caseNumber: "G-100-26045-123456", filed: null });
  });

  it("offers no tool for an operation that changes something or needs a scope", () => {
    const tools = new Set(MCP_TOOLS.map((t) => t.name));
    for (const e of ENDPOINTS.filter((x) => x.method || x.scope)) expect(tools.has(toolName(e.id)), e.id).toBe(false);
  });
});

describe("a call under a tool name version 1.0 used is still answered", () => {
  it("answers each old name as the tool it is now, with its arguments renamed", async () => {
    readCase.mockResolvedValue({ ok: true, data: {}, meta });
    await rpc("tools/call", { name: "lookup_case", arguments: { case_number: "G-100-26045-123456" } });
    expect(readCase).toHaveBeenLastCalledWith("G-100-26045-123456");
    await rpc("tools/call", { name: "queue_status", arguments: {} });
    expect(readQueue).toHaveBeenCalled();
    await rpc("tools/call", { name: "visa_bulletin", arguments: { month: "2026-10" } });
    expect(readBulletin).toHaveBeenLastCalledWith("2026-10");
    await rpc("tools/call", { name: "search_sponsors", arguments: { kind: "law firm", name: "Fragomen" } });
    expect(searchEntities).toHaveBeenLastCalledWith("attorney", "Fragomen", 10);
    await rpc("tools/call", { name: "employer_profile", arguments: { kind: "occupation", slug: "software-developers" } });
    expect(readEntity).toHaveBeenLastCalledWith("occupation", "software-developers");
    await rpc("tools/call", { name: "employer_profile", arguments: { kind: "employer", slug: "google-llc" } });
    expect(readEntity).toHaveBeenLastCalledWith("employer", "google-llc");
    lookupSoc.mockResolvedValue({ ok: true, data: {}, meta });
    await rpc("tools/call", { name: "find_soc_code", arguments: { query: "data scientist" } });
    expect(lookupSoc).toHaveBeenLastCalledWith("data scientist");
    findCases.mockReset().mockResolvedValue({ ok: true, data: {}, meta });
    await rpc("tools/call", { name: "find_case", arguments: { employer: "Acme" } });
    expect(findCases).toHaveBeenCalledTimes(1);
    await rpc("tools/call", { name: "estimate_decision", arguments: { case_number: "G-100-26045-123456" } });
    expect(readEstimate).toHaveBeenLastCalledWith({ caseNumber: "G-100-26045-123456", filed: null });
  });

  it("maps every retired name, and leaves a current name alone", () => {
    for (const old of Object.keys(LEGACY_TOOLS)) {
      const now = legacyToolCall(old, { kind: "employer" });
      expect(now, old).not.toBeNull();
      expect(MCP_TOOLS.map((t) => t.name), old).toContain(now!.name);
    }
    for (const t of MCP_TOOLS) {
      if (t.name === "estimate_decision") continue;
      expect(legacyToolCall(t.name, { q: "x" }), t.name).toBeNull();
    }
    expect(legacyToolCall("estimate_decision", { filed: "2026-01-15" })).toBeNull();
  });

  it("still knows every name version 1.0 shipped, in the list the docs print and in the mapping", () => {
    // The eight tools version 1.0 registered, written out: a name leaving either place breaks whoever learned it.
    const shipped = ["lookup_case", "find_case", "estimate_decision", "queue_status", "visa_bulletin", "search_sponsors", "employer_profile", "find_soc_code"];
    const current = new Set(MCP_TOOLS.map((t) => t.name));
    for (const name of shipped) {
      if (current.has(name)) continue;
      expect(Object.keys(LEGACY_TOOLS), `${name} is missing from the docs' list`).toContain(name);
      expect(legacyToolCall(name, { kind: "employer" }), `${name} is no longer answered`).not.toBeNull();
    }
    expect(Object.keys(LEGACY_TOOLS).sort()).toEqual(shipped.filter((n) => !current.has(n)).sort());
  });

  it("lists only the current names", async () => {
    const { body } = await rpc("tools/list");
    const names = (body.result.tools as { name: string }[]).map((t) => t.name);
    for (const old of Object.keys(LEGACY_TOOLS)) expect(names, old).not.toContain(old);
  });

  it("leaves every other message as it was sent", async () => {
    const { body } = await rpc("tools/call", { name: "no_such_tool", arguments: {} });
    expect(JSON.stringify(body)).toMatch(/no_such_tool|not found|Unknown/i);
  });
});
