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

import { ReportedI140 } from "@/components/community/ReportedI140";
import { BarRows, QuarterlyEmpty, type BarRow } from "@/components/data/BarRows";
import { DataProvenance } from "@/components/data/DataProvenance";
import { FinePrint } from "@/components/data/FinePrint";
import { MonthlyDecisionBars } from "@/components/data/MonthlyDecisionBars";
import { Figure, FigureRow } from "@/components/data/FigureRow";
import { PageSection } from "@/components/data/PageSection";
import { ColumnChart, type Column } from "@/components/numbers/ColumnChart";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { breadcrumbSchema } from "@/lib/breadcrumbs";
import { getReportedSummary } from "@/lib/db/reportedSummary";
import { StepFigures } from "@/components/community/StepFigures";
import type { ReportedSummary } from "@/lib/reportedSummary";

/** The steps people report for each form, from the hourly build's summary (scripts/lib_reported_summary.py). */
const FORM_STEPS: Readonly<Record<string, readonly string[]>> = {
  "I-140": ["cert-to-i140", "i140-premium", "i140-regular", "i140-rfe"],
  "I-485": ["i485-bio", "i485-ead", "i485-ap", "i485-office", "i485-interview", "i485-gc", "office-gc", "interview-gc", "gc-card"],
  "I-765": ["i485-ead"],
  "I-131": ["i485-ap"],
  "I-129": ["lca-h1b", "h1b"],
};
import { getPostedHistory, getUscisPosted } from "@/lib/db/uscisPosted";
import { getUscisMonthly } from "@/lib/db/uscisMonthly";
import { decisionTrend, deniedShare, everyMonth, leadLine, recentMonths } from "@/lib/uscisMonthly";
import { ScrollBox } from "@/components/ui/scroll-box";
import { MONTH_NAMES } from "@convex/lib/months";
import { getHistoricalMedians, getUscisFormRows, type HistoricalMedians } from "@/lib/db/uscisQuarterly";
import { formatAsOf } from "@/lib/dolFormat";
import { formatInt, formatShare, formatShareOf } from "@/lib/format";
import { REPORTED_PLACES } from "@/lib/reportedCases";
import { openGraphBase } from "@/lib/openGraphBase";
import { getI140ProcessingTime, PROCESSING_TIMES_AS_OF, PROCESSING_TIMES_SOURCE_URL } from "@/lib/processing-times/i140ProcessingTimes";
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
import { changeWords, i140ReadIsNewer, isCurrent, postedByCategory, waitPapers, yearChange, type PaperTime, type PostedCategory } from "@/lib/uscisPosted";
import { PostedI140History } from "@/components/uscis/PostedI140History";
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

// A form people report their own dates for says so in its title: the page holds both USCIS's median and theirs.
const titleOf = (p: FormPage) =>
  FORM_STEPS[p.form] ? `${p.form} Processing Time: USCIS and Real Cases` : `${p.form} Processing Time: USCIS's Median`;
const descriptionOf = (p: FormPage) =>
  FORM_STEPS[p.form]
    ? `How long the ${p.form} takes now: USCIS's quarterly median, and each step's days from thousands of cases people reported, updated hourly.`
    : `How long USCIS took to decide the ${p.form} each quarter (its median), with forms received, decided and waiting, from USCIS's own quarterly data.`;

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

/**
 * The I-140 rows from the figures read by hand on USCIS's page, for when USCIS has posted again and the daily copies
 * haven't caught up (i140ReadIsNewer). Service Center Operations only, with no question date: that comes back with
 * the next copy.
 */
function readI140Rows(): BarRow[] {
  return (["EB-1", "EB-2", "EB-2-NIW", "EB-3"] as const)
    .flatMap((c) => getI140ProcessingTime(c)?.subtypes ?? [])
    .map((s) => ({
      key: s.code,
      label: `${s.label} (${s.code})`,
      sub: undefined,
      value: s.months80,
      nullText: "No figure posted",
      text: monthsPhrase(s.months80),
    }));
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

/** The I-765 and I-131 pages each lead with the one row a pending I-485 waits on; other forms have none. */
function keyRow(form: string, ead: PaperTime | null, ap: PaperTime | null) {
  if (form === "I-765" && ead) return { time: ead, what: "a work permit based on a pending I-485 (category (c)(9))", at: `the ${ead.office}`, name: "Work permit, (c)(9)" };
  if (form === "I-131" && ap) return { time: ap, what: "advance parole", at: ap.office, name: "Advance parole" };
  return null;
}

const monthWords = (m: string) => `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const monthCount = (n: number | null) => (n === null ? "Not given" : formatInt(n));

export default async function UscisFormPage({ params }: { params: Promise<{ form: string }> }) {
  const page = formPage((await params).form);
  if (!page) notFound();
  const path = `/uscis-processing-times/${page.slug}`;
  const [rows, history, posted, monthly, summary] = await Promise.all([
    getUscisFormRows(page.form),
    getHistoricalMedians().catch(softFail("uscis-processing-times/[form]/page.getHistoricalMedians", null)),
    // Throws on a failed read, like the rows: the page keeps its last good render for the week.
    getUscisPosted(),
    // USCIS's monthly report to Congress, for the six forms it covers. A failed read loses only its section.
    getUscisMonthly().catch(softFail("uscis-processing-times/[form]/page.getUscisMonthly", null)),
    // People's own reports, every source, for the forms they report. A failed read loses only its section.
    FORM_STEPS[page.form]
      ? getReportedSummary().catch(softFail<ReportedSummary | null>("uscis-processing-times/[form]/page.summary", null))
      : Promise.resolve(null),
  ]);
  const reportedSteps = (FORM_STEPS[page.form] ?? []).flatMap((id) => summary?.steps.find((st) => st.id === id) ?? []);
  const month = leadLine(monthly, page.form);
  const monthRows = month && monthly ? recentMonths(monthly, month, 12) : [];
  const monthNow = monthRows[0]?.point ?? null;
  const monthWhat = page.form === "I-485" ? "employment-based I-485s" : `${page.form}s`;
  // The newest month against the year before: the first thing to check when decisions fall (the N-400, Nov 2026).
  const trend = month && monthly ? decisionTrend(monthly, month) : null;
  // A posting too old to stand for "now" is left out: the quarterly median carries the page on its own.
  const fresh = posted && isCurrent(posted, easternDay()) ? posted : null;
  // The I-140's newest figures, read by hand, when USCIS posted again after the copies stopped (Nov 19 and 20 2026).
  const i140Read = page.form === "I-140" && fresh !== null && i140ReadIsNewer(fresh);
  const categories = fresh ? (i140Read ? readI140Rows() : postedRows(postedByCategory(fresh, page.form))) : [];
  // The row most people on the I-765 and I-131 pages wait on while an I-485 is pending, answered first.
  const papers = waitPapers(fresh);
  const key = keyRow(page.form, papers?.ead ?? null, papers?.ap ?? null);
  const keyHistory = key
    ? await getPostedHistory(page.form, key.time.subtype, key.time.code).catch(
        softFail<[string, number][]>("uscis-processing-times/[form]/page.keyHistory", []),
      )
    : [];
  const keyYear = yearChange(keyHistory);
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

  // People's reported cases, beside USCIS's figures or on their own when USCIS's quarterly file isn't loaded:
  // the reported figures never wait on the official read.
  const reported = (
    <>
      {page.form === "I-140" && summary ? (
        <ReportedI140 figures={summary.i140} steps={reportedSteps} />
      ) : reportedSteps.some((st) => st.median !== null) ? (
        <PageSection
          id="reported"
          title={`What people reported about their own ${page.form}s`}
          lede={`From ${formatInt(summary!.headline.cases)} cases people reported in ${REPORTED_PLACES} and on this site, each person once, over the cases that finished each step in the last 6 months (12 when 6 hold too few). Self-reported, beside USCIS's own figures, never in place of them.`}
        >
          <StepFigures steps={reportedSteps} allHref="/green-card-timelines" />{" "}
          {page.form === "I-485" ? (
            <p className="mt-2 max-w-3xl text-base leading-relaxed">
              Each step explained:{" "}
              <Link href="/guides/i485-timeline-each-step" className="link">
                the I-485 timeline
              </Link>
              ,{" "}
              <Link href="/guides/i485-transferred-to-field-office" className="link">
                a transfer to a field office
              </Link>{" "}
              and{" "}
              <Link href="/guides/i485-interview-to-green-card" className="link">
                the wait after the interview
              </Link>
              .
            </p>
          ) : page.form === "I-765" || page.form === "I-131" ? (
            <p className="mt-2 max-w-3xl text-base leading-relaxed">
              <Link href="/guides/ead-and-advance-parole-timelines" className="link">
                The work permit and travel document while an I-485 is pending
              </Link>
              , from USCIS&apos;s figures and these.
            </p>
          ) : null}
        </PageSection>
      ) : null}
    </>
  );

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
        ) : null}{" "}
        {key && fresh ? (
          <p className="mt-3 text-lg leading-relaxed">
            {`For ${key.what}, USCIS posts ${key.time.months} months at ${key.at} as of its ${formatAsOf(fresh.published)} posting${keyYear ? `, ${changeWords(keyYear)}` : ""}. That's the time within which it decided 8 cases in 10.`}{" "}
            <a href="#posted" className="link font-bold">
              Every posting since {formatAsOf(keyHistory[0]?.[0] ?? fresh.published)}
            </a>
          </p>
        ) : null}{" "}
        {monthNow && monthNow.approved !== null && monthNow.denied !== null && monthNow.pending !== null && monthRows[0] ? (
          <p className="mt-3 text-lg leading-relaxed">
            {`In ${monthWords(monthRows[0].month)}, USCIS decided ${formatInt(monthNow.approved + monthNow.denied)} ${monthWhat}: ${formatInt(monthNow.approved)} approved and ${formatInt(monthNow.denied)} denied (${formatShareOf(monthNow.denied, monthNow.approved + monthNow.denied)}).`}{" "}
            {trend?.before && trend.share !== null
              ? `That's ${formatShare(trend.share)} of the ${formatInt(trend.before.average)} a month it decided on average from ${monthWords(trend.before.from)} to ${monthWords(trend.before.to)}${trend.before.counted < 12 ? `, over the ${trend.before.counted} months it reported` : ""}.`
              : ""}{" "}
            {`${formatInt(monthNow.pending)} were pending at the month's end${trend?.pendingYearAgo != null ? `, against ${formatInt(trend.pendingYearAgo)} a year earlier` : ""}${monthNow.pending_6mo !== null ? `, and ${formatInt(monthNow.pending_6mo)} of them had waited more than six months` : ""}.`}{" "}
            <a href="#monthly" className="link font-bold">
              Each month
            </a>
          </p>
        ) : null}
      </header>{" "}
      {rows.length === 0 ? <QuarterlyEmpty file="quarterly_all_forms" /> : null}{" "}
      {rows.length === 0 ? (
        reported
      ) : (
        <>
          <FigureRow className="mt-8">
            {lead && leadNow?.row?.medianMonths != null ? (
              <Figure kind="official"
                tone="lime"
                label={`Median, ${slotShort(leadNow.slot)}`}
                icon={<HourglassMediumIcon weight="bold" className="text-primary-text" />}
                trend={medianMoved(lead.points)}
                value={monthsPhrase(leadNow.row.medianMonths)}
                note={lines.length > 1 ? lead.line.label : "Half were decided sooner"}
              />
            ) : null}{" "}
            {newest?.pending != null ? (
              <Figure kind="official"
                label="Waiting at the quarter's end"
                icon={<UsersIcon weight="bold" className="text-primary-text" />}
                trend={countMoved(totals, newest, "pending")}
                value={formatInt(newest.pending)}
                note={`Every ${page.form} line, ${slotShort(newest.slot)}`}
              />
            ) : null}{" "}
            {newest?.received != null ? (
              <Figure kind="official"
                label="Received in the quarter"
                icon={<TrayIcon weight="bold" className="text-primary-text" />}
                trend={countMoved(totals, newest, "received")}
                value={formatInt(newest.received)}
                note={slotShort(newest.slot)}
              />
            ) : null}{" "}
            {share !== null && newest ? (
              <Figure kind="official"
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
              lede={
                i140Read
                  ? `USCIS's processing-times page prints one figure a category: the time within which it finished 80% of the cases it decided over the past six months. USCIS has posted since the ${formatAsOf(posted.published)} posting our daily copy holds. These are the figures read on its page on ${formatAsOf(PROCESSING_TIMES_AS_OF)}, for Service Center Operations.`
                  : `USCIS's processing-times page prints one figure a category: the time within which it finished 80% of the cases it decided over the past six months. Posted ${formatAsOf(posted.published)}.`
              }
            >
              {key && keyHistory.length > 1 ? (
                <div className="mb-5 max-w-3xl">
                  <PostedI140History
                    label={`USCIS's posted time for ${key.what} at ${key.at}, every posting since ${formatAsOf(keyHistory[0]![0])}`}
                    series={[
                      {
                        form: page.form,
                        subtype: key.time.subtype,
                        office: key.time.code,
                        label: null,
                        officeLabel: key.time.office,
                        points: keyHistory,
                        code: key.time.subtype,
                        name: `${key.name}, ${key.time.office}`,
                      },
                    ]}
                  />
                </div>
              ) : null}{" "}
              <div className="object p-4 sm:p-5">
                <BarRows inline rows={categories} label={`${page.form}: the months USCIS posts, by category`} />
              </div>{" "}
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-soft">
                The median above is one figure over every {page.form} USCIS decided in a quarter. These are by category,
                and each is the time for 8 cases in 10. From{" "}
                <a href={PROCESSING_TIMES_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="link">
                  USCIS&apos;s processing-times page
                </a>
                {i140Read ? (
                  <>, read there {formatAsOf(PROCESSING_TIMES_AS_OF)}.{" "}</>
                ) : (
                  <>
                    , as copied each day by the open-source{" "}
                    <a href={posted.project} target="_blank" rel="noopener noreferrer" className="link">
                      jzebedee/uscis project
                    </a>
                    .{" "}
                  </>
                )}
                <Link href={`/tools/uscis-case-inquiry?form=${encodeURIComponent(page.form)}`} className="link">
                  Put your own {page.form} on the calendar
                </Link>
                .
              </p>
            </PageSection>
          ) : null}{" "}
          {reported}{" "}
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
      {month && monthly && monthRows.length > 0 ? (
        <PageSection
          id="monthly"
          title="Each month, as USCIS reports it to Congress"
          lede={`${page.form === "I-485" ? "Employment-based I-485s" : `Every ${page.form}`}: what came in, what USCIS decided and what was still waiting at each month's end, from the monthly report USCIS files with Congress.`}
        >
          <MonthlyDecisionBars
            months={everyMonth(monthly, month)}
            nouns={monthWhat}
            label={`${monthWhat} USCIS decided each month, approved and denied, from its monthly report to Congress`}
            className="mb-8"
          />{" "}
          <ScrollBox label={`${monthWhat}, month by month`} className="border-t-2 border-[var(--object-border)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-base">
              <caption className="sr-only">{`${monthWhat} received, approved, denied and pending each month, from USCIS's monthly report to Congress`}</caption>
              <thead className="dark border-b border-black bg-[#141414] text-foreground">
                <tr>
                  <th scope="col" className="px-3 py-3 text-sm font-bold">Month{" "}</th>
                  <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Received{" "}</th>
                  <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Approved{" "}</th>
                  <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Denied{" "}</th>
                  <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Denied of decided{" "}</th>
                  <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Pending{" "}</th>
                  <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Over six months{" "}</th>
                  <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Average months{" "}</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {monthRows.map(({ month: m, point: p }) =>
                  p ? (
                    <tr key={m} className="border-t-2 border-border/30">
                      <th scope="row" className="px-3 py-3 font-semibold">{monthWords(m)}{" "}</th>
                      <td className="px-3 py-3 text-right tabular-nums">{monthCount(p.received)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{monthCount(p.approved)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{monthCount(p.denied)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {(() => {
                          const sh = deniedShare(p);
                          return sh === null || p.denied === null || p.approved === null ? "Not given" : formatShareOf(p.denied, p.approved + p.denied);
                        })()}{" "}
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">{monthCount(p.pending)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{monthCount(p.pending_6mo)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.avg_months === null ? "Not given" : p.avg_months.toFixed(1)}{" "}</td>
                    </tr>
                  ) : (
                    <tr key={m} className="border-t-2 border-border/30">
                      <th scope="row" className="px-3 py-3 font-semibold">{monthWords(m)}{" "}</th>
                      <td colSpan={7} className="px-3 py-3 text-soft">
                        USCIS&apos;s data page doesn&apos;t list this month&apos;s report.{" "}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </ScrollBox>{" "}
          {page.form === "I-485" && monthly.newest ? (
            <ScrollBox label={`Every I-485 basis in ${monthWords(monthly.newest)}`} className="mt-6 border-t-2 border-[var(--object-border)]">
              <table className="w-full min-w-[560px] border-collapse text-left text-base">
                <caption className="sr-only">{`Every I-485 basis USCIS reports, ${monthWords(monthly.newest)}`}</caption>
                <thead className="dark border-b border-black bg-[#141414] text-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-3 text-sm font-bold">{`Basis, ${monthWords(monthly.newest)}`}{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Received{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Approved{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Denied{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Pending{" "}</th>
                  </tr>
                </thead>
                <tbody className="bg-card">
                  {monthly.lines
                    .filter((l) => l.form === "I-485")
                    .map((l) => ({ l, p: l.points.find((x) => x.month === monthly.newest) ?? null }))
                    .filter((x) => x.p !== null)
                    .sort((a, b) => (b.p!.pending ?? 0) - (a.p!.pending ?? 0))
                    .map(({ l, p }) => (
                      <tr key={l.line} className="border-t-2 border-border/30">
                        <th scope="row" className="px-3 py-3 font-semibold">{l.basis || l.line}{" "}</th>
                        <td className="px-3 py-3 text-right tabular-nums">{monthCount(p!.received)}{" "}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{monthCount(p!.approved)}{" "}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{monthCount(p!.denied)}{" "}</td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums">{monthCount(p!.pending)}{" "}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </ScrollBox>
          ) : null}{" "}
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-soft">
            {`The average counts months from receipt to decision over every case USCIS finished that month. USCIS says it may differ from the processing times it posts, which give the time for 8 cases in 10. USCIS also revises past months, so a month can change after it's first published. ${monthly.missing.length > 0 ? `Its data page doesn't list ${monthly.missing.length} of the months between ${monthWords(monthly.months[0]!)} and ${monthWords(monthly.newest ?? monthly.months[monthly.months.length - 1]!)}. ` : ""}From`}{" "}
            <a href="https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data" target="_blank" rel="noopener noreferrer" className="link">
              USCIS&apos;s data page
            </a>
            .
          </p>
        </PageSection>
      ) : null}{" "}
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

