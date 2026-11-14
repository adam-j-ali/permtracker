import { NextResponse } from "next/server";

import { API_BASE, API_VERSION, ENDPOINTS, MCP_URL, toolName } from "@/lib/api/openapi";
import { DOCS_URL } from "@/lib/api/route";

export const dynamic = "force-static";

/** What's here. No key needed. */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      name: "PERM Tracker API",
      version: API_VERSION,
      docs: DOCS_URL,
      openapi: `${API_BASE}/openapi.json`,
      health: `${API_BASE}/health`,
      mcp: MCP_URL,
      auth: "Authorization: Bearer <key>. Make a free key in Settings, under API keys.",
      endpoints: ENDPOINTS.map((e) => ({
        operationId: e.id,
        method: e.method ?? "GET",
        path: e.path,
        group: e.tag,
        summary: e.summary,
        description: e.description,
        example: `${API_BASE}${e.example}`,
        key: e.keyless ? "none" : e.scope ? `needs the ${e.scope} scope` : "needed",
        ...(e.tool ? { tool: toolName(e.id) } : {}),
      })),
    },
    // Readable from a browser on any site, like the OpenAPI document: it describes the API and holds no data.
    { headers: { "X-Robots-Tag": "noindex", "Access-Control-Allow-Origin": "*" } },
  );
}
