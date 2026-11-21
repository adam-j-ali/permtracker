/**
 * The list Ahrefs' Site Audit crawls: /sitemap-audit.xml (and its first address, /sitemaps/audit.xml).
 *
 * A verified project gets 5,000 crawl credits a month, and a credit goes on
 * each internal page that answers 200 with HTML (help.ahrefs.com, "How are
 * Crawl Credits in Site Audit spent?"). The site has hundreds of thousands of
 * pages, most of them a handful of templates filled from data, so a full crawl
 * can never fit. This list is a weekly crawl of at most AUDIT_BUDGET pages,
 * which a month of five weekly crawls still fits:
 *
 * - every hand-built page, every article and every tool;
 * - one page of every template, so a template's defect shows at once;
 * - the rest of each template's share from the top of its own sitemap order
 *   (the busiest pages first).
 *
 * THE SAME LIST EVERY WEEK. Until Nov 20 2026 each template's share moved a
 * window every week, which made Ahrefs' "new" and "fixed" issues mostly a new
 * sample rather than a change to the site, and covered the whole site only in
 * years. A fixed sample makes each week's crawl compare with the last; every
 * page of the site is checked by our own audits instead.
 *
 * The file is listed in neither the sitemap index nor robots.txt, so search
 * engines never read it as part of the site's map.
 */

export const AUDIT_BUDGET = 1000;

/** Articles and tools are each their own page, never a template, however many there are. */
const CONTENT_PREFIXES = ["/guides/", "/blog/", "/changelog/", "/tools/"];

/** A shape this small is hand-built pages that share a parent (`/perm-employers/browse`, `/perm-employers/under-review`). */
const HAND_BUILT_MAX = 3;

/** The template a path renders: its leading segments, the last one a slug. Same rule as `scripts/lib_sitemap_sample.py`. */
export function routeShape(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length === 1) return `/${parts[0]}`;
  return `/${parts.slice(0, -1).join("/")}/:slug`;
}

/** One template's pages, in priority order. */
export interface AuditFamily {
  name: string;
  paths: readonly string[];
}

/**
 * Split the static sitemap's paths into the pages listed whole and one
 * family per template.
 */
export function splitPages(paths: readonly string[]): { fixed: string[]; families: AuditFamily[] } {
  const byShape = new Map<string, string[]>();
  for (const p of paths) {
    const shape = routeShape(p);
    const list = byShape.get(shape);
    if (list) list.push(p);
    else byShape.set(shape, [p]);
  }
  const fixed: string[] = [];
  const families: AuditFamily[] = [];
  for (const [shape, list] of byShape) {
    const content = CONTENT_PREFIXES.some((prefix) => shape.startsWith(prefix));
    if (content || list.length <= HAND_BUILT_MAX) fixed.push(...list);
    else families.push({ name: shape, paths: list });
  }
  return { fixed, families };
}

/**
 * Share `room` across families: a family smaller than its share takes all of
 * it, and what it leaves goes to the bigger ones.
 */
function shares(sizes: readonly number[], room: number): number[] {
  const order = sizes.map((size, i) => ({ size, i })).sort((a, b) => a.size - b.size);
  const out: number[] = new Array<number>(sizes.length).fill(0);
  let left = room;
  order.forEach(({ size, i }, k) => {
    const share = Math.floor(left / (order.length - k));
    const take = Math.min(size, share);
    out[i] = take;
    left -= take;
  });
  return out;
}

/**
 * The list: the fixed pages, one page of each family, then each family's
 * share from its top, at most `budget` paths, no path twice. The same input
 * gives the same list.
 */
export function pickAuditPaths(
  fixed: readonly string[],
  families: readonly AuditFamily[],
  budget = AUDIT_BUDGET,
): string[] {
  const firsts = [...fixed, ...families.flatMap((f) => f.paths.slice(0, 1))];
  const rests = families.map((f) => f.paths.slice(1));
  const room = Math.max(0, budget - firsts.length);
  const takes = shares(rests.map((r) => r.length), room);
  const tops = rests.flatMap((rest, i) => rest.slice(0, takes[i] ?? 0));
  return [...new Set([...firsts, ...tops])].slice(0, budget);
}
