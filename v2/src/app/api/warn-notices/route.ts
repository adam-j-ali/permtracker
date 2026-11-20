import { NextResponse } from "next/server";

import { warnForSlug } from "@/lib/db/warn";
import { slugify } from "@/lib/entitySlug";
import { inLayoffWindow } from "@/lib/layoffCheck";

/**
 * One employer's WARN notices dated in a window, for the case page's layoff check (src/lib/layoffCheck.ts). The same
 * public notices the employer's page lists. A failed read answers 503, never an empty list: no notices and couldn't
 * read them are different answers.
 */
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = (q.get("slug") ?? "").slice(0, 160);
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if (!slug || slugify(slug) !== slug || !DAY.test(from) || !DAY.test(to) || from > to) {
    return NextResponse.json({ error: "Give an employer page's slug and a from and to day (YYYY-MM-DD)." }, { status: 400 });
  }
  try {
    const notices = (await warnForSlug(slug, 200)).filter((n) => inLayoffWindow(n.noticeDate, { from, to }));
    return NextResponse.json(
      { notices },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "The layoff notices couldn't be read. Try again." }, { status: 503 });
  }
}
