import { NextResponse } from "next/server";

import { getCheckTimes } from "@/lib/db/sweepCoverage";
import { softFail } from "@/lib/softRead";

/**
 * GET /api/sweep-stamp: when our newest check of DOL's record finished (epoch ms), by any pass, the
 * 15-minute daytime pass included: the time pages print as "checked". An open page asks every few minutes
 * (RefreshWhenStale) and redraws itself when this moves. Cloudflare doesn't
 * cache /api (it answers DYNAMIC), so each ask reaches the server: two point
 * reads of the sweep's records, kept for the request. Null when no recent check
 * is on record.
 */
export async function GET() {
  const checks = await getCheckTimes().catch(softFail("api/sweep-stamp/route.getCheckTimes", null));
  return NextResponse.json(
    { checkedAt: checks?.newest ?? null },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } },
  );
}
