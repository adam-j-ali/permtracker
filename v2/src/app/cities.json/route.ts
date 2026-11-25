import { listGroups } from "@/lib/db/groups";
import { stateName } from "@/lib/usStateNames";

// Daily, as the city index refreshes.
export const revalidate = 86400;

/**
 * The most cities listed: every city with a PERM page today (3,192 on Nov 25 2026, 40 KB compressed) with room. Past
 * it the quietest cities drop from search, and each stays a search away on /perm-cities.
 */
const LISTED = 3500;

/**
 * Every city with a PERM page, for the site search (src/lib/search/cityList.ts): each under its page's own name
 * ("Tampa, FL"), its state spelled out for "tampa florida", busiest first, at most LISTED of them. The city pages
 * are on no refresh list, so this keeps the index's day. Fetched only when someone opens search. A failed read
 * answers 503, never an empty list: the palette then says the cities couldn't load.
 */
export async function GET(): Promise<Response> {
  try {
    const cities = await listGroups("city");
    const list = [...cities]
      .sort((a, b) => b.total - a.total)
      .slice(0, LISTED)
      .map((c) => {
        const state = c.key.split("|")[1] ?? "";
        return { label: c.label, href: `/perm-cities/${c.slug}`, keywords: state ? stateName(state) : "" };
      });
    return Response.json(list, { headers: { "X-Robots-Tag": "noindex" } });
  } catch {
    return Response.json({ error: "The cities couldn't be read." }, { status: 503, headers: { "X-Robots-Tag": "noindex" } });
  }
}
