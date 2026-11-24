import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataProvenance } from "@/components/data/DataProvenance";
import { BrowseIndexGrid, BrowseList, BrowseStrip } from "@/components/entities/EntityBrowse";
import { ListPages } from "@/components/ui/list-pages";
import { getSocTitlePages, type SocTitlePage } from "@/lib/db/socTitles";
import { BROWSE_BUCKETS, bucketLabel, bucketPhrase, browseHref, isBrowseBucket, type BrowseBucket } from "@/lib/entityBrowse";
import { formatInt } from "@/lib/format";
import { openGraphBase } from "@/lib/openGraphBase";
import { SOC_TITLES_BASE, titleBucketCounts, titleLetterDescription, titlesByBucket } from "@/lib/socTitleBrowse";
import { withSocialCard } from "@/lib/socialCard";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";

/**
 * The job title A to Z: /soc-codes/browse and a page per letter, every title page a crawlable link
 * (lib/socTitleBrowse.ts says why). Built from the employer A to Z's parts, so a fix to the strip or the list
 * reaches both. The route files keep their segment config; Next reads it off the module it loads.
 */

const SOURCES = ["perm-cases", "pw-disclosure", "lca-disclosure", "onet"];

/** The directory as every page of it reads it: one doc, held in the process (getSocTitlePages). A failed read throws. */
async function titleDirectory() {
  const doc = await getSocTitlePages();
  const pages = doc?.pages ?? [];
  return { pageMin: doc?.pageMin ?? null, total: pages.length, counts: titleBucketCounts(pages), buckets: titlesByBucket(pages) };
}

/** The letter strip, for /soc-codes: every letter page one link from the finder. Nothing when no title has a page. */
export async function TitleLetterStrip({ className }: { className?: string }) {
  const { total, counts } = await titleDirectory();
  if (total === 0) return null;
  return (
    <div className={className}>
      <BrowseStrip base={SOC_TITLES_BASE} counts={counts} />{" "}
      <p className="mt-4 text-base">
        <Link href={browseHref(SOC_TITLES_BASE)} className="link inline-flex min-h-11 items-center">
          How many titles sit behind each letter
        </Link>
      </p>
    </div>
  );
}

export function titleIndexMetadata(): Metadata {
  const title = "Job Titles A to Z: Find a Title's SOC Code";
  const description =
    "Every job title with a page of its own, grouped by first letter. Each page shows the SOC codes employers filed the title under in DOL's files, and how often.";
  return withSocialCard(
    {
      title,
      description,
      alternates: { canonical: browseHref(SOC_TITLES_BASE) },
      openGraph: { ...openGraphBase, title: `${title} | PERM Tracker`, description, url: browseHref(SOC_TITLES_BASE) },
    },
    "soc-codes",
  );
}

export async function titleLetterMetadata(letter: string): Promise<Metadata> {
  // A junk letter is a routing 404 already (dynamicParams = false); this is the belt to that brace.
  if (!isBrowseBucket(letter)) notFound();
  const { counts } = await titleDirectory();
  const n = counts[letter];
  const title = `SOC Codes for Job Titles Starting With ${bucketLabel(letter)}`;
  const description = titleLetterDescription(n, bucketPhrase(letter));
  const path = browseHref(SOC_TITLES_BASE, letter);
  return withSocialCard(
    {
      title,
      description,
      // A letter with nothing under it isn't offered to the index, and the sitemap leaves it out in step.
      ...(n === 0 ? { robots: { index: false, follow: true } } : {}),
      alternates: { canonical: path },
      openGraph: { ...openGraphBase, title: `${title} | PERM Tracker`, description, url: path },
    },
    "soc-codes",
  );
}

export async function TitleIndexBody() {
  const { total, counts, pageMin } = await titleDirectory();
  const live = BROWSE_BUCKETS.filter((b) => counts[b] > 0);
  const biggest = live.reduce<BrowseBucket | null>((best, b) => (best === null || counts[b] > counts[best] ? b : best), null);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <header className="max-w-3xl">
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">Job titles A to Z</h1>{" "}
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          All {formatInt(total)} job titles with a page of their own, grouped by first letter.
          {biggest ? ` ${bucketLabel(biggest)} is the biggest group at ${formatInt(counts[biggest])}.` : ""} Each page shows the
          SOC codes employers filed the title under, and how often.
        </p>
      </header>{" "}
      <section className="mt-10">
        <h2 className="font-heading text-2xl font-bold">Pick a letter</h2>{" "}
        <p className="mt-2 max-w-3xl text-base text-muted-foreground">
          {keepWhole(pageMin ? `A title gets a page at ${formatInt(pageMin)} filings across DOL's PERM, wage request and H-1B files. ` : "")}
          Seniority words and level marks don&apos;t make a new title: Sr. Software Engineer III is counted as Software
          Engineer, so all its filings sit on one page. The{" "}
          <Link href={SOC_TITLES_BASE} className="link">
            SOC code finder
          </Link>{" "}
          takes any title, the ones too small for a page included.
        </p>
        <BrowseIndexGrid base={SOC_TITLES_BASE} counts={counts} plural="titles" className="mt-6" />
      </section>{" "}
      <DataProvenance datasets={SOURCES} />
    </div>
  );
}

/** The busiest title under a letter, for the page's opening line. */
function busiestOf(pages: readonly SocTitlePage[]): SocTitlePage | null {
  return pages.reduce<SocTitlePage | null>((best, p) => (best === null || p.filings > best.filings ? p : best), null);
}

export async function TitleLetterBody({ letter }: { letter: string }) {
  if (!isBrowseBucket(letter)) notFound();
  const { total, counts, buckets } = await titleDirectory();
  const pages = buckets[letter];
  const phrase = bucketPhrase(letter);
  const busiest = busiestOf(pages);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <header className="max-w-3xl">
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">Job titles beginning with {phrase}</h1>{" "}
        {busiest ? (
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            {formatInt(pages.length)} of the {formatInt(total)} job titles with a page here. The busiest is{" "}
            <Link href={`${SOC_TITLES_BASE}/${busiest.slug}`} className="link">
              {keepWhole(busiest.title)}
            </Link>{" "}
            with {formatInt(busiest.filings)} filings. Each page shows the SOC codes employers filed the title under, and how
            often.
          </p>
        ) : (
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            No job title in DOL&apos;s files begins with {phrase} often enough to have a page. Every other letter is one click
            away.
          </p>
        )}
      </header>{" "}
      <BrowseStrip base={SOC_TITLES_BASE} counts={counts} active={letter} className="mt-8" />{" "}
      {pages.length ? (
        <section className="mt-10">
          <h2 className="font-heading text-2xl font-bold">All {formatInt(pages.length)}, alphabetically</h2>{" "}
          <p className="mt-2 max-w-3xl text-base text-muted-foreground">
            <KeepWhole>
              {"Each number is the filings with that title in DOL's PERM, wage request and H-1B files."}
            </KeepWhole>
          </p>{" "}
          <BrowseList
            id="title-list"
            base={SOC_TITLES_BASE}
            entries={pages.map((p, i) => ({ slug: p.slug, name: p.title, total: p.filings, rank: i + 1 }))}
            unit="filings"
            className="mt-6 scroll-mt-28"
          />{" "}
          <ListPages listId="title-list" total={pages.length} noun="job titles" />
        </section>
      ) : null}{" "}
      <section className="mt-12 max-w-3xl border-2 border-border bg-sage p-6 shadow-hard-sm">
        <h2 className="font-heading text-lg font-bold">Looking for a title that isn&apos;t here?</h2>{" "}
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          The{" "}
          <Link href={SOC_TITLES_BASE} className="link">
            SOC code finder
          </Link>{" "}
          matches any title against every one in DOL&apos;s files, including the ones with fewer filings than a page needs.
        </p>
      </section>{" "}
      <DataProvenance datasets={SOURCES} />
    </div>
  );
}
