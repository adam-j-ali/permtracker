/**
 * PERM wages by occupation.
 *
 * Every occupation in the current disclosure window with its median offered
 * wage, volume, approval rate and median days: the numbers a beneficiary
 * compares an offer against and an attorney benchmarks a prevailing wage
 * strategy against. All from DOL's own files; nothing modeled, nothing
 * invented.
 *
 * The page leads with a DISTRIBUTION rather than a ranking. A table of
 * medians was here first and it hid the most striking thing in the data:
 * ordered by filing volume, the busiest occupations alternate between two pay
 * scales whose distributions do not touch at any percentile. That is visible
 * in one drawing and invisible in a column of medians.
 */

import { Fragment } from "react";
import type { Metadata } from "next";
import { withSocialCard } from "@/lib/socialCard";
import Link from "next/link";

import { getDatasetSchema } from "@/lib/structuredData";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { openGraphBase } from "@/lib/openGraphBase";
import { EntityExplorer } from "@/components/tools/EntityExplorer";
import { FigurePlate } from "@/components/tools/FigurePlate";
import { BrowseTeaser } from "@/components/entities/BrowseBody";
import { fetchEntitySeed } from "@/lib/entitySeed";
import { getDisclosureStats } from "@/lib/db/publicData";
import {
  getStateLadders,
  getVolumeLadders,
  getWageBandRates,
  getWageBandRatesByYear,
  MIN_CASES_FOR_LADDER,
} from "@/lib/db/wages";
import { FaqList } from "@/components/tools/FaqList";
import { SplitLadderNote } from "@/components/wages/SplitLadderNote";
import { WageExplorer } from "@/components/wages/WageExplorer";
import { TwoMarketsNote } from "@/components/wages/LadderComb";
import { LadderCombViews } from "@/components/wages/LadderViews";
import { DenialByWageBand } from "@/components/wages/DenialByWageBand";

import { DataProvenance } from "@/components/data/DataProvenance";
import { PageBasics } from "@/components/data/PageBasics";
import { formatInt } from "@/lib/format";
import { IndexHeader, IndexSearch } from "@/components/data/IndexHeader";
import { ChapterNav, type ChapterItem } from "@/components/entities/Chapters";
import { formatDollars } from "@/lib/format";
import { SITE_URL } from "@/lib/constants/site";
import { entityHref } from "@/lib/entityPayload";
const TITLE = "PERM Salaries by Occupation";
const DESCRIPTION =
  "What PERM cases pay: the full wage ladder by occupation, filters by job, state and year, with volume and approval rates, from DOL's own disclosure files.";

// The salary explorer's questions, kept when the explorer joined this page (Nov 24 2026).
const FAQS = [
  {
    q: "Is this what the job actually pays?",
    a: "It's the wage the employer offered on the ETA-9089, which is the figure DOL publishes. It has to meet or beat the prevailing wage determination for that job in that area, so it's a floor set by the process. It isn't a market survey. Bonuses and equity aren't in it. The determinations themselves are held too, about 634,000 of them, so a wage request looked up by its P- number shows the wage DOL set for that job.",
  },
  {
    q: "Why does a filter sometimes show no figures?",
    a: "Because the selection is too thin to support one. Below 30 cases a median moves by thousands when a single case lands, so nothing is shown. Between 30 and 100 the middle is shown and the 5th and 95th are withheld, because at that size each tail rests on fewer than five filings.",
  },
  {
    q: "Why is certified the default?",
    a: "A denied case's offered wage was never agreed to by anyone. Benchmarking against certified wages is the more useful comparison, and every other outcome is one filter away.",
  },
  {
    q: "Why is the average higher than the median in most selections?",
    a: "Because the top of the wage range runs much further from the middle than the bottom does. A handful of very high offers pull an average up and leave a median where it is, which is why both are shown.",
  },
];

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/perm-wages" },
  openGraph: {
    ...openGraphBase,
    title: `${TITLE} | PERM Tracker`,
    description: DESCRIPTION,
    url: "/perm-wages",
  },
}, "perm-wages");

// The disclosure files are quarterly, so an hourly window bought
// nothing and cost a regeneration per page per hour across 21,178
// entity pages. A day bounds staleness far below the data's own
// cadence, and the ingests expire it on demand when its data moves
// (the /api/revalidate-* routes).
// QUARTERLY DATA, WEEKLY WINDOW, AND A TRIGGER. This reads DOL's quarterly
// disclosure files, which change four times a year; a one-day window meant
// ~364 expiries a year to express four real changes, and every expiry a
// visitor walks into is a paid ISR render of an identical page.
// `POST /api/revalidate-disclosure` expires this the moment a file lands, so
// the long window costs no freshness. It stays a WEEK rather than a month so a
// trigger that never fires bounds the staleness instead of stranding the page.
export const revalidate = 604800;

export default async function PermWagesPage() {
  const [stats, seed, ladders, bandsByYear, bandsPooled, stateLadders] = await Promise.all([
    getDisclosureStats(),
    fetchEntitySeed("occupation"),
    getVolumeLadders(12),
    getWageBandRatesByYear(),
    getWageBandRates(),
    getStateLadders(60),
  ]);
  const { rows: occupations, total: occupationCount } = seed;
  const ladder = stats?.wageLadder ?? null;

  const withWages = occupations.filter((o) => o.medianAnnualWage != null);
  const overallMedian = (() => {
    if (withWages.length === 0) return null;
    const sorted = withWages
      .map((o) => o.medianAnnualWage as number)
      .sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  })();

  // The comb links each row to that occupation's own page. The slug lives on
  // the entity seed, and the ladder carries the SOC code, so they are joined
  // here rather than in the query: perm_wage_stats has no slug column and
  // computing one in a second place is how a detail page 404s from its index.
  const slugByCode = new Map(
    occupations.filter((o) => o.code).map((o) => [o.code as string, o.slug]),
  );

  const chapters: ChapterItem[] = [
    ...(ladder ? [{ id: "ladder", label: "The ladder" }] : []),
    { id: "explore", label: "Filter by state and year" },
    ...(ladders.length > 0 ? [{ id: "by-job", label: "By job" }] : []),
    ...(stateLadders.length > 0 ? [{ id: "by-state", label: "By state" }] : []),
    ...(bandsPooled.length > 0 ? [{ id: "denials", label: "Denials by wage" }] : []),
    { id: "all", label: `All ${formatInt(occupationCount)}` },
    { id: "a-z", label: "A to Z" },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage" as const,
    mainEntity: FAQS.map((f) => ({
      "@type": "Question" as const,
      name: f.q,
      acceptedAnswer: { "@type": "Answer" as const, text: f.a },
    })),
  };

  const datasetSchema = getDatasetSchema(SITE_URL, {
    name: "PERM offered wages by occupation",
    description: DESCRIPTION,
    url: `${SITE_URL}/perm-wages`,
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={datasetSchema} />
      <JsonLdScript schema={faqSchema} />

      <IndexHeader
        title="PERM wages: what each job pays"
        lede="What each employer committed to pay, on the federal filing itself."
        figures={[
          ...(ladder?.p50 != null
            ? [{ kind: "measured" as const, label: "The median certified offer", value: formatDollars(ladder.p50), note: `of ${formatInt(ladder.count)} cases` }]
            : []),
          { kind: "measured" as const, label: "Occupations", value: formatInt(occupationCount) },
          ...(overallMedian != null
            ? [
                {
                  kind: "measured" as const,
                  label: "The middle occupation",
                  value: formatDollars(overallMedian),
                  note: "Lower: most jobs are small, and the biggest pay best",
                },
              ]
            : []),
        ]}
        aside={
          <IndexSearch
            title="Filter jobs"
            action="/perm-wages#all"
            placeholder="Software developer, nurse"
            note="Each occupation's page has its wage ladder, its employers and BLS's market pay."
            footer={
              <>
                Have an offer?{" "}
                <Link href="/tools/compare-my-offer" className="link">
                  See where it falls
                </Link>
              </>
            }
          />
        }
      />

      {occupations.length > 0 ? (
        <>
          <ChapterNav items={chapters} className="mt-10" />
          {ladder ? (
            <section id="ladder" className="dark mt-10 border-2 shadow-hard border-black bg-[#141414] text-foreground p-6 sm:p-8">
              <h2 className="font-heading text-2xl font-bold">
                The whole wage ladder
              </h2>{" "}
              <dl className="mt-6 grid [&>*]:min-w-0 grid-cols-2 gap-4 sm:grid-cols-5">
                {[
                  { k: "10th", v: ladder.p10 },
                  { k: "25th", v: ladder.p25 },
                  { k: "Median", v: ladder.p50 },
                  { k: "75th", v: ladder.p75 },
                  { k: "90th", v: ladder.p90 },
                ].map((d) => (
                  // Array items render with NOTHING between them, so the
                  // last figure of one rung glued to the next rung's label.
                  <Fragment key={d.k}>
                    <div className={d.k === "Median" ? "border-2 border-primary bg-tint p-3" : "p-3"}>
                      <dt className="text-sm text-muted-foreground">
                        {d.k}
                      </dt>{" "}
                      <dd className="mt-1 font-heading text-xl font-bold tabular-nums sm:text-2xl">
                        {d.v == null ? "—" : formatDollars(d.v)}
                      </dd>
                    </div>{" "}
                  </Fragment>
                ))}
              </dl>
              <p className="mt-5 text-sm text-muted-foreground">
                Cut at five points, from{" "}
                {ladder.count.toLocaleString("en-US")} certified cases with a
                readable wage.
              </p>
            </section>
          ) : null}

          {/* The explorer leads with its own heading ("What does this job pay on a PERM?") and says what it filters. */}
          <section id="explore" data-embed="salary-explorer" className="mt-10">
            <WageExplorer />
          </section>

          {ladders.length > 0 ? (
            <FigurePlate
              title="Two pay scales, one process"
              subject={`${ladders.length} busiest occupations, ordered by filing volume`}
              caption={
                <>
                  <TwoMarketsNote ladders={ladders} className="mb-3" />
                  Each row is one occupation&apos;s certified offers, cut at
                  seven points. Ordered by filing volume. Hourly and
                  other wage units are annualized first.
                </>
              }
              source="DOL PERM disclosure files, certified cases only"
              className="mt-10"
              id="by-job"
            >
              <LadderCombViews
                label="Wage ladder by occupation"
                subjectLabel="Occupation"
                ladders={ladders}
                href={(l) => {
                  const slug = slugByCode.get(l.key);
                  return slug ? entityHref("occupation", slug) : null;
                }}
              />
            </FigurePlate>
          ) : null}

          {stateLadders.length > 0 ? (
            <FigurePlate
              title="Every state on one axis"
              subject={`${stateLadders.length} states and territories with ${MIN_CASES_FOR_LADDER}+ certified cases`}
              caption={
                <>
                  <SplitLadderNote ladders={stateLadders} className="mb-3" />
                  Each row is one state&apos;s certified offers, cut at seven points, ordered by how many cases it
                  files. These come from the pre-computed cells, and the filters above don&apos;t change them, so they
                  cover the whole window and every state at once.
                </>
              }
              source="DOL PERM disclosure files, certified cases only"
              className="mt-10"
              id="by-state"
            >
              <LadderCombViews label="Wage ladder by state" subjectLabel="State" ladders={stateLadders} />
            </FigurePlate>
          ) : null}

          {bandsPooled.length > 0 ? (
            <FigurePlate
              title="Denial rate by wage band"
              subject="Certified and denied cases, by fiscal year"
              caption="Measured rates, each with the decided cases behind it. Nothing here says what a particular wage does to a particular case."
              source="DOL PERM disclosure files"
              className="mt-10"
              id="denials"
            >
              <DenialByWageBand byYear={bandsByYear} pooled={bandsPooled} />
            </FigurePlate>
          ) : null}

          <section id="all" className="mt-16 border-t-4 border-foreground pt-4">
            <h2 className="font-heading text-3xl font-bold leading-tight sm:text-4xl">
              All {occupationCount.toLocaleString("en-US")} occupations
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              Search, filter by job family, sort any column, or download the CSV.
            </p>
            <div className="mt-6">
              <EntityExplorer kind="occupation" rows={occupations} total={occupationCount} />
            </div>
          </section>

          {/* The table above is a client component: its rows are fetched and
              filtered in the browser, so a crawler sees the server-rendered
              seed links and none of the other occupation pages. The A-Z strip
              is the crawlable path to all of them. */}
          <div id="a-z" className="mt-16">
            <BrowseTeaser kind="occupation" />
          </div>
        </>
      ) : (
        <section className="mt-10 bg-tint p-8 text-center border-2 shadow-hard border-border">
          <p className="text-lg text-muted-foreground">
            The occupation aggregates land with the quarterly disclosure
            ingest. Until then, the{" "}
            <Link href="/perm-processing-times" className="link">
              processing times page
            </Link>{" "}
            carries the live queue.
          </p>
        </section>
      )}

      <section className="mt-12 grid [&>*]:min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div >
          <h2 className="font-heading text-lg font-bold">Comparing an offer?</h2>{" "}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            <Link href="/tools/compare-my-offer" className="link">
              Compare my offer
            </Link>{" "}
            places one wage against cases for the same job, and the{" "}
            <Link href="#explore" className="link">
              filters above
            </Link>{" "}
            recompute the ladder over any occupation, state and year.
          </p>
        </div>
        <div >
          <h2 className="font-heading text-lg font-bold">Wondering about pace?</h2>{" "}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A case&apos;s speed depends on its filing month. Its wage doesn&apos;t change it. The{" "}
            <Link href="/perm-decision-activity" className="link">
              decision activity
            </Link>{" "}
            page carries how much DOL clears each day.{" "}
            <Link href="/methodology" className="link">
              Methodology
            </Link>
            .
          </p>
        </div>
      </section>
      <section className="mt-12" aria-labelledby="wage-faqs">
        <h2 id="wage-faqs" className="font-heading text-2xl font-bold">
          Questions
        </h2>{" "}
        <FaqList items={FAQS} />
      </section>
      <PageBasics page="perm-wages" />{" "}
      <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Filings newer than DOL&apos;s last published file aren&apos;t in this table: DOL reports the occupation and the wage only when it publishes the decided case. Those cases are on the <Link href="/perm-cases#live" className="link">live list</Link>, by employer.
      </p>{" "}
      <DataProvenance datasets={["perm-cases", "entities"]} />
    </div>
  );
}
