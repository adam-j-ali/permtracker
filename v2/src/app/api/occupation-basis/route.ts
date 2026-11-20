import { NextResponse } from "next/server";

import { occupationsForSoc } from "@/lib/db/reference";
import { SOC_CODE_RE, socGroup } from "@/lib/socCode";
import { degreeOf } from "@/lib/wageLevelEstimate";

/**
 * GET /api/occupation-basis?soc=15-1252
 *
 * DOL's Job Zone, usual education and Appendix A status for every O*NET occupation under one job code, from the
 * newest yearly table we store (scripts/ingest_oflc_wages.py): what the wage level estimate on /tools/wage-levels
 * compares a job's requirements against. An occupation whose Job Zone or education DOL's table leaves blank, or names
 * in a way the reader doesn't know, is returned with `usable: false` rather than dropped, so the page can say why.
 * Read only from our own database; cached a day, since the table changes once a year.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const soc = new URL(request.url).searchParams.get("soc") ?? "";
  if (!SOC_CODE_RE.test(soc.trim())) {
    return NextResponse.json({ ok: false, message: "Expected a job code like 15-1252." }, { status: 400 });
  }
  try {
    const { wageYear, occupations } = await occupationsForSoc(soc.trim());
    return NextResponse.json(
      {
        ok: true,
        soc: socGroup(soc.trim()),
        wageYear,
        occupations: occupations.map((o) => {
          const education = degreeOf(o.education);
          const jobZone = o.jobZone !== null && o.jobZone >= 1 && o.jobZone <= 5 ? o.jobZone : null;
          return { onetCode: o.onetCode, title: o.title, jobZone, education, appendixA: o.appendixA, usable: jobZone !== null && education !== null };
        }),
      },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    console.error("[occupation-basis] DOL's occupation table couldn't be read", { soc: socGroup(soc.trim()), error: String(e) });
    return NextResponse.json(
      { ok: false, message: "DOL's occupation table couldn't be read just now. Try again in a minute." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
