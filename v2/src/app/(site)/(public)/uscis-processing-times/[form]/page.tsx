/**
 * One USCIS form's processing time: the median months USCIS took to decide
 * it each quarter, line by line, beside how many it took in, decided and had
 * waiting, and the FY2016 to FY2024 medians USCIS published once.
 *
 * It answers the search people make for their own form ("i-485 processing
 * time") with USCIS's own quarterly figures, which nothing else on the
 * internet charts quarter by quarter. Every number is USCIS's; nothing is
 * modelled. Which forms get a page, and how renamed rows join, is
 * `src/lib/uscisForms.ts`.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { HourglassMediumIcon, SealCheckIcon, TrayIcon, UsersIcon } from "@phosphor-icons/react/ssr";

import { BarRows, type BarRow } from "@/components/data/BarRows";
import { DataProvenance } from "@/components/data/DataProvenance";
import { FinePrint } from "@/components/data/FinePrint";
import { Figure, FigureRow } from "@/components/data/FigureRow";
import { PageSection } from "@/components/data/PageSection";
import { ColumnChart, type Column } from "@/components/numbers/ColumnChart";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { breadcrumbSchema } from "@/lib/breadcrumbs";
import { getUscisPosted } from "@/lib/db/uscisPosted";
import { getHistoricalMedians, getUscisFormRows, type HistoricalMedians } from "@/lib/db/uscisQuarterly";
import { formatAsOf } from "@/lib/dolFormat";
import { formatInt, formatShare } from "@/lib/format";
import { openGraphBase } from "@/lib/openGraphBase";
import { PROCESSING_TIMES_SOURCE_URL } from "@/lib/processing-times/i140ProcessingTimes";
import { withSocialCard } from "@/lib/socialCard";
import { easternDay } from "@/lib/time";
import {
  FORM_PAGES,
  approvedShare,
  formPage,
  formTotals,
  lineSeries,
  quarterSlots,
  slotShort,
  type FormPage,
  type LinePoint,
  type Slot,
} from "@/lib/uscisForms";
import { isCurrent, postedByCategory, type PostedCategory } from "@/lib/uscisPosted";
import { monthsLabel, quarterLabel } from "@/lib/uscisQuarterlyShape";
import { approvalMoved, countMoved, medianMoved } from "@/lib/uscisTrends";
import { softFail } from "@/lib/softRead";

// The workbook changes four times a year; the quarterly ingest's new quarter is
// picked up within a week, as on the hub.
export const revalidate = 604800;
export const dynamicParams = false;

export async function generateStaticParams() {
  return FORM_PAGES.map((p) => ({ form: p.slug }));
}

const titleOf = (p: FormPage) => `${p.form} Processing Time: USCIS's Median`;
const descriptionOf = (p: FormPage) =>
  `How long USCIS took to decide the ${p.form} each quarter (its median), with forms received, decided and waiting, from USCIS's own quarterly data.`;

export async function generateMetadata({ params }: { params: Promise<{ form: string }> }): Promise<Metadata> {
  const page = formPage((await params).form);
  if (!page) notFound();
  const path = `/uscis-processing-times/${page.slug}`;
  return withSocialCard(
    {
      title: titleOf(page),
      description: descriptionOf(page),
      alternates: { canonical: path },
      openGraph: { ...openGraphBase, title: `${titleOf(page)} | PERM Tracker`, description: descriptionOf(page), url: path },
    },
    "uscis-processing-times",
  );
}

/** "a month" for 1, else "N months", with USCIS's one decimal. */
function monthsPhrase(m: number): string {
  return m === 1 ? "1 month" : `${monthsLabel(m)} months`;
}

/**
 * USCIS's posted figure for each category, as bar rows. Where several offices post one category the bar is the
 * slowest office and the figure is the range, so a row never reads quicker than the reader's own office may be.
 */
function postedRows(categories: readonly PostedCategory[]): BarRow[] {
  return categories.map((c) => {
    const asked = c.requestDate ? formatAsOf(c.requestDate) : null;
    return {
      key: c.subtype,
      label: c.label,
      sub:
        c.offices > 1
          ? `The quickest and the slowest of ${c.offices} offices`
          : asked
            ? `USCIS takes a question about a case it received before ${asked}`
            : undefined,
      value: c.max,
      nullText: c.note ?? "No figure posted",
      text: c.min === null || c.max === null ? "" : c.min === c.max ? monthsPhrase(c.max) : `${monthsLabel(c.min)} to ${monthsPhrase(c.max)}`,
    };
  });
}

function medianColumns(points: readonly LinePoint[]): Column[] {
  const last = points.length - 1;
  return points.map((p, i) => {
    const m = p.row?.medianMonths ?? null;
    const when = quarterLabel(p.slot.fy, p.slot.quarter);
    if (p.slot.gap) return { key: slotShort(p.slot), value: 0, gap: true, label: when, tip: `${when}\nNo copy of USCIS's workbook for this quarter is held` };
    if (m === null) return { key: slotShort(p.slot), value: 0, gap: true, label: when, tip: `${when}\nUSCIS printed no median for it` };
    return {
      key: slotShort(p.slot),
      value: m,
      label: when,
      now: i === last,
      top: monthsLabel(m),
      tip: [when, `Median ${monthsPhrase(m)}`, p.row?.completed != null ? `${formatInt(p.row.completed)} decided` : null]
        .filter(Boolean)
        .join("\n"),
    };
  });
}

function countColumns(slots: readonly { slot: Slot; value: number | null }[], noun: string): Column[] {
  const last = slots.length - 1;
  return slots.map(({ slot, value }, i) => {
    const when = quarterLabel(slot.fy, slot.quarter);
    if (slot.gap || value === null) {
      return { key: slotShort(slot), value: 0, gap: true, label: when, tip: `${when}\n${slot.gap ? "No copy of USCIS's workbook for this quarter is held" : "USCIS withheld a count"}` };
    }
    return { key: slotShort(slot), value, label: when, now: i === last, tip: `${when}\n${formatInt(value)} ${noun}` };
  });
}

function factsheetColumns(h: HistoricalMedians, basis: string): Column[] | null {
  const row = h.rows.find((r) => r.basis === basis);
  if (!row) return null;
  const last = h.years.length - 1;
  return h.years.map((fy, i) => ({
    key: `FY${fy}`,
    value: row.months[i] ?? 0,
    label: `FY${fy}`,
    top: monthsLabel(row.months[i] ?? null),
    tip: `FY${fy}${i === last ? " (October to January only)" : ""}\nMedian ${monthsPhrase(row.months[i] ?? 0)}`,
    partial: i === last,
  }));
}

export default async function UscisFormPage({ params }: { params: Promise<{ form: string }> }) {
  const page = formPage((await params).form);
  if (!page) notFound();
  const path = `/uscis-processing-times/${page.slug}`;
  const [rows, history, posted] = await Promise.all([
    getUscisFormRows(page.form),
    getHistoricalMedians().catch(softFail("uscis-processing-times/[form]/page.getHistoricalMedians", null)),
    // Throws on a failed read, like the rows: the page keeps its last good render for the week.
    getUscisPosted(),
  ]);
  // A posting too old to stand for "now" is left out: the quarterly median carries the page on its own.
  const categories = posted && isCurrent(posted, easternDay()) ? postedRows(postedByCategory(posted, page.form)) : [];
  const slots = quarterSlots(rows);
  const lines = page.lines
    .map((line) => ({ line, points: lineSeries(rows, line, slots) }))
    .filter((l) => l.points.length > 0);
  const totals = formTotals(rows, slots);
  const newest = [...totals].reverse().find((t) => !t.slot.gap && t.received !== null) ?? null;
  const lead = lines[0] ?? null;
  const leadNow = lead ? [...lead.points].reverse().find((p) => p.row?.medianMonths != null) ?? null : null;
  const share = newest ? approvedShare(newest) : null;
  const gaps = slots.filter((s) => s.gap);
  const factsheet = history
    ? lines.flatMap(({ line }) => {
        const cols = line.factsheet ? factsheetColumns(history, line.factsheet) : null;
        return cols ? [{ line, cols }] : [];
      })
    : [];
  const others = FORM_PAGES.filter((p) => p.slug !== page.slug);
  const first = slots[0];
  const last = slots[slots.length - 1];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <JsonLdScript schema={breadcrumbSchema(path, `${page.form} processing time`)} />
      <header className="max-w-3xl">
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">{page.form} processing time</h1>{" "}
        <p className="mt-3 text-lg font-semibold">{page.name}</p>{" "}
        <p className="mt-2 text-base leading-relaxed text-soft">{page.who}</p>{" "}
        {lead && leadNow?.row?.medianMonths != null ? (
          <p className="mt-4 text-lg leading-relaxed">
            USCIS decided half its {lines.length > 1 ? `${lead.line.label.toLowerCase()} ` : ""}
            {page.form}s within {monthsPhrase(leadNow.row.medianMonths)} in {quarterLabel(leadNow.slot.fy, leadNow.slot.quarter)},
            its median.
          </p>
        ) : null}
      </header>{" "}
      {rows.length === 0 ? (
        <p className="mt-8 max-w-2xl text-base text-soft">
          USCIS&apos;s quarterly figures for the {page.form} aren&apos;t loaded yet. They come from{" "}
          <a href="https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data" target="_blank" rel="noopener noreferrer" className="link">
            USCIS&apos;s data page
          </a>
          .
        </p>
      ) : (
        <>
          <FigureRow className="mt-8">
            {lead && leadNow?.row?.medianMonths != null ? (
              <Figure
                tone="lime"
                label={`Median, ${slotShort(leadNow.slot)}`}
                icon={<HourglassMediumIcon weight="bold" className="text-primary-text" />}
                trend={medianMoved(lead.points)}
                value={monthsPhrase(leadNow.row.medianMonths)}
                note={lines.length > 1 ? lead.line.label : "Half were decided sooner"}
              />
            ) : null}{" "}
            {newest?.pending != null ? (
              <Figure
                label="Waiting at the quarter's end"
                icon={<UsersIcon weight="bold" className="text-primary-text" />}
                trend={countMoved(totals, newest, "pending")}
                value={formatInt(newest.pending)}
                note={`Every ${page.form} line, ${slotShort(newest.slot)}`}
              />
            ) : null}{" "}
            {newest?.received != null ? (
              <Figure
                label="Received in the quarter"
                icon={<TrayIcon weight="bold" className="text-primary-text" />}
                trend={countMoved(totals, newest, "received")}
                value={formatInt(newest.received)}
                note={slotShort(newest.slot)}
              />
            ) : null}{" "}
            {share !== null && newest ? (
              <Figure
                label="Approved, of those decided"
                icon={<SealCheckIcon weight="bold" className="text-primary-text" />}
                trend={approvalMoved(totals, newest)}
                value={formatShare(share)}
                note={`${formatInt(newest.approved ?? 0)} approved, ${formatInt(newest.denied ?? 0)} denied`}
              />
            ) : null}
          </FigureRow>{" "}
          {categories.length > 0 && posted ? (
            <PageSection
              id="posted"
              title="USCIS's posted time, by category"
              lede={`USCIS's processing-times page prints one figure a category: the time within which it finished 80% of the cases it decided over the past six months. Posted ${formatAsOf(posted.published)}.`}
            >
              <div className="object p-4 sm:p-5">
                <BarRows inline rows={categories} label={`${page.form}: the months USCIS posts, by category`} />
              </div>{" "}
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-soft">
                The median above is one figure over every {page.form} USCIS decided in a quarter. These are by category,
                and each is the time for 8 cases in 10. From{" "}
                <a href={PROCESSING_TIMES_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="link">
                  USCIS&apos;s processing-times page
                </a>
                , as copied each day by the open-source{" "}
                <a href={posted.project} target="_blank" rel="noopener noreferrer" className="link">
                  jzebedee/uscis project
                </a>
                .{" "}
                <Link href={`/tools/uscis-case-inquiry?form=${encodeURIComponent(page.form)}`} className="link">
                  Put your own {page.form} on the calendar
                </Link>
                .
              </p>
            </PageSection>
          ) : null}{" "}
          <PageSection
            id="median"
            title="Median months, quarter by quarter"
            lede={`Half of each quarter's decided ${page.form}s took less time than this. ${first && last ? `${quarterLabel(first.fy, first.quarter)} to ${quarterLabel(last.fy, last.quarter)}.` : ""}`}
          >
            <ul className={lines.length > 1 ? "grid grid-cols-1 gap-6 md:grid-cols-2" : "grid grid-cols-1"}>
              {lines.map(({ line, points }) => (
                <Fragment key={line.key}>
                  <li className="object min-w-0 p-4 sm:p-5">
                    <p className="font-heading text-lg font-bold">{line.label}{" "}</p>{" "}
                    <ColumnChart
                      columns={medianColumns(points)}
                      label={`${page.form}, ${line.label}: median months to a decision, each quarter`}
                      first={slotShort(points[0]!.slot)}
                      last={slotShort(points[points.length - 1]!.slot)}
                      unit="months"
                      showMax={false}
                      topsFrom={lines.length > 1 ? "xl" : "sm"}
                      className="mt-3"
                    />
                  </li>
                </Fragment>
              ))}
            </ul>{" "}
            {gaps.length > 0 ? (
              <p className="mt-3 text-sm text-soft">
                A dashed frame is a quarter whose workbook no one kept: USCIS keeps only its last four quarters, and the
                Internet Archive holds no copy of {gaps.map((g) => slotShort(g)).join(" or ")}.
              </p>
            ) : null}
          </PageSection>{" "}
          <PageSection
            id="workload"
            title="What USCIS took in, decided and had waiting"
            lede={`Every ${page.form} line together, each quarter.`}
          >
            <ul className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {(
                [
                  ["Received", "received", "green", "received"],
                  ["Decided", "completed", "blue", "decided"],
                  ["Waiting at the quarter's end", "pending", "yellow", "waiting"],
                ] as const
              ).map(([title, key, tone, noun]) => (
                <Fragment key={key}>
                  <li className="object min-w-0 p-4 sm:p-5">
                    <p className="font-heading text-lg font-bold">{title}{" "}</p>{" "}
                    <ColumnChart
                      columns={countColumns(totals.map((t) => ({ slot: t.slot, value: t[key] })), noun)}
                      tone={tone}
                      label={`${page.form}: ${title.toLowerCase()}, each quarter`}
                      first={first ? slotShort(first) : ""}
                      last={last ? slotShort(last) : ""}
                      unit={noun}
                      className="mt-3"
                    />
                  </li>
                </Fragment>
              ))}
            </ul>
          </PageSection>
        </>
      )}{" "}
      {factsheet.length > 0 && history ? (
        <PageSection
          id="history"
          title="Medians from FY2016"
          lede="The only longer history USCIS has published for its medians, one figure a fiscal year."
        >
          <ul className={factsheet.length > 1 ? "grid grid-cols-1 gap-6 md:grid-cols-2" : "grid grid-cols-1"}>
            {factsheet.map(({ line, cols }) => (
              <Fragment key={line.key}>
                <li className="object min-w-0 p-4 sm:p-5">
                  <p className="font-heading text-lg font-bold">{line.label}{" "}</p>{" "}
                  <ColumnChart
                    columns={cols}
                    label={`${page.form}, ${line.label}: median months each fiscal year, FY2016 to FY2024`}
                    first={cols[0]!.label}
                    last={cols[cols.length - 1]!.label}
                    unit="months"
                    showMax={false}
                    topsFrom={factsheet.length > 1 ? "xl" : "sm"}
                    className="mt-3"
                  />
                </li>
              </Fragment>
            ))}
          </ul>{" "}
          <p className="mt-3 text-sm text-soft">
            FY2024 there covers October 2023 to January 2024 only (hatched), as USCIS&apos;s factsheet says. The factsheet is dated{" "}
            {history.asOf}.
          </p>
        </PageSection>
      ) : null}{" "}
      <PageSection id="next" title="Where to go next">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { href: `/tools/uscis-case-inquiry?form=${encodeURIComponent(page.form)}`, label: `Your own ${page.form} on the calendar, and the day you can ask USCIS` },
            ...page.links,
          ].map((l) => (
            <Fragment key={l.href}>
              <li>
                <Link href={l.href} className="object flex min-h-[44px] items-center p-4 font-semibold hover:bg-tint">
                  {l.label}
                </Link>{" "}
              </li>
            </Fragment>
          ))}
        </ul>{" "}
        <p className="mt-6 text-sm font-bold">Other forms</p>{" "}
        <ul className="mt-2 flex flex-wrap gap-2">
          {others.map((p) => (
            <Fragment key={p.slug}>
              <li>
                <Link href={`/uscis-processing-times/${p.slug}`} className="inline-flex min-h-[44px] items-center border-2 border-border px-3 text-sm font-semibold hover:border-foreground">
                  {p.form}
                </Link>{" "}
              </li>
            </Fragment>
          ))}
        </ul>
      </PageSection>{" "}
      <FinePrint summary="Why USCIS's own case page shows a different time" className="mt-10">
        <p className="max-w-2xl text-base leading-relaxed">
          The median is the time half of the cases USCIS finished in a quarter took, over every category together. Its
          processing-times page prints a different figure, the time within which it finished 80% of recent cases, one
          for each category, so the two rarely match. Both are USCIS&apos;s, and{" "}
          <Link href="/uscis-processing-times" className="link">
            the hub
          </Link>{" "}
          sets them side by side for the I-140.
        </p>
      </FinePrint>{" "}
      <DataProvenance datasets={["uscis-form-quarters", "uscis-posted-times"]} />
    </div>
  );
}

