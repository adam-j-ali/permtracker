/**
 * Every /v1 route, checked against the same few rules.
 *
 * The spec test holds the routes to the registry (paths and methods). This holds how each one behaves at its
 * edges: who it lets in, what a browser on another site may read, and what an address that isn't an endpoint
 * gets back.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "@/lib/api/openapi";
import { ProblemSchema } from "@/lib/api/schemas";

import { DELETE, GET, PATCH, POST, PUT } from "../[...unknown]/route";
import { GET as index } from "../route";

const V1 = join(__dirname, "..");

function routeFiles(dir: string, at = ""): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "__tests__") continue;
    if (statSync(full).isDirectory()) out.push(...routeFiles(full, `${at}/${entry.replace(/^\[(.+)\]$/, "{$1}")}`));
    else if (entry === "route.ts") out.push({ path: at || "/", src: readFileSync(full, "utf8") });
  }
  return out;
}

const ROUTES = routeFiles(V1);
/** The three that describe the API and hold no data, and the catch-all. */
const DESCRIBING = new Set(["/", "/openapi.json", "/health"]);
const CATCH_ALL = "/{...unknown}";
const keylessPaths = new Set(ENDPOINTS.filter((e) => e.keyless && e.path !== "/health").map((e) => e.path));

describe("every /v1 route follows the same rules", () => {
  it("found the routes (control)", () => {
    expect(ROUTES.length).toBeGreaterThan(20);
    expect(ROUTES.map((r) => r.path)).toContain(CATCH_ALL);
  });

  it("lets a call in through one of the shared doors, never a check written in the route", () => {
    const doors = /apiGet(?:<[^>]*>)?\(|entitySearchRoute\(|entityBySlugRoute\(|keylessGet\(|admitKeyed\(|authenticate\(|from "@\/lib\/api\/webhooksApi"/;
    for (const r of ROUTES) {
      if (DESCRIBING.has(r.path) || r.path === CATCH_ALL) continue;
      expect(doors.test(r.src), `${r.path} admits calls its own way`).toBe(true);
    }
  });

  it("answers a preflight on the keyless lookups, and on no route that takes a key", () => {
    for (const r of ROUTES) {
      const hasOptions = /export const OPTIONS\b|export (?:async )?function OPTIONS\b/.test(r.src);
      expect(hasOptions, `${r.path} OPTIONS`).toBe(keylessPaths.has(r.path));
    }
  });

  it("lets a browser on any site read the three that describe the API, and no route that returns records", () => {
    for (const r of ROUTES) {
      const open = /"Access-Control-Allow-Origin": "\*"/.test(r.src);
      expect(open, `${r.path} Access-Control-Allow-Origin: *`).toBe(DESCRIBING.has(r.path));
    }
  });

  it("keeps every route out of search engines", () => {
    // The shared doors set the header; a route that answers by hand sets it itself.
    const byHand = ROUTES.filter((r) => /NextResponse\.json\(|new Response\(/.test(r.src));
    expect(byHand.length).toBeGreaterThan(2);
    for (const r of byHand) expect(r.src.includes('"X-Robots-Tag": "noindex"'), r.path).toBe(true);
  });

  it("is rendered on demand wherever a key or a query changes the answer", () => {
    for (const r of ROUTES) {
      const dynamic = /export const dynamic = "(force-dynamic|force-static)"/.exec(r.src)?.[1];
      expect(dynamic, r.path).toBe(DESCRIBING.has(r.path) ? "force-static" : "force-dynamic");
    }
  });
});

describe("the API's index", () => {
  it("can be read from a browser on any site", () => {
    expect(index().headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("lists every operation with its method, group, key and tool", async () => {
    const body = (await index().json()) as { endpoints: { operationId: string; method: string; key: string; tool?: string }[] };
    expect(body.endpoints.map((e) => e.operationId)).toEqual(ENDPOINTS.map((e) => e.id));
    expect(body.endpoints.find((e) => e.operationId === "createWebhook")).toMatchObject({ method: "POST", key: "needs the webhooks scope" });
    expect(body.endpoints.find((e) => e.operationId === "lookupSoc")).toMatchObject({ key: "none", tool: "lookup_soc" });
  });
});

describe("an address under /v1 that isn't an endpoint", () => {
  it("answers 404 as a problem document for every method, never the site's HTML page", async () => {
    for (const handler of [GET, POST, PUT, PATCH, DELETE]) {
      // Act
      const res = handler();
      const body = (await res.json()) as Record<string, unknown>;
      // Assert
      expect(res.status).toBe(404);
      expect(res.headers.get("Content-Type")).toContain("application/problem+json");
      expect(ProblemSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({ code: "unknown_endpoint", status: 404 });
      expect(String(body.detail)).toContain("https://permtracker.app/v1");
    }
  });

  it("is told apart from a record that doesn't exist", async () => {
    const body = (await GET().json()) as { code: string };
    expect(body.code).not.toBe("not_found");
  });
});
