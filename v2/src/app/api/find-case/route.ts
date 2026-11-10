import { NextResponse } from "next/server";

import { findCase } from "@/lib/findCase";
import { FILING_PROGRAMS, type FilingProgram } from "@/lib/filingsByDay";
import { easternDay } from "@convex/lib/time";

/**
 * GET /api/find-case?program=perm&employer=&title=&firm=&from=&to=: a case found from what a person knows about
 * it, for the finder under every case-number box (src/components/tools/CaseFinder.tsx). Each of the employer's
 * name, the job title, the law firm and the two filing dates is optional, and one of them is enough. How an ask is
 * read, and why dates more than a quarter apart need a name beside them, is in src/lib/findCase.ts.
 *
 * A ROUTE, NOT A PAGE PARAM: the pages that carry the finder stay static, and the search is one JSON request.
 *
 * Lengths are cut before anything walks a string. An ask the rules refuse answers 400 with the sentence the
 * finder shows; a failed read answers 503, never an empty list. Statuses move with each sweep, so an answer may be
 * kept for fifteen minutes.
 */
export const revalidate = 0;

const text = (p: URLSearchParams, key: string, max: number) => (p.get(key) ?? "").slice(0, max + 1).trim();

export async function GET(req: Request): Promise<NextResponse> {
  const p = new URL(req.url).searchParams;
  const program = text(p, "program", 12).toLowerCase() || "perm";
  const employer = text(p, "employer", 120);
  const title = text(p, "title", 80);
  const firm = text(p, "firm", 120);
  const from = text(p, "from", 10);
  const to = text(p, "to", 10);
  if (!(FILING_PROGRAMS as readonly string[]).includes(program)) {
    return NextResponse.json({ error: `program must be one of ${FILING_PROGRAMS.join(", ")}` }, { status: 400 });
  }
  if (employer.length > 120 || firm.length > 120 || title.length > 80) {
    return NextResponse.json({ error: "employer and firm take up to 120 characters, title up to 80" }, { status: 400 });
  }
  try {
    const got = await findCase(program as FilingProgram, { employer, title, firm, from, to }, easternDay());
    if (!got.ok) return NextResponse.json({ error: got.message, why: got.why }, { status: 400 });
    // An empty field is left out, not spelled "null": a quarter of LCAs is a long list.
    const body = JSON.stringify(got.answer, (_k, v) => (v === null ? undefined : v));
    return new NextResponse(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
    });
  } catch (e) {
    console.error("[find-case] read failed", e);
    return NextResponse.json({ error: "DOL's record couldn't be read just now, so try again in a minute" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
