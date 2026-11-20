/**
 * Refresh the pages that show people's shared timelines when the owner approves, declines, hides or deletes one,
 * or its author changes or removes one that was showing (convex/communityTimelines.ts, `refreshPages`), and the
 * pages that read the merged list of reported cases whenever its hourly build changes it
 * (scripts/build_reported_cases.py).
 *
 * The board's pages and the list's are fixed (FIXED_PAGES in paths.ts). The call may also name USCIS offices by USCIS's own
 * code and consulates by the site's key; each is looked up in the site's own list and only its page is refreshed, so
 * nothing here can be aimed at another page or expire the whole family. One the list doesn't hold is skipped and named
 * in the answer.
 * `revalidatePath` marks each page stale; the next visitor pays for one render.
 */

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { FIXED_PAGES, MAX_OFFICES, MAX_POSTS, OFFICE_PAGES, POST_PAGES } from "./paths";
import { postCountry } from "@/lib/consular/postCountries";
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
  const posts = (body as { posts?: unknown } | null)?.posts ?? [];
  if (!Array.isArray(named) || named.length > MAX_OFFICES || named.some((c) => typeof c !== "string" || c.length > 8)) {
    return NextResponse.json({ error: "Expected { offices: string[] }" }, { status: 400 });
  }
  if (!Array.isArray(posts) || posts.length > MAX_POSTS || posts.some((c) => typeof c !== "string" || c.length > 64)) {
    return NextResponse.json({ error: "Expected { posts: string[] }" }, { status: 400 });
  }

  for (const path of FIXED_PAGES) revalidatePath(path);
  const refreshed: string[] = [...FIXED_PAGES];
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
  // A consulate by the site's own key: only a post the site lists is refreshed.
  for (const slug of new Set(posts as string[])) {
    if (postCountry(slug) === null) {
      unknown.push(slug);
      continue;
    }
    const path = `${POST_PAGES}/${slug}`;
    revalidatePath(path);
    refreshed.push(path);
  }
  return NextResponse.json({ revalidated: refreshed, unknown, now: Date.now() });
}
