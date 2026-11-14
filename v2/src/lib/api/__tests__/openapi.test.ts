import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { API_ERRORS, errorAnchor } from "../errors";
import { ENDPOINTS, LEGACY_TOOLS, MCP_TOOLS, TAGS, TOOL_ENDPOINTS, openApiDocument, toolName } from "../openapi";
import { sandboxAnswer } from "../sandbox";
import { MetaSchema, ProblemSchema } from "../schemas";

const ROOT = join(__dirname, "..", "..", "..", "..");
const V1 = join(ROOT, "src", "app", "v1");

/** Every route under src/app/v1, as an OpenAPI path ("[slug]" becomes "{slug}"). */
function routePaths(): string[] {
  const out: string[] = [];
  const walk = (dir: string, path: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      const next = `${path}/${entry.replace(/^\[(.+)\]$/, "{$1}")}`;
      if (readdirSync(full).includes("route.ts")) out.push(next);
      walk(full, next);
    }
  };
  walk(V1, "");
  return out.sort();
}

describe("the API description matches the API", () => {
  it("found the routes", () => {
    expect(routePaths().length).toBeGreaterThan(8);
  });

  it("describes every route, and every described path has a route", () => {
    // The spec itself and the index describe the API rather than being part of it.
    const routes = routePaths().filter((p) => p !== "/openapi.json");
    expect([...new Set(ENDPOINTS.map((e) => e.path))].sort()).toEqual(routes);
  });

  it("puts every endpoint in the OpenAPI document", () => {
    const doc = openApiDocument() as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.paths).sort()).toEqual([...new Set(ENDPOINTS.map((e) => e.path))].sort());
    for (const e of ENDPOINTS) {
      expect(doc.paths[e.path]?.[(e.method ?? "GET").toLowerCase()], `${e.method ?? "GET"} ${e.path}`).toBeDefined();
    }
  });

  it("gives every route file a handler for each method the spec describes, and no other", () => {
    for (const path of routePaths().filter((p) => p !== "/openapi.json")) {
      const file = join(V1, ...path.split("/").filter(Boolean).map((seg) => seg.replace(/^\{(.+)\}$/, "[$1]")), "route.ts");
      const src = readFileSync(file, "utf8");
      const exported = [...src.matchAll(/export (?:const|async function|function) (GET|POST|DELETE|PUT|PATCH)\b/g)].map((m) => m[1]).sort();
      const described = ENDPOINTS.filter((e) => e.path === path).map((e) => e.method ?? "GET").sort();
      expect(exported, path).toEqual(described);
    }
  });

});

type Doc = {
  info: Record<string, unknown>;
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, Op>>;
  components: { schemas: Record<string, unknown>; responses: Record<string, { content: Record<string, { example: unknown }> }>; securitySchemes: Record<string, unknown> };
};
type Op = {
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  parameters: { name: string; description: string; schema: Record<string, unknown>; example: unknown }[];
  requestBody?: { content: Record<string, { schema: Record<string, unknown>; example: unknown }> };
  responses: Record<string, { $ref?: string; content?: Record<string, { schema: unknown; example: unknown }> }>;
};

const doc = openApiDocument() as unknown as Doc;
const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })));

describe("every operation is described in full", () => {
  it("names each operation once, in camelCase, and never renames one", () => {
    const ids = ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z][a-zA-Z]+$/);
    // The names version 1.1 shipped. Adding one is fine; a name that leaves this list broke somebody's client.
    for (const shipped of [
      "getCase", "findCases", "estimateDecision", "getQueue", "getVisaBulletin", "searchEmployers", "getEmployer",
      "searchLawFirms", "getLawFirm", "searchOccupations", "getOccupation", "lookupEmployer", "lookupSoc",
      "exportRecords", "listWebhooks", "createWebhook", "deleteWebhook", "listWatches", "createWatch", "deleteWatch",
      "getMe", "getHealth",
    ]) {
      expect(ids, shipped).toContain(shipped);
    }
  });

  it("gives each one its operationId, one known tag, a short summary and a full description", () => {
    const tags = TAGS.map((t) => t.name) as string[];
    for (const { path, method, op } of ops) {
      const where = `${method} ${path}`;
      expect(op.operationId, where).toBeTruthy();
      expect(op.tags, where).toHaveLength(1);
      expect(tags, where).toContain(op.tags[0]);
      expect(op.summary.length, `${where}: a summary is a few words`).toBeLessThanOrEqual(60);
      expect(op.summary, where).not.toMatch(/\.$/);
      expect(op.description.length, `${where}: a description says how to use it`).toBeGreaterThan(80);
    }
  });

  it("describes every tag, and uses every tag", () => {
    expect(doc.tags.map((t) => t.name)).toEqual(TAGS.map((t) => t.name));
    for (const t of doc.tags) expect(t.description.length, t.name).toBeGreaterThan(30);
    for (const t of TAGS) expect(ENDPOINTS.some((e) => e.tag === t.name), t.name).toBe(true);
  });

  it("gives every parameter a description, a typed schema and an example that fits it", () => {
    for (const { path, method, op } of ops) {
      for (const p of op.parameters) {
        const where = `${method} ${path} ${p.name}`;
        expect(p.description.length, where).toBeGreaterThan(8);
        expect(p.schema.type, where).toMatch(/^(string|integer)$/);
        expect(p.example, where).not.toBeUndefined();
        expect(typeof p.example, where).toBe(p.schema.type === "integer" ? "number" : "string");
        const s = p.schema as { enum?: string[]; pattern?: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
        if (s.enum) expect(s.enum, where).toContain(p.example);
        if (s.pattern) expect(String(p.example), where).toMatch(new RegExp(s.pattern));
        if (s.minLength !== undefined) expect(String(p.example).length, where).toBeGreaterThanOrEqual(s.minLength);
        if (s.maxLength !== undefined) expect(String(p.example).length, where).toBeLessThanOrEqual(s.maxLength);
        if (s.minimum !== undefined) expect(p.example as number, where).toBeGreaterThanOrEqual(s.minimum);
        if (s.maximum !== undefined) expect(p.example as number, where).toBeLessThanOrEqual(s.maximum);
      }
    }
  });

  it("names every path parameter in its path, and the other way round", () => {
    for (const e of ENDPOINTS) {
      const inPath = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = (e.params ?? []).filter((p) => p.in === "path").map((p) => p.name).sort();
      expect(declared, e.id).toEqual(inPath);
      for (const p of (e.params ?? []).filter((x) => x.in === "path")) expect(p.required, `${e.id} ${p.name}`).toBe(true);
    }
  });

  it("holds every answer's example to its schema", () => {
    for (const e of ENDPOINTS) {
      const parsed = e.response.schema.safeParse(e.response.example);
      expect(parsed.success, `${e.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
      if (e.response.meta) expect(MetaSchema.safeParse(e.response.meta).success, e.id).toBe(true);
    }
  });

  it("holds every request body's example to its schema", () => {
    for (const e of ENDPOINTS.filter((x) => x.body)) {
      expect(e.body!.schema.safeParse(e.body!.example).success, e.id).toBe(true);
    }
  });

  it("publishes each answer's schema once, by name, with every named field described", () => {
    for (const e of ENDPOINTS) expect(doc.components.schemas[e.response.schemaName], e.id).toBeDefined();
    const undescribed: string[] = [];
    const walk = (node: unknown, at: string) => {
      if (!node || typeof node !== "object") return;
      const n = node as { properties?: Record<string, { description?: string }>; items?: unknown; anyOf?: unknown[] };
      for (const [name, prop] of Object.entries(n.properties ?? {})) {
        const inner = prop as { description?: string; anyOf?: { description?: string }[] };
        const described = Boolean(inner.description) || (inner.anyOf ?? []).some((x) => x.description);
        if (!described) undescribed.push(`${at}.${name}`);
        walk(prop, `${at}.${name}`);
      }
      walk(n.items, `${at}[]`);
      for (const x of n.anyOf ?? []) walk(x, at);
    };
    for (const [name, schema] of Object.entries(doc.components.schemas)) walk(schema, name);
    // A few leaves carry their meaning in the parent's sentence (a pair of counts, a name and its code).
    expect(undescribed, "every named field says what it is").toEqual([]);
  });

  it("answers every refusal as a problem document, under a shared response per status", () => {
    for (const { path, method, op } of ops) {
      if (op.operationId === "getHealth") continue;
      for (const status of ["400", "404", "429", "500", "503"]) {
        expect(op.responses[status]?.$ref, `${method} ${path} ${status}`).toMatch(/^#\/components\/responses\//);
      }
    }
    for (const [name, r] of Object.entries(doc.components.responses)) {
      const body = r.content["application/problem+json"];
      expect(body, name).toBeDefined();
      expect(ProblemSchema.safeParse(body!.example).success, name).toBe(true);
    }
  });

  it("says who may call each one: a key by default, none for the keyless three", () => {
    const keyless = ops.filter(({ op }) => (op as unknown as { security?: unknown[] }).security?.length === 0).map(({ op }) => op.operationId).sort();
    expect(keyless).toEqual(["getHealth", "lookupEmployer", "lookupSoc"]);
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(["apiKeyHeader", "bearer"]);
  });

  it("carries a licence, the terms, a contact and a version", () => {
    expect(doc.info.license).toBeTruthy();
    expect(doc.info.termsOfService).toBe("https://permtracker.app/api-terms");
    expect(doc.info.contact).toBeTruthy();
    expect(String(doc.info.version)).toMatch(/^1\.\d+\.\d+$/);
  });
});

describe("the sandbox answers in the documented shape", () => {
  it("gives every shared sample an answer that fits its endpoint's schema", () => {
    for (const e of ENDPOINTS.filter((x) => !x.sandboxOwn && !x.keyless)) {
      const params = Object.fromEntries(
        [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => [m[1]!, m[1] === "caseNumber" ? "G-100-26000-000101" : SAMPLE_SLUG[e.id] ?? "x"]),
      );
      const path = e.path.replace(/\{(\w+)\}/g, (_, k: string) => params[k]!);
      const query = e.path.includes("{") ? "" : e.example.includes("?") ? `?${e.example.split("?")[1]}` : "";
      const r = sandboxAnswer(new URL(`https://permtracker.app/v1${path}${query}`), params);
      expect(r.ok, `${e.id} ${path}${query}`).toBe(true);
      if (!r.ok) continue;
      const parsed = e.response.schema.safeParse(r.data);
      expect(parsed.success, `${e.id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
      expect(MetaSchema.safeParse(r.meta).success, e.id).toBe(true);
    }
  });
});

const SAMPLE_SLUG: Record<string, string> = {
  getEmployer: "example-robotics-llc",
  getLawFirm: "sample-partners-llp",
  getOccupation: "software-developers",
};

describe("the assistant tools come from the same registry", () => {
  it("offers one tool per read operation, named after it", () => {
    expect(TOOL_ENDPOINTS.length).toBeGreaterThan(8);
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(TOOL_ENDPOINTS.map((e) => toolName(e.id)));
    for (const t of MCP_TOOLS) expect(t.name, t.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(toolName("getVisaBulletin")).toBe("get_visa_bulletin");
  });

  it("offers no tool that changes anything or needs a scope", () => {
    for (const e of TOOL_ENDPOINTS) {
      expect(e.method ?? "GET", e.id).toBe("GET");
      expect(e.scope, e.id).toBeUndefined();
    }
  });

  it("registers no tool by hand: the server builds them from the registry", () => {
    const src = readFileSync(join(ROOT, "src", "lib", "api", "mcp.ts"), "utf8");
    expect(src).toContain("TOOL_ENDPOINTS");
    expect([...src.matchAll(/registerTool\(\s*"/g)]).toHaveLength(0);
  });

  it("keeps a new name for every tool name version 1.0 used", () => {
    const now = new Set(MCP_TOOLS.map((t) => t.name));
    for (const [old, next] of Object.entries(LEGACY_TOOLS)) {
      expect(now.has(old), `${old} is still a current name`).toBe(false);
      for (const name of next.split(/, | or /)) expect(now.has(name), `${old} -> ${name}`).toBe(true);
    }
  });
});

describe("the error catalogue is the errors", () => {
  it("lists every code the API's own source sends", () => {
    const sources = [
      ...readdirSync(join(ROOT, "src", "lib", "api")).filter((f) => f.endsWith(".ts")).map((f) => join(ROOT, "src", "lib", "api", f)),
      ...routeFiles(V1),
    ];
    const sent = new Set<string>();
    for (const file of sources) {
      if (file.endsWith("errors.ts") || file.endsWith("openapi.ts")) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/apiError\(\s*\d+,\s*"([a-z_]+)"/g)) sent.add(m[1]!);
      for (const m of src.matchAll(/status: (?:4|5)\d\d(?: as const)?,\s*code: "([a-z_]+)"/g)) sent.add(m[1]!);
      for (const m of src.matchAll(/code: "([a-z_]+)" as const/g)) sent.add(m[1]!);
    }
    expect(sent.size).toBeGreaterThan(12);
    const known = new Set(API_ERRORS.map((e) => e.code));
    expect([...sent].filter((c) => !known.has(c)).sort(), "a code the catalogue doesn't list").toEqual([]);
  });

  it("gives each code one entry, a title and a meaning, and an anchor of its own", () => {
    const codes = API_ERRORS.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    const anchors = codes.map(errorAnchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const e of API_ERRORS) {
      expect(e.title.length, e.code).toBeGreaterThan(6);
      expect(e.meaning.length, e.code).toBeGreaterThan(30);
    }
  });
});

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

