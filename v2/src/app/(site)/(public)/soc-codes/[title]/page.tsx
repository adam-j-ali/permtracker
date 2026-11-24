/**
 * One job title's SOC code: the codes employers filed it under in DOL's files, each with its
 * share, BLS's national pay for each, and O*NET's description and tasks for each side by side,
 * so a title filed two ways shows what the choice means. A page for every title with 50+ filings (scripts/build_soc_titles.py).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Fragment } from "react";
import { ChartPieSliceIcon, CurrencyDollarIcon, HashIcon } from "@phosphor-icons/react/ssr";

import { BarRows, type BarRow } from "@/components/data/BarRows";
import { Figure, FigureRow } from "@/components/data/FigureRow";
import { SplitBar } from "@/components/data/FigureVisual";
import { SocCodeText } from "@/components/data/SocCodeText";
import { PageSection } from "@/components/data/PageSection";
import { SplitColumns } from "@/components/data/SplitColumns";
import { ChapterFold } from "@/components/entities/ChapterFold";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { CodeCards } from "@/components/soc/CodeCards";
import { SocSources } from "@/components/soc/SocSources";
import { CaseNextStep } from "@/components/tools/CaseNextStep";
import { FaqList } from "@/components/tools/FaqList";
import { breadcrumbSchema } from "@/lib/breadcrumbs";
import { codeSummaries, marketPayNational, onetReference } from "@/lib/db/reference";
import { PRERENDERED_ENTITY_HEAD } from "@/lib/db/entities";
import { getSocCodes, getSocTitle, getSocTitlePages } from "@/lib/db/socTitles";
import { formatDollars, formatInt, formatShareOf } from "@/lib/format";
import { openGraphBase } from "@/lib/openGraphBase";
import { fitTitle, metadataTitle } from "@/lib/pageTitle";
import { codeHref, zoneLabelOf, type TitleAnswer, type TitleCode } from "@/lib/socFinder";
import { keyOfSlug } from "@/lib/socTitleKey";
import { finderHref, DEFAULT_FILTERS } from "@/lib/sponsorFinder";
import { withSocialCard } from "@/lib/socialCard";
import { softFail } from "@/lib/softRead";
import { socTitleDescription } from "@/lib/socTitleDescription";
import { keepWhole } from "@/components/ui/keep-whole";

// The titles move with the quarterly loads.
export const revalidate = 604800;

/**
 * The busiest titles are built ahead, as the entity pages' head is (PRERENDERED_ENTITY_HEAD): the doc lists them
 * busiest first, so the head is also the traffic, warm from the first request after a deploy. The other 3,700
 * render on their first visit and keep a week. A build that can't read the list prerenders none and records why.
 */
export async function generateStaticParams() {
  const doc = await getSocTitlePages().catch(softFail("soc-codes/[title].generateStaticParams", null));
  return (doc?.pages ?? []).slice(0, PRERENDERED_ENTITY_HEAD).map((p) => ({ title: p.slug }));
}

/** Read once per render: the metadata and the page both ask. */
const answerFor = cache(async (slug: string): Promise<TitleAnswer | null> => {
  const key = keyOfSlug(slug);
  if (!key) return null;
  const a = await getSocTitle(key);
  // Only a title with its own page answers here; the rest are found through the finder.
  return a?.slug === slug ? a : null;
});

const filedCodes = (a: TitleAnswer) => a.codes.filter((c) => c.filings > 0);

/** "an" before a vowel sound as written ("an Accountant", "an HR Manager"), else "a". */
function article(title: string): string {
  return /^(?:[aeiou]|hr\b|mba\b|rn\b|it\b|sap\b|fp|x-?ray)/i.test(title) && !/^(?:u[nks]i|use|eu|one\b)/i.test(title) ? "an" : "a";
}

function describe(a: TitleAnswer): string {
  const [top, ...rest] = filedCodes(a);
  if (!top) return `The SOC codes O*NET lists for ${a.title}.`;
  const others = rest.length ? `, and under ${rest.length} other ${rest.length === 1 ? "code" : "codes"}` : "";
  return `Employers filed ${a.title} under ${top.soc} ${top.codeTitle} in ${formatShareOf(top.filings, a.total)} of ${formatInt(a.total)} filings in DOL's files${others}.`;
}

export async function generateMetadata({ params }: { params: Promise<{ title: string }> }): Promise<Metadata> {
  const slug = (await params).title;
  const a = await answerFor(slug);
  if (!a) notFound();
  const path = `/soc-codes/${slug}`;
  const title = `SOC Code for ${a.title}`;
  const filed = filedCodes(a);
  const top = filed[0];
  // The same cached read the page makes, so the pay is printed in the description only when the page shows it.
  const market = top ? await marketPayNational(top.soc).catch(softFail("soc-codes/[title]/metadata.marketPayNational", null)) : null;
  const description = socTitleDescription({ title: a.title, total: a.total, codes: filed, pay: market ? market.median : null });
  return withSocialCard(
    {
      // The title is the searched phrase: the brand gives way first, then the name is cut at a word.
      title: metadataTitle(fitTitle(a.title, [(n) => `SOC Code for ${n}`])),
      description,
      alternates: { canonical: path },
      openGraph: { ...openGraphBase, title: `${title} | PERM Tracker`, description, url: path },
    },
    "soc-codes",
  );
}

function codeRow(c: TitleCode, total: number, pay: number | null): BarRow {
  const programs = [
    c.perm ? `${formatInt(c.perm)} PERM` : null,
    c.pwd ? `${formatInt(c.pwd)} wage requests` : null,
    c.lca ? `${formatInt(c.lca)} H-1B LCAs` : null,
  ].filter(Boolean);
  const notes = [
    pay ? `BLS median ${formatDollars(pay)} a year` : null,
    c.zone ? `Job Zone ${zoneLabelOf(c.zone)}` : null,
    c.becameCodes.length ? `a 2010 code, now ${c.becameCodes.join(" or ")}` : null,
  ].filter(Boolean);
  return {
    key: c.soc,
    label: (
      <Link href={codeHref(c.soc, c.slug)} className="link">
        <span className="whitespace-nowrap font-mono">{c.soc}</span> {c.codeTitle}
      </Link>
    ),
    sub: [programs.join(", "), notes.join(". ")].filter(Boolean).join(". "),
    value: c.filings,
    text: formatShareOf(c.filings, total),
    tone: "primary",
  };
}

export default async function SocTitlePage({ params }: { params: Promise<{ title: string }> }) {
  const slug = (await params).title;
  const [a, codes] = await Promise.all([answerFor(slug), getSocCodes()]);
  if (!a) notFound();
  const path = `/soc-codes/${slug}`;
  const filed = filedCodes(a);
  const onetOnly = a.codes.filter((c) => c.filings === 0);
  const top = filed[0] ?? null;
  const [pays, summaries, onet] = await Promise.all([
    Promise.all(filed.slice(0, 8).map((c) => marketPayNational(c.soc).catch(softFail("soc-codes/[title]/page.marketPayNational", null)))),
    codeSummaries(filed.slice(0, 12).map((c) => c.soc)),
    onetReference(),
  ]);
  const payOf = new Map(filed.slice(0, 8).map((c, i) => [c.soc, pays[i]?.median ?? null]));
  const spellings = top?.spellings ?? [];
  const topSummary = top ? summaries.get(top.soc) : undefined;
  const faqs = [
    { q: `What is the SOC code for ${a.title}?`, a: describe(a) },
    ...(top && topSummary
      ? [{ q: `What does ${article(a.title)} ${a.title} do?`, a: `O*NET describes ${top.soc} ${top.codeTitle}, the code it's filed under most, this way: ${topSummary.description}` }]
      : []),
    {
      q: `Which code should ${article(a.title)} ${a.title} job use?`,
      a: "The code follows the job's duties and requirements, whatever title the employer gives it. DOL's National Prevailing Wage Center decides it on the wage request. When employers split a title between codes, the work decides.",
    },
    // For the worker: describing past jobs in terms that match the PERM position, so the experience qualifies.
    // 8 CFR 204.5(g)(1), read on eCFR's Oct 19 2026 edition.
    {
      q: `Can I use O*NET's tasks for ${article(a.title)} ${a.title} job to describe my past experience?`,
      a: "Use them to see which of your past duties match the job. The letter itself still describes what you did: USCIS asks for letters from current or former employers with \"a specific description of the duties performed\" (8 CFR 204.5(g)(1)), so each one is written from your own work there.",
    },
  ];
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage" as const,
    mainEntity: faqs.map((f) => ({ "@type": "Question" as const, name: f.q, acceptedAnswer: { "@type": "Answer" as const, text: f.a } })),
  };
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-12">
      <JsonLdScript schema={breadcrumbSchema(path, a.title)} />{" "}
      <JsonLdScript schema={faqSchema} />
      {/* The answer and what to do with it side by side on a wide screen: the code, then its wage levels, its
          sponsors and similar titles. On a phone the steps follow the answer, before the figures. */}
      <SplitColumns
        aside={
          top ? (
            <section aria-labelledby="next-title" className="border-2 border-border bg-card p-5 shadow-hard-sm sm:p-6">
              <h2 id="next-title" className="font-heading text-xl font-bold">
                With the code
              </h2>{" "}
              <ul className="mt-2 space-y-1 text-base">
                <li>
                  <Link href={`/tools/wage-levels?soc=${top.soc}`} className="link inline-flex min-h-11 items-center">
                    DOL&apos;s four wage levels for {top.soc} in your area
                  </Link>{" "}
                </li>{" "}
                {top.slug ? (
                  <li>
                    <Link href={finderHref({ ...DEFAULT_FILTERS, job: top.slug })} className="link inline-flex min-h-11 items-center">
                      Every employer that sponsors it, with approval rates and wages
                    </Link>{" "}
                  </li>
                ) : null}{" "}
                <li>
                  <Link href={`/soc-codes?q=${encodeURIComponent(a.title)}`} className="link inline-flex min-h-11 items-center">
                    Similar titles in the finder
                  </Link>{" "}
                </li>
              </ul>
            </section>
          ) : null
        }
      >
        <header>
          <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">SOC code for {keepWhole(a.title)}</h1>{" "}
          <p className="mt-4 text-lg leading-relaxed text-soft">
            <SocCodeText text={describe(a)} />
          </p>
        </header>
      </SplitColumns>{" "}
      {top ? (
        // Three figures. The code is the answer, so it takes the dark card; lime stays on the action. Its O*NET Job
        // Zone, a fourth figure before, is the answer's note.
        <FigureRow className="mt-8">
          <Figure
            kind="measured"
            tone="ink"
            label="Filed most under"
            icon={<HashIcon weight="bold" />}
            value={top.soc}
            note={top.zone ? `${top.codeTitle}. O*NET Job Zone ${zoneLabelOf(top.zone)} of 5.` : top.codeTitle}
          />{" "}
          <Figure
            kind="measured"
            label="Of its filings"
            icon={<ChartPieSliceIcon weight="bold" className="text-primary-text" />}
            value={formatShareOf(top.filings, a.total)}
            visual={
              <SplitBar
                parts={[
                  { value: top.filings, tone: "info" },
                  { value: a.total - top.filings, tone: "none" },
                ]}
                label={`${formatShareOf(top.filings, a.total)} of the ${formatInt(a.total)} filings with this title used code ${top.soc}`}
              />
            }
            note={`${formatInt(a.total)} in all`}
          />{" "}
          {payOf.get(top.soc) ? (
            <Figure kind="official"
              label="BLS median pay for the code"
              icon={<CurrencyDollarIcon weight="bold" className="text-primary-text" />}
              value={formatDollars(payOf.get(top.soc)!)}
              note="a year, nationally"
            />
          ) : null}
        </FigureRow>
      ) : null}{" "}
      {filed.length ? (
        <PageSection
          id="codes"
          title="Every code employers used"
          lede="Each code's share of the title's filings in DOL's PERM, wage request and H-1B files. Codes under 1% aren't listed."
        >
          <BarRows rows={filed.map((c) => codeRow(c, a.total, payOf.get(c.soc) ?? null))} inline label={`Codes ${a.title} was filed under`} />
        </PageSection>
      ) : null}{" "}
      {onetOnly.length ? (
        <p className="mt-6 max-w-3xl text-base text-soft">
          O*NET also lists {keepWhole(a.title)} under{" "}
          {onetOnly.slice(0, 6).map((c, i, all) => (
            <Fragment key={c.soc}>
              <Link href={codeHref(c.soc, c.slug)} className="link">
                {c.soc} {c.codeTitle}
              </Link>
              {i < all.length - 1 ? ", " : "."}{" "}
            </Fragment>
          ))}
        </p>
      ) : null}{" "}
      <CodeCards title={a.title} codes={filed.slice(0, 12)} summaries={summaries} total={a.total} payOf={payOf} version={onet.version} />{" "}
      {spellings.length > 1 && top ? (
        <ChapterFold summary="How employers wrote it" hint={`The commonest spellings filed under ${top.soc}`} className="mt-10">
          <ul id="spellings" className="flex flex-wrap gap-2">
            {spellings.map(([s, n]) => (
              <li key={s} className="border-2 border-border bg-card px-3 py-1.5 text-base">
                {s} <span className="font-mono text-sm text-soft tabular-nums">{formatInt(n)}</span>{" "}
              </li>
            ))}
          </ul>
        </ChapterFold>
      ) : null}{" "}
      <section className="mt-12 max-w-3xl">
        <h2 className="font-heading text-2xl font-bold">FAQs</h2>
        <FaqList items={faqs} />
      </section>{" "}
      <SocSources codes={codes} />{" "}
      {/* The page ends on the reader's own next step. */}
      <CaseNextStep question={`Waiting on a case for a ${a.title} job?`} source="soc-title" numberKind="DOL" className="mt-12 max-w-2xl" />
    </div>
  );
}
