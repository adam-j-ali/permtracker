import { typeLabel } from "@/components/policy/DocRow";
import { dayLabel } from "@/components/policy/format";
import type { PolicyNotice } from "@/lib/db/policyNotices";
import type { PolicyFeed } from "@/lib/policyFeed";

/**
 * The policy page's two long lists (the agencies' own announcements, and the courts' and BALCA's decisions): the
 * newest few drawn as full rows, the rest folded by year. The page draws the rows and each year's count; a year's
 * lines load from /policy-changes/archive.json the first time a reader opens it. Both read this one fold, so a year's
 * count and its lines agree. The lines rode in the page until Nov 23 2026: 1,150 of them, 0.62 MB of its 1.64 MB of
 * HTML, with Googlebot reading only a page's first 2 MB.
 */

/** How many of each list's newest the page draws as full rows. */
export const ARCHIVE_LEAD = { agencies: 8, decisions: 6 } as const;

export type ArchiveList = keyof typeof ARCHIVE_LEAD;

/** One folded document: its id, its day and source ("Mar 2, 2019, OFLC"), its address and its title. */
export type ArchiveLine = readonly [id: string, day: string, url: string, title: string];

/** Every folded line of both lists, by year. */
export type ArchiveBook = Record<ArchiveList, Record<string, ArchiveLine[]>>;

/** The newest `lead` as rows, the rest grouped by year, newest year first, each year in the list's own order. */
export function foldArchive(
  items: readonly PolicyNotice[],
  lead: number,
): { recent: PolicyNotice[]; years: Array<{ year: string; notices: PolicyNotice[] }> } {
  const years = new Map<string, PolicyNotice[]>();
  for (const n of items.slice(lead)) {
    const y = n.publicationDate.slice(0, 4);
    const list = years.get(y);
    if (list) list.push(n);
    else years.set(y, [n]);
  }
  return {
    recent: items.slice(0, lead),
    years: [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, notices]) => ({ year, notices })),
  };
}

export function archiveLine(n: PolicyNotice): ArchiveLine {
  return [n.documentNumber, `${dayLabel(n.publicationDate)}, ${typeLabel(n.type)}`, n.url, n.title];
}

/** Which of the feed's lists each archive folds. */
export function archiveItems(feed: PolicyFeed, list: ArchiveList): PolicyNotice[] {
  return list === "agencies" ? feed.announcements : feed.decisions;
}

export function archiveBook(feed: PolicyFeed): ArchiveBook {
  const book = (list: ArchiveList) =>
    Object.fromEntries(
      foldArchive(archiveItems(feed, list), ARCHIVE_LEAD[list]).years.map(({ year, notices }) => [year, notices.map(archiveLine)]),
    );
  return { agencies: book("agencies"), decisions: book("decisions") };
}
