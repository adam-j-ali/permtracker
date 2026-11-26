/**
 * Expire the pages that print the USCIS sample's figures, after the server's sample load
 * (`permtracker-uscis uscis-sample`), so a block checked in the day shows within minutes, not after the page's hour.
 * Takes no input: a caller knows the secret and expires this set, or does nothing.
 */

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { USCIS_SAMPLE_PAGE_FAMILIES, USCIS_SAMPLE_PAGES } from "./paths";
import { secretMatches } from "@/lib/secretMatch";

export async function POST(request: Request): Promise<NextResponse> {
  const secret = request.headers.get("x-revalidate-secret");
  const expected = process.env.REVALIDATE_SECRET;
  if (!(await secretMatches(secret, expected))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  for (const path of USCIS_SAMPLE_PAGES) revalidatePath(path);
  for (const family of USCIS_SAMPLE_PAGE_FAMILIES) revalidatePath(family, "page");
  return NextResponse.json({ revalidated: USCIS_SAMPLE_PAGES.length + USCIS_SAMPLE_PAGE_FAMILIES.length, now: Date.now() });
}
