/**
 * The A to Z directory of the job title pages (/soc-codes/browse and a page per letter).
 *
 * Until Nov 2026 the 3,726 title pages were linked only from the finder's 24 "most filed" titles and the titles
 * an occupation page lists, so a crawler found almost all of them through the sitemap alone (Ahrefs counted 3,713
 * orphans on Nov 21). The directory links every one from a letter page, every letter page from /soc-codes, so
 * each title sits two links from its hub.
 *
 * The letters are the employer A to Z's (lib/entityBrowse.ts), digits together. A title is filed under the first
 * letter of the title a reader sees. Its slug can start elsewhere: the slug is the title's key, which drops a
 * leading seniority word, so "Senior Associate JC60 ..." has a slug starting "associate" and belongs under S (49
 * titles, Nov 20 2026). Pure, and read from the same doc the sitemap lists the pages from (soc_title_pages), so
 * the two can't disagree.
 */

import { BROWSE_BUCKETS, BROWSE_OTHER, isBrowseBucket, type BrowseBucket } from "@/lib/entityBrowse";

/** What the directory needs of a title page: a subset of `SocTitlePage` (lib/db/socTitles.ts). */
export interface TitlePageRef {
  slug: string;
  title: string;
  filings: number;
}

/** Where the directory hangs: its pages are `${base}/browse` and `${base}/browse/<letter>`. */
export const SOC_TITLES_BASE = "/soc-codes";

const byTitle = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** The letter a title is filed under: its first letter, accents off, past any mark; a digit or nothing is 0-9. */
export function titleBucketOf(title: string): BrowseBucket {
  const plain = (title ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const first = /[a-z0-9]/.exec(plain)?.[0] ?? "";
  return isBrowseBucket(first) ? first : BROWSE_OTHER;
}

/** Every title page under its letter, alphabetically by the title a reader sees. */
export function titlesByBucket<T extends TitlePageRef>(pages: readonly T[]): Record<BrowseBucket, T[]> {
  const out = Object.fromEntries(BROWSE_BUCKETS.map((b) => [b, [] as T[]])) as Record<BrowseBucket, T[]>;
  for (const p of pages) out[titleBucketOf(p.title)].push(p);
  for (const b of BROWSE_BUCKETS) out[b].sort((x, y) => byTitle.compare(x.title, y.title) || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  return out;
}

/** A letter page's search description, from its own count, so no two letters share a sentence. */
export function titleLetterDescription(count: number, phrase: string): string {
  if (count === 0) {
    return `No job title in DOL's files begins with ${phrase} often enough to have a page. Every other letter is listed here, each title with its SOC codes.`;
  }
  const titles = count === 1 ? "1 job title" : `${count.toLocaleString("en-US")} job titles`;
  return `${titles} beginning with ${phrase}, each linked to its own page: the SOC codes employers filed it under in DOL's files, and how often.`;
}

/** How many title pages sit under each letter, empty letters as 0. */
export function titleBucketCounts(pages: readonly TitlePageRef[]): Record<BrowseBucket, number> {
  const counts = Object.fromEntries(BROWSE_BUCKETS.map((b) => [b, 0])) as Record<BrowseBucket, number>;
  for (const p of pages) counts[titleBucketOf(p.title)] += 1;
  return counts;
}
