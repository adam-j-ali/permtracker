import { getSocTitlePages } from "@/lib/db/socTitles";

// Weekly, as the title pages themselves refresh: the titles move with the quarterly loads.
export const revalidate = 604800;

/**
 * The most titles listed: every title page today (3,924 on Nov 25 2026, 59 KB compressed) with a little room. Past
 * it the quietest titles drop from search, and each stays a search away on /soc-codes.
 */
const LISTED = 4000;

/**
 * Every job title with a page of its own, for the site search (src/lib/search/socTitleList.ts): its title, the SOC
 * code employers filed it under most and its page, busiest first, at most LISTED of them. No page is on a refresh
 * list (the title pages keep a week), so this keeps their week. Fetched only when someone opens search. A failed
 * read answers 503, never an empty list: the palette then says the titles couldn't load.
 */
export async function GET(): Promise<Response> {
  try {
    const doc = await getSocTitlePages();
    const list = [...(doc?.pages ?? [])]
      .sort((a, b) => b.filings - a.filings)
      .slice(0, LISTED)
      .map((p) => ({ title: p.title, code: p.topSoc, href: `/soc-codes/${p.slug}` }));
    return Response.json(list, { headers: { "X-Robots-Tag": "noindex" } });
  } catch {
    return Response.json({ error: "The job titles couldn't be read." }, { status: 503, headers: { "X-Robots-Tag": "noindex" } });
  }
}
