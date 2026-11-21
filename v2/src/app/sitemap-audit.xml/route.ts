import { auditEntries, urlsetXml } from "@/lib/sitemap/build";

/**
 * The list an outside site audit crawls (Ahrefs' "Specific sitemaps"): every
 * hand-built page, article and tool, and the top of every template, under a
 * page budget a weekly crawl can afford (lib/sitemap/audit.ts says why). The
 * same list each week, so one crawl compares with the last.
 *
 * Not in the sitemap index and not in robots.txt: search engines read the
 * site's map from /sitemap.xml, and this would only repeat a sample of it.
 * /sitemaps/audit.xml, its first address, answers the same list.
 */
export const revalidate = 86400;

export async function GET() {
  return new Response(urlsetXml(await auditEntries()), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
