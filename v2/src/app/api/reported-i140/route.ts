import { NextResponse } from "next/server";

import { getReportedSummary } from "@/lib/db/reportedSummary";

/**
 * The I-140s people reported, by category and premium processing (the hourly build's figures), for a saved case's
 * I-140 tab to compare with. The same figures for every case, so the case itself is never sent.
 */
export async function GET() {
  try {
    const summary = await getReportedSummary();
    if (!summary) {
      return NextResponse.json(
        { ok: false, message: "The reported I-140 figures aren't built yet." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: true, today: summary.today, i140: summary.i140 },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
    );
  } catch (e) {
    console.error("[reported-i140] the reported summary couldn't be read", { error: String(e) });
    return NextResponse.json(
      { ok: false, message: "The reported I-140 figures couldn't be read just now." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
