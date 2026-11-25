import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";

import { DataProvenance } from "@/components/data/DataProvenance";
import { ChartTips } from "@/components/data/ChartTips";
import { EmptyState } from "@/components/data/EmptyState";
import { IndexHeader, IndexSearch } from "@/components/data/IndexHeader";
import { ChapterFold } from "@/components/entities/ChapterFold";
import { EntityStatCards } from "@/components/entities/EntityPageParts";
import { ProfileHeader } from "@/components/entities/ProfileHeader";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { CaseNextStep } from "@/components/tools/CaseNextStep";
import { fiscalYearOf } from "@convex/lib/months";
import { getFreshness } from "@/lib/db/publicData";
import { breadcrumbSchema } from "@/lib/breadcrumbs";
import { groupDescription, h1bCityDescription } from "@/lib/groupDescription";
import { naicsSectorTitle } from "@/lib/naicsSectors";
import { openGraphBase } from "@/lib/openGraphBase";
import { countryYears, getGroup, GROUP_PATH, listGroups, type GroupKind } from "@/lib/db/groups";
import { formatInt } from "@/lib/format";
import { lcaCityByKey, lcaCityBySlug, type LcaCity } from "@/lib/db/lcaCities";

import { CityReference } from "@/components/reference/CityReference";

import { CityH1b } from "./CityH1b";
import { GroupIndexTable, type GroupIndexRow } from "./GroupIndexTable";
import { GroupView, groupAnswer, groupFigures } from "./GroupView";
import { industryFrames, industryName, industryTitle } from "@/lib/industryTitle";
import { fitTitle, metadataTitle } from "@/lib/pageTitle";
import { softFail } from "@/lib/softRead";
import { KeepWhole, keepWhole } from "@/components/ui/keep-whole";

/**
 * The shared body of the six browse routes (an index and a detail page per
 * kind). Route files stay thin because Next wants their segment config
 * (revalidate, dynamicParams) written as literals in each file.
 */

interface KindCopy {
  indexTitle: string;
  indexH1: string;
  indexLede: string;
  indexDescription: string;
  noun: string;
  facetLabel: string | null;
  /** The whole title, for the share card; the page's <title> is this fitted to 60 by `fitTitle`, cut only at a word. */
  detailTitle: (label: string, key: string) => string;
  detailH1: (label: string) => string;
  coverage: string;
}

/** What a reader types into each list's search box. */
const SEARCH_TITLE: Record<GroupKind, string> = { city: "Filter cities", industry: "Filter industries", country: "Filter countries" };
const SEARCH_HINT: Record<GroupKind, string> = {
  city: "Seattle, Austin",
  industry: "Software, poultry, hospitals",
  country: "India, Brazil",
};

const COPY: Record<GroupKind, KindCopy> = {
  city: {
    indexTitle: "PERM Jobs by City",
    indexH1: "PERM sponsorship by city",
    indexLede:
      "Every worksite city with 20 or more PERM decisions since FY2016: how many, how many were approved, what they paid and who filed them.",
    indexDescription:
      "PERM decisions by worksite city since FY2016: approval rates, median certified wages and the employers and jobs behind them, from DOL's files.",
    noun: "cities",
    facetLabel: "State",
    detailTitle: (l) => `PERM Jobs in ${l}`,
    detailH1: (l) => `PERM jobs in ${l}`,
    coverage:
      "The worksite city on each application, from DOL's decided cases since FY2016. Spellings of one city are pooled, and a city counts as one place per state.",
  },
  industry: {
    indexTitle: "PERM by Industry",
    indexH1: "PERM sponsorship by industry",
    indexLede:
      "Every industry, by the NAICS code the employer put on the form, with 20 or more PERM decisions since FY2016. The titles are the Census Bureau's.",
    indexDescription:
      "PERM decisions by industry (the employer's NAICS code) since FY2016: approval rates, median certified wages, top sponsors and jobs, from DOL's files.",
    noun: "industries",
    facetLabel: "Sector",
    // People search these pages by code ("naics code 238340"), so the code is in
    // the title. Census titles run to 126 characters; when the plain form doesn't
    // fit Google's 60, the code leads and the name is cut at a word (industryFrames).
    detailTitle: industryTitle,
    detailH1: (l) => `PERM in ${l}`,
    coverage:
      "The industry is the NAICS code the employer entered on the form. DOL publishes the code alone. The title is the Census Bureau's, and a code Census never defined takes its parent group's title.",
  },
  country: {
    indexTitle: "PERM by Country of Citizenship",
    indexH1: "PERM sponsorship by citizenship",
    indexLede:
      "Every country with 20 or more PERM decisions on DOL's old form, FY2016 to FY2024, with each country's yearly record back to FY2008.",
    indexDescription:
      "PERM decisions by the worker's country of citizenship, FY2008 to FY2023, with approval rates, wages, sponsors and jobs, from DOL's old-form files.",
    noun: "countries",
    facetLabel: null,
    detailTitle: (l) => `PERM Cases for Citizens of ${l}`,
    detailH1: (l) => `PERM cases for citizens of ${l}`,
    coverage:
      "DOL printed the worker's citizenship, education and visa on its old form, and the last cases filed on it were decided in FY2024. The form in use since mid-2023 doesn't carry them. So these pages describe FY2008 to FY2023 (years) and FY2016 to FY2024 (everything else).",
  },
};

export function groupIndexMetadata(kind: GroupKind): Metadata {
  const c = COPY[kind];
  const path = GROUP_PATH[kind];
  // The route wraps this in withSocialCard with its own card slug.
  return {
    title: c.indexTitle,
    description: c.indexDescription,
    alternates: { canonical: path },
    openGraph: { ...openGraphBase, title: `${c.indexTitle} | PERM Tracker`, description: c.indexDescription, url: path },
  };
}

export async function GroupIndexPage({ kind }: { kind: GroupKind }) {
  const c = COPY[kind];
  const path = GROUP_PATH[kind];
  const groups = await listGroups(kind);
  const rows: GroupIndexRow[] = groups.map((g) => ({
    slug: g.slug,
    label: g.label,
    total: g.total,
    certified: g.certified,
    denied: g.denied,
    withdrawn: g.withdrawn,
    medianWage: g.medianWage,
    fyFrom: g.fyFrom,
    fyTo: g.fyTo,
    facet: kind === "city" ? g.key.split("|")[1] ?? null : kind === "industry" ? naicsSectorTitle(g.key) : null,
  }));
  const all = rows.reduce((n, r) => n + r.total, 0);
  const top = rows.slice(0, 12);
  const topMax = Math.max(1, ...top.map((r) => r.total));
  const leader = rows[0] ?? null;
  const tenShare = all > 0 ? Math.round((rows.slice(0, 10).reduce((n, r) => n + r.total, 0) / all) * 100) : null;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <IndexHeader
        title={c.indexH1}
        lede={c.indexLede}
        figures={
          rows.length > 0
            ? [
                { kind: "measured" as const, label: `${c.noun[0]!.toUpperCase()}${c.noun.slice(1)} with a page`, value: formatInt(rows.length) },
                ...(leader
                  ? [{ kind: "measured" as const, label: "The busiest", value: leader.label, href: `${path}/${leader.slug}`, note: `${formatInt(leader.total)} decisions` }]
                  : []),
                ...(tenShare !== null ? [{ kind: "measured" as const, label: "The ten busiest hold", value: `${tenShare}%`, note: `of ${formatInt(all)} decisions` }] : []),
              ]
            : []
        }
        aside={
          rows.length > 0 ? (
            <IndexSearch title={SEARCH_TITLE[kind]} action={`${path}#all`} placeholder={SEARCH_HINT[kind]} />
          ) : undefined
        }
      />{" "}
      {rows.length === 0 ? (
        <EmptyState
          title={`The ${c.noun} will list here`}
          spot="topic-data-notes"
          action={{ href: "/case-search", label: "Search DOL's case files" }}
          className="mt-10"
        >
          This breakdown hasn&apos;t been built from DOL&apos;s files yet. Every case is already in the case search.
        </EmptyState>
      ) : (
        <>
          <section className="mt-10">
            <div >
              <h2 className="font-heading text-xl font-bold">{`The ${top.length} busiest, by decisions`}</h2>{" "}
              <ChartTips label={`The ${top.length} busiest ${c.noun}, by PERM decisions`} className="mt-5">
                <ol className="space-y-2.5">
                  {top.map((r) => {
                    const decided = r.certified + r.denied;
                    return (
                      <Fragment key={r.slug}>
                      {" "}
                      <li
                        data-tip={[
                          r.label,
                          `${formatInt(r.total)} decisions`,
                          decided > 0 ? `${((r.certified / decided) * 100).toFixed(1)}% approved` : null,
                          r.medianWage ? `Median wage $${formatInt(r.medianWage)}` : null,
                        ]
                          .filter(Boolean)
                          .join("\n")}
                        // On a phone the name sits above its bar; side by side, a
                        // long name took the whole row and the bar vanished.
                        className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5rem] [&>*]:min-w-0"
                      >
                        {/* 44px to tap on a phone, where the name sits alone on its line. */}
                        <Link
                          href={`${path}/${r.slug}`}
                          className="link col-span-2 block truncate py-3 text-sm leading-5 sm:col-span-1 sm:py-0"
                        >
                          {keepWhole(r.label)}
                        </Link>{" "}
                        <span aria-hidden="true" className="block h-5">
                          <span
                            className="block h-full border-input bg-primary border"
                            style={{ width: `${Math.max(3, (r.total / topMax) * 100)}%` }}
                          />
                        </span>{" "}
                        <span className="text-right text-sm font-bold tabular-nums">{formatInt(r.total)}</span>
                      </li>
                      </Fragment>
                    );
                  })}
                </ol>
              </ChartTips>
            </div>
          </section>{" "}
          <section id="all" className="mt-16 border-t-4 border-foreground pt-4">
            <h2 className="font-heading text-3xl font-bold leading-tight sm:text-4xl">{`All ${formatInt(rows.length)} ${c.noun}`}</h2>{" "}
            <div className="mt-6">
              <GroupIndexTable
                rows={rows}
                basePath={path}
                noun={c.noun}
                facetLabel={c.facetLabel}
                caption={`${formatInt(rows.length)} ${c.noun}, busiest first`}
              />
            </div>
          </section>
        </>
      )}
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">{c.coverage}</p>
      <DataProvenance datasets={["perm-cases"]} />
    </div>
  );
}

/**
 * A city with 20 or more H-1B LCAs and too few PERM cases for a PERM page
 * (lca_cities, Oct 4 2026). Null for every other kind and slug.
 */
async function h1bOnlyCity(kind: GroupKind, slug: string): Promise<LcaCity | null> {
  if (kind !== "city") return null;
  const c = await lcaCityBySlug(slug);
  return c && !c.hasPermPage ? c : null;
}

export async function groupDetailMetadata(kind: GroupKind, slug: string): Promise<Metadata> {
  const g = await getGroup(kind, slug);
  if (!g) {
    const city = await h1bOnlyCity(kind, slug);
    // notFound() here, at the earliest point, so a junk slug answers 404 and
    // not a 200 streamed before the page could decide (the soft-404 rule).
    if (!city) notFound();
    const path = `${GROUP_PATH.city}/${slug}`;
    const title = `H-1B Jobs in ${city.label}`;
    const description = h1bCityDescription(city);
    return {
      title: metadataTitle(fitTitle(city.label, [(n) => `H-1B Jobs in ${n}`])),
      description,
      alternates: { canonical: path },
      openGraph: { ...openGraphBase, title, description, url: path },
    };
  }
  const c = COPY[kind];
  const path = `${GROUP_PATH[kind]}/${slug}`;
  const title = c.detailTitle(g.label, g.key);
  // The page's own name leads the description: without it, two places with the same count would share one word for word.
  const description = groupDescription({ kind, label: g.label, key: g.key, total: g.total, fyFrom: g.fyFrom, fyTo: g.fyTo });
  const fitted =
    kind === "industry" ? fitTitle(industryName(g.label), industryFrames(g.key)) : fitTitle(g.label, [(n) => c.detailTitle(n, g.key)]);
  return {
    title: metadataTitle(fitted),
    description,
    alternates: { canonical: path },
    openGraph: { ...openGraphBase, title, description, url: path },
  };
}

export async function GroupDetailPage({ kind, slug }: { kind: GroupKind; slug: string }) {
  const g = await getGroup(kind, slug);
  if (!g) {
    const city = await h1bOnlyCity(kind, slug);
    if (!city) notFound();
    return (
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16">
        <div className="pt-10 sm:pt-12" />
        <JsonLdScript schema={breadcrumbSchema(`${GROUP_PATH.city}/${slug}`, city.label)} />
        <header>
          <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl"><KeepWhole>{"H-1B jobs in "}</KeepWhole>{keepWhole(city.label)}</h1>{" "}
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted-foreground">
            Fewer than 20 PERM green card cases name {keepWhole(city.label)}<KeepWhole>{" as the worksite, so this city has no PERM page. Its H-1B record is below."}</KeepWhole>
          </p>
        </header>
        <CityH1b city={city} />
        <CityReference
          cityKey={city.key}
          label={city.label}
          jobs={city.occupations.map((o) => ({ code: o.code, title: o.title, slug: o.slug, n: o.n }))}
          jobsNoun="certified LCAs"
        />
        <DataProvenance datasets={["lca-disclosure", "census-geo", "bls-oews", "oflc-wage-levels"]} />
      </div>
    );
  }
  const c = COPY[kind];
  const [years, h1b, freshness] = await Promise.all([
    kind === "country" ? countryYears(g.key) : Promise.resolve(undefined),
    kind === "city" ? lcaCityByKey(g.key).catch(softFail("GroupPages.lcaCityByKey", null)) : Promise.resolve(null),
    getFreshness().catch(softFail("GroupPages.getFreshness", null)),
  ]);
  // The newest fiscal year is partial until DOL's file for its fourth quarter is in, so the year-on-year move
  // compares the two complete years before it. A country's series ends in FY2023, every year complete.
  const disclosedThrough = freshness?.["perm-cases"]?.asOf?.slice(0, 10) ?? null;
  const partialFy = kind !== "country" && disclosedThrough && !/-09-30$/.test(disclosedThrough) ? fiscalYearOf(disclosedThrough) : null;
  const series = years && years.length > 0 ? years : g.detail.years;
  const breadcrumb = breadcrumbSchema(`${GROUP_PATH[kind]}/${slug}`, g.label);
  const ask = CASE_QUESTION[kind](g.label);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={breadcrumb} />
      {/* The employer page's order: the name and its answer line, the case box (first on a phone, beside the name on
          a wide header), then three figures. */}
      <ProfileHeader
        eyebrow={EYEBROW[kind](g.key)}
        name={c.detailH1(g.label)}
        answer={groupAnswer(kind, g)}
        aside={<CaseNextStep question={ask} source={`${kind}-page`} />}
        figures={
          <section aria-label="Its record in three figures">
            <EntityStatCards cards={groupFigures(g, series, partialFy)} />
          </section>
        }
      />
      <GroupView kind={kind} group={g} yearsOverride={years} />
      {kind === "city" ? (
        <CityReference
          cityKey={g.key}
          label={g.label}
          jobs={g.detail.occupations.map((o) => ({ code: o.code, title: o.title, slug: o.slug, n: o.n }))}
          jobsNoun="PERM decisions"
        />
      ) : null}
      {h1b ? (
        <ChapterFold summary="Its H-1B record" hint="Labor condition applications that name a worksite here" className="mt-10">
          <CityH1b city={h1b} className="" />
        </ChapterFold>
      ) : null}
      <p className="mt-8 max-w-3xl text-sm leading-relaxed text-muted-foreground">{c.coverage}</p>
      <DataProvenance
        datasets={[
          "perm-cases",
          ...(h1b ? ["lca-disclosure"] : []),
          ...(kind === "city" ? ["census-geo", "bls-oews", "oflc-wage-levels"] : []),
        ]}
      />
      {/* The page ends on the reader's own next step, as the employer page does. */}
      <CaseNextStep
        question={`Still ${ask.charAt(0).toLowerCase()}${ask.slice(1)}`}
        source={`${kind}-page-end`}
        label="Check your case, at the end of the page"
        className="mt-16 max-w-2xl"
      />
    </div>
  );
}

/** The small line above the name: which list this page belongs to. */
const EYEBROW: Record<GroupKind, (key: string) => string> = {
  city: () => "PERM by worksite city",
  industry: (key) => `PERM by industry, NAICS ${key}`,
  country: () => "PERM by the worker's country of citizenship",
};

/** The case box's question, in the page's own terms. */
const CASE_QUESTION: Record<GroupKind, (label: string) => string> = {
  city: (l) => `Waiting on a case for a job in ${l}?`,
  industry: () => "Waiting on a case in this industry?",
  country: () => "Waiting on your own PERM case?",
};

/** The busiest groups, prerendered at build; the rest render on first visit. */
export async function groupStaticParams(kind: GroupKind, n = 25): Promise<{ slug: string }[]> {
  const groups = await listGroups(kind).catch(softFail("GroupPages.listGroups", []));
  return groups.slice(0, n).map((g) => ({ slug: g.slug }));
}
