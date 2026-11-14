import { NextResponse } from "next/server";

import { API_BASE, DEVELOPERS_URL } from "@/lib/api/addresses";
import { API_VERSION } from "@/lib/api/openapi";

export const dynamic = "force-static";

/**
 * Whether the API is up. No key, never counted, and no read of any record: it
 * says the API is serving, and nothing about one dataset's freshness (each
 * answer's `meta.asOf` says that).
 */
export function GET(): NextResponse {
  return NextResponse.json(
    { status: "ok", version: API_VERSION, docs: DEVELOPERS_URL, openapi: `${API_BASE}/openapi.json` },
    { headers: { "X-Robots-Tag": "noindex", "Access-Control-Allow-Origin": "*" } },
  );
}
