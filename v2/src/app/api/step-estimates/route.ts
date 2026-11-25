import { NextResponse } from "next/server";

import { easternDay } from "@/lib/time";
import { buildStepFigures } from "@/lib/caseStepFigures";
import type { StepFiguresPayload } from "@/lib/caseStepEstimates";
import { getReportedSummary } from "@/lib/db/reportedSummary";
import { getSampleMonths } from "@/lib/db/uscisSample";
import { getUscisPosted } from "@/lib/db/uscisPosted";

/**
 * GET /api/step-estimates
 *
 * The three kinds of figure for the I-485 and the work permit (src/lib/caseStepFigures.ts): USCIS's posted time, our
 * receipt sample by the month USCIS received each case, and the cases people reported. The case page's green card tab
 * reads it in the browser and works the case's own dates out there, so it takes no case data. Aggregates only.
 *
 * Each source reads on its own: one that fails is named in `unreadable` and the others still answer. With all three
 * failed it answers 503 and says so, never an empty set of figures.
 */

export const dynamic = "force-dynamic";

type Source = StepFiguresPayload["unreadable"][number];

export async function GET() {
  const unreadable: Source[] = [];
  const read = async <T,>(source: Source, run: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await run();
    } catch (e) {
      console.error(`[step-estimates] ${source} read failed`, e);
      unreadable.push(source);
      return null;
    }
  };
  const [posted, sample, summary] = await Promise.all([
    read("posted", getUscisPosted),
    read("sample", getSampleMonths),
    read("reported", getReportedSummary),
  ]);
  if (unreadable.length === 3) {
    return NextResponse.json(
      { ok: false, message: "The figures couldn't be read just now. Try again in a minute." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Keep the sources in one order, whichever failed first.
  unreadable.sort((a, b) => ["posted", "sample", "reported"].indexOf(a) - ["posted", "sample", "reported"].indexOf(b));
  const figures = buildStepFigures({ posted, sample, summary, today: easternDay(), unreadable });
  return NextResponse.json(
    { ok: true, ...figures },
    // The sources change at most a few times a day; a figure an hour behind is the most a reader sees.
    { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" } },
  );
}
