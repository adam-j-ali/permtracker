import { NextResponse } from "next/server";

import { STAGE_FEED_MAX } from "./limits";

import { stageFromSlug, stageMeta } from "@/components/rfi/stageMeta";
import { LISTABLE_STAGE_MAX, getStageHistory } from "@/lib/db/rfi";
import { getSweepCoverage } from "@/lib/db/sweepCoverage";
import { softFail } from "@/lib/softRead";

/**
 * Every case at one review stage, as JSON or CSV: the ones waiting there now (`kind=waiting`, the default) or
 * the ones that left it since our record began (`kind=answered`), each with where its wait started.
 *
 * This is the data half of the stage browser: the static stage page seeds the
 * table with the oldest rows and the browser asks here for the whole cohort
 * when someone searches, sorts or pages past the seed. The stage comes from
 * the same registry the pages are built from, so a slug that has no page
 * cannot have a feed, and analyst review (over the listable ceiling, split by
 * filing month on `/perm-queue`) answers 400 with the reason rather than a
 * 90,000-row body.
 *
 * Cost: one index-bounded read per stage per six hours at the edge, whatever
 * the traffic. The read is `case_status_stage (current_status, is_final,
 * filing_date)`, the same one the page uses, so the count here and the count
 * on the page cannot come from different populations.
 */

function csvResponse(lines: string[], filename: string, cacheHeaders: Record<string, string>): NextResponse {
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      ...cacheHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" };

function bad(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Where a wait's start came from, in words a spreadsheet reader can use. */
const FROM_WORDS: Record<string, string> = { seen: "our daily check", denied: "DOL denial date", unknown: "" };

function csvCell(v: string | number | null): string {
  if (typeof v === "number") return String(v);
  if (v === null || v === "") return "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const slug = (p.get("stage") ?? "").trim().toLowerCase();
  if (!slug || slug.length > 60 || !/^[a-z0-9-]+$/.test(slug)) return bad("stage must be a stage slug");
  const status = stageFromSlug(slug);
  if (!status) return bad("unknown stage", 404);
  const format = (p.get("format") ?? "json").trim().toLowerCase();
  if (format !== "json" && format !== "csv") return bad("format must be json or csv");
  const kind = (p.get("kind") ?? "waiting").trim().toLowerCase();
  if (kind !== "waiting" && kind !== "answered") return bad("kind must be waiting or answered");

  const [history, sweep] = await Promise.all([
    getStageHistory(status, STAGE_FEED_MAX),
    getSweepCoverage().catch(softFail("api/stage-cases/route.getSweepCoverage", null)),
  ]);
  const rows = history.cases;
  if (rows.length > LISTABLE_STAGE_MAX) {
    return bad("this stage is above the listable size, so it's split by filing month on /perm-queue", 400);
  }
  const asOf = sweep?.finishedOn ?? null;
  const label = stageMeta(status).label;
  // With no sweep date (unread or stale) the answer isn't held at the edge: a blank as_of would stand for six hours.
  const cacheHeaders = asOf ? CACHE_HEADERS : { "Cache-Control": "no-store" };

  if (kind === "answered") {
    const exits = history.exits;
    if (format === "csv") {
      const lines = [
        ["case_number", "left_on", "moved_to", "waiting_since", "waiting_since_from", "days_at_stage", "filing_date", "employer", "job_title", "status_now", "as_of"].join(","),
        ...exits.map((r) =>
          [r.caseNumber, r.leftOn, r.to, r.startOn, FROM_WORDS[r.startSource] ?? "", r.days, r.filingDate, r.employer, r.jobTitle, r.nowStatus, asOf]
            .map((v) => csvCell(v ?? null))
            .join(","),
        ),
      ];
      return csvResponse(lines, `perm-${slug}-answered-${asOf ?? "cases"}.csv`, cacheHeaders);
    }
    return NextResponse.json(
      { stage: slug, status, label, kind, asOf, count: exits.length, rows: exits },
      { headers: cacheHeaders },
    );
  }

  if (format === "csv") {
    const lines = [
      ["case_number", "filing_date", "employer", "job_title", "status", "waiting_since", "waiting_since_from", "as_of"].join(","),
      ...rows.map((r) =>
        [r.caseNumber, r.filingDate, r.employer, r.jobTitle, status, r.startOn ?? null, FROM_WORDS[r.startSource ?? "unknown"] ?? "", asOf]
          .map((v) => csvCell(v ?? null))
          .join(","),
      ),
    ];
    return csvResponse(lines, `perm-${slug}-${asOf ?? "cases"}.csv`, cacheHeaders);
  }
  return NextResponse.json(
    { stage: slug, status, label, kind, asOf, count: rows.length, rows },
    { headers: cacheHeaders },
  );
}
