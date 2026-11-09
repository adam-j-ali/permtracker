/**
 * The list Ahrefs' Site Audit crawls: /sitemaps/audit.xml.
 *
 * The free plan gives a verified project 5,000 page credits a month, and a
 * credit goes on each internal page that answers 200 with HTML. The site has
 * hundreds of thousands of pages, most of them a handful of templates filled
 * from data, so a full crawl can never fit. This list is a weekly crawl of at
 * most AUDIT_BUDGET pages, which five weekly crawls in a long month still fit:
 *
 * - every hand-built page, every article and every tool, each week;
 * - one page of every template, each week, so a template's defect shows at once;
 * - the rest of each template's pages in priority order (the order its own
 *   sitemap lists them, the busiest first), a different window every week.
 *
 * The file is listed in neither the sitemap index nor robots.txt, so search
 * engines never read it as part of the site's map.
 */

export const AUDIT_BUDGET = 1000;

/** The Monday the rotation counts weeks from. */
const ROTATION_EPOCH_MS = Date.UTC(2026, 10, 9);
const WEEK_MS = 7 * 86_400_000;

/** Articles and tools are each their own page, never a template, however many there are. */
const CONTENT_PREFIXES = ["/guides/", "/blog/", "/changelog/", "/tools/"];

/** A shape this small is hand-built pages that share a parent (`/perm-employers/browse`, `/perm-employers/under-review`). */
const HAND_BUILT_MAX = 3;

/** Which week of the rotation `nowMs` falls in; 0 before it starts. */
export function auditWeek(nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - ROTATION_EPOCH_MS) / WEEK_MS));
}

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
 * Split the static sitemap's paths into the pages crawled every week and
 * one family per template, the template's first page counted as weekly.
 */
export function splitPages(paths: readonly string[]): { weekly: string[]; families: AuditFamily[] } {
  const byShape = new Map<string, string[]>();
  for (const p of paths) {
    const shape = routeShape(p);
    const list = byShape.get(shape);
    if (list) list.push(p);
    else byShape.set(shape, [p]);
  }
  const weekly: string[] = [];
  const families: AuditFamily[] = [];
  for (const [shape, list] of byShape) {
    const content = CONTENT_PREFIXES.some((prefix) => shape.startsWith(prefix));
    if (content || list.length <= HAND_BUILT_MAX) weekly.push(...list);
    else families.push({ name: shape, paths: list });
  }
  return { weekly, families };
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

/** `take` paths from `paths`, starting where week `week` of the rotation begins, wrapping at the end. */
function windowOf(paths: readonly string[], take: number, week: number): string[] {
  if (take <= 0 || paths.length === 0) return [];
  if (take >= paths.length) return [...paths];
  const start = (week * take) % paths.length;
  return Array.from({ length: take }, (_, j) => paths[(start + j) % paths.length]!);
}

/**
 * This week's list: the weekly pages, one page of each family, then each
 * family's rotating window, at most `budget` paths, no path twice.
 */
export function pickAuditPaths(
  weekly: readonly string[],
  families: readonly AuditFamily[],
  week: number,
  budget = AUDIT_BUDGET,
): string[] {
  const fixed = [...weekly, ...families.flatMap((f) => f.paths.slice(0, 1))];
  const rests = families.map((f) => f.paths.slice(1));
  const room = Math.max(0, budget - fixed.length);
  const takes = shares(rests.map((r) => r.length), room);
  const rotating = rests.flatMap((rest, i) => windowOf(rest, takes[i] ?? 0, week));
  return [...new Set([...fixed, ...rotating])].slice(0, budget);
}
