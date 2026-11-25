import { getConsularIndex } from "@/lib/db/consularPosts";

// Daily, as the consulate pages themselves refresh.
export const revalidate = 86400;

/**
 * Every consulate with a page, for the site search (src/lib/search/consulateList.ts): each under its page's own
 * heading ("Mumbai: immigrant visas"), the busiest employment posts first, with the words people type. Fetched only
 * when someone opens search. A failed read answers 503, never an empty list: the palette then says consulates
 * couldn't load, where an empty list would say there are none.
 */
export async function GET(): Promise<Response> {
  try {
    const { posts } = await getConsularIndex();
    const list = [...posts]
      .sort((a, b) => (b.employment ?? -1) - (a.employment ?? -1))
      .map((p) => ({
        label: `${p.name}: immigrant visas`,
        href: `/consular-posts/${p.slug}`,
        keywords: `${p.name} consulate embassy post us visa interview nvc immigrant visa green card scheduling`,
      }));
    return Response.json(list, { headers: { "X-Robots-Tag": "noindex" } });
  } catch {
    return Response.json({ error: "The consulates couldn't be read." }, { status: 503, headers: { "X-Robots-Tag": "noindex" } });
  }
}
