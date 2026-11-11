/**
 * Refresh the pages that show people's shared timelines when the owner approves, declines, hides or deletes one,
 * or its author changes or removes one that was showing (convex/communityTimelines.ts, `refreshPages`).
 *
 * The board's pages are fixed (TIMELINE_PAGES in paths.ts). The call may also name USCIS offices by USCIS's own
 * code; each is looked up in the site's office list and only its own page is refreshed, so nothing here can be
 * aimed at another page or expire the whole family. A code the list doesn't hold is skipped and named in the answer.
 * `revalidatePath` marks each page stale; the next visitor pays for one render.
 */

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { MAX_OFFICES, OFFICE_PAGES, TIMELINE_PAGES } from "./paths";
import { secretMatches } from "@/lib/secretMatch";
import { softFail } from "@/lib/softRead";
import { officeByCode } from "@/lib/uscisOffices";

export async function POST(request: Request): Promise<NextResponse> {
  const secret = request.headers.get("x-revalidate-secret");
  const expected = process.env.REVALIDATE_SECRET;
  if (!(await secretMatches(secret, expected))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body: unknown = await request.json().catch(softFail("api/revalidate-timelines/route.json", null));
  const named = (body as { offices?: unknown } | null)?.offices ?? [];
  if (!Array.isArray(named) || named.length > MAX_OFFICES || named.some((c) => typeof c !== "string" || c.length > 8)) {
    return NextResponse.json({ error: "Expected { offices: string[] }" }, { status: 400 });
  }

  for (const path of TIMELINE_PAGES) revalidatePath(path);
  const refreshed: string[] = [...TIMELINE_PAGES];
  const unknown: string[] = [];
  for (const code of new Set(named as string[])) {
    const office = officeByCode(code);
    if (!office) {
      unknown.push(code);
      continue;
    }
    const path = `${OFFICE_PAGES}/${office.slug}`;
    revalidatePath(path);
    refreshed.push(path);
  }
  return NextResponse.json({ revalidated: refreshed, unknown, now: Date.now() });
}
