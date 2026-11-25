/**
 * One USCIS office's I-485 numbers: a page for each field office and service center.
 *
 * People waiting on an I-485 ask about one office at a time ("is Hartford slow?", "how long at Portland, Maine?").
 * The index page holds every office in one table; this page gives one office its own address, its last four
 * quarters, where it stands among the others, and the one processing time USCIS posts for employment-based cases.
 * Under USCIS's figures sit the timelines people shared from this office (components/community/OfficeTimelines.tsx):
 * self-reported, checked before they show, and kept apart from USCIS's counts.
 *
 * Every count is USCIS's, from its quarterly file. What the page won't do is the same as the index: it never turns
 * a pile and a pace into "months to your decision", and a cell USCIS withholds stays withheld.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { withSocialCard } from "@/lib/socialCard";
import { openGraphBase } from "@/lib/openGraphBase";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { getFAQPageSchema } from "@/lib/structuredData";
import { FaqList } from "@/components/tools/FaqList";
import { DataProvenance } from "@/components/data/DataProvenance";
import { OfficeReportedCases } from "@/components/community/OfficeReportedCases";
import { OfficeTimelines, type OfficeTimelineView } from "@/components/community/OfficeTimelines";
import { NoteBanner } from "@/components/ui/note";
import { REPORTED_COMMUNITY_PLACES, type ReportedCase } from "@/lib/reportedCases";
import { getOfficeReportedCases, getReportedCasesBuiltAt } from "@/lib/db/communityReports";
import { queryStatic } from "@/lib/convexStatic";
import { softFail } from "@/lib/softRead";
import { api } from "@convex/_generated/api";
import { RecordStrip } from "@/components/home/RecordStrip";
import { QuarterlyEmpty } from "@/components/data/BarRows";
import { ScrollBox } from "@/components/ui/scroll-box";
import { countVs } from "@/lib/uscisTrends";
import { slotShort } from "@/lib/uscisForms";
import type { RecordFigure } from "@/lib/recordCounts";
import { getI485OfficeQuarters } from "@/lib/db/uscisQuarterly";
import { getPostedHistory, getUscisPosted } from "@/lib/db/uscisPosted";
import { changeWords, officeStanding, waitPapers, yearChange } from "@/lib/uscisPosted";
import { PostedI140History } from "@/components/uscis/PostedI140History";
import { SampleMonthFigures } from "@/components/uscis/SampleMonthFigures";
import { getSampleMonths } from "@/lib/db/uscisSample";
import { newestCompleteMonths, type SampleMonthsDoc } from "@/lib/uscisSample";
import { formatAsOf } from "@/lib/dolFormat";
import {
  officeYear,
  quarterLabel,
  quartersOfWork,
  splitOffices,
  standing,
  type OfficeRow,
} from "@/lib/uscisQuarterlyShape";
import { USCIS_OFFICES, isCenter, officeBySlug, officePlace, type UscisOffice } from "@/lib/uscisOffices";
import { SITE_URL } from "@/lib/constants/site";
import { datasetSchemaFor } from "@/lib/datasetSchema";
import { formatInt } from "@/lib/format";
import { StepsByStage } from "@/components/community/StepFigures";
import { WhoIsWaiting } from "@/components/community/TimelineBoard";
import { getOfficeSummary } from "@/lib/db/reportedSummary";
import type { PlaceSummary } from "@/lib/reportedSummary";
import { KeepWhole } from "@/components/ui/keep-whole";

const INDEX = "/i485-by-field-office";
/** The page's datasets, for its source line and its Dataset node alike. */
const DATASETS = ["uscis-i485-offices"] as const;
const USCIS_OFFICE_FINDER = "https://www.uscis.gov/about-us/find-a-uscis-office/field-offices";
/** USCIS posts one employment-based I-485 time for every field office together, under this office code. */
const ALL_FIELD_OFFICES = "FOD";
const EB_I485 = "131A";

export const revalidate = 604800;
export const dynamicParams = false;

export function generateStaticParams() {
  return USCIS_OFFICES.map((o) => ({ office: o.slug }));
}

/** "the Hartford field office", "the National Benefits Center", "the Texas Service Center". */
const theOffice = (o: UscisOffice) => (isCenter(o) ? `the ${o.name}` : `the ${o.name} field office`);

/** The searched phrase first ("Hartford USCIS field office"), then what the page holds; short enough to keep the site's name. */
function titleOf(o: UscisOffice): string {
  // People search "<office> field office processing time", and a bare "Omaha field office" completes to the FBI, so
  // USCIS sits beside the name (Search Console and search suggestions, Nov 20 2026). The first that fits 45 wins.
  if (isCenter(o)) return `${o.name} I-485 Numbers`;
  const fits = [
    `${o.name} USCIS Field Office I-485 Processing Times`,
    `${o.name} USCIS Field Office Processing Times`,
    `${o.name} USCIS I-485 Processing Times`,
    `${o.name} USCIS Field Office I-485 Times`,
    `${o.name} USCIS I-485 Times`,
  ].find((t) => t.length <= 45);
  return fits ?? `${o.name} I-485 Times`;
}

const descriptionOf = (o: UscisOffice) =>
  isCenter(o)
    ? `Employment-based I-485s received, approved, denied and pending at USCIS's ${o.name} each quarter, from USCIS's own data.`
    : `How long each I-485 step took at USCIS's ${officePlace(o)} field office, from cases people reported, beside USCIS's quarterly counts.`;

export async function generateMetadata({ params }: { params: Promise<{ office: string }> }): Promise<Metadata> {
  const office = officeBySlug((await params).office);
  if (!office) notFound();
  const path = `${INDEX}/${office.slug}`;
  return withSocialCard(
    {
      title: titleOf(office),
      description: descriptionOf(office),
      alternates: { canonical: path },
      openGraph: { ...openGraphBase, title: `${titleOf(office)} | PERM Tracker`, description: descriptionOf(office), url: path },
    },
    "i485-by-field-office",
  );
}

/** USCIS withholds a small cell; it prints as "withheld", never as 0. */
const count = (n: number | null) => (n === null ? "withheld" : formatInt(n));

/** "1st", "2nd", "3rd", "12th". */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * The answer about people's own waits here: the office's figure merged from every source (the summary's "i485-gc")
 * first, the timelines shared on this page while that has none (Nov 25 2026: it read the shared ones alone). A median
 * is named only when a read sent one, and always as theirs, never as USCIS's.
 */
function reportedAnswer(o: UscisOffice, summary: PlaceSummary | null, view: OfficeTimelineView | null): string {
  const caveat = "Their dates are self-reported, and people with a fast or a stuck case are likelier to share, so read it as what they saw.";
  const merged = summary?.steps.find((st) => st.id === "i485-gc");
  if (merged && merged.median !== null) {
    const window = merged.windowDays ? `, over the last ${merged.windowDays <= 183 ? 6 : 12} months` : "";
    return `USCIS doesn't publish a wait for one office. The ${formatInt(merged.n)} people who reported a finished I-485 at ${theOffice(o)} in ${REPORTED_COMMUNITY_PLACES} and on this site report a median of ${formatInt(merged.median)} days from filing the I-485 to the green card${window}. ${caveat}`;
  }
  const none = `USCIS doesn't publish a wait for one office. People whose I-485 was at ${theOffice(o)} can share their own dates on this page, and it shows a median once five have.`;
  const toCard = view?.metrics.find((m) => m.id === "i485-gc");
  if (!view || !toCard || toCard.median === null) return none;
  return `USCIS doesn't publish a wait for one office. The ${formatInt(toCard.n)} people who shared a full timeline from ${theOffice(o)} report a median of ${formatInt(toCard.median)} days from filing the I-485 to the green card. Their dates are self-reported, and people with a fast or a stuck case are likelier to share, so read it as what they saw.`;
}

/** The quarter in words alone: "April to June 2026". */
const quarterWords = (fy: number, quarter: number) => quarterLabel(fy, quarter).replace(/^FY\d+ Q\d \((.*)\)$/, "$1");

export default async function UscisOfficePage({ params }: { params: Promise<{ office: string }> }) {
  const office = officeBySlug((await params).office);
  if (!office) notFound();

  const [quarters, posted, shared, ownPosted, reported, reportedAt, summary, sample] = await Promise.all([
    getI485OfficeQuarters(),
    getUscisPosted(),
    // People's own timelines from this office. A failed read is named on the page, never drawn as "nobody has shared".
    queryStatic(api.communityTimelines.office, { office: office.code }, revalidate).catch(
      softFail<OfficeTimelineView | null>("i485-by-field-office/[office].timelines", null),
    ),
    // This office's own family-based posted time: the one per-office pace USCIS publishes. A failed read loses only it.
    getPostedHistory("I-485", "131A-FAM", office.code).catch(softFail<[string, number][]>("i485-by-field-office/[office].ownPosted", [])),
    // The cases a community sheet keeps for this office. A failed read is named on the page (null), never "none".
    getOfficeReportedCases(office.code).catch(softFail<ReportedCase[] | null>("i485-by-field-office/[office].reported", null)),
    getReportedCasesBuiltAt().catch(softFail<number | null>("i485-by-field-office/[office].reportedAt", null)),
    // How long each step took here, over every case people reported at this office (the hourly build's summary).
    getOfficeSummary(office.code).catch(softFail<PlaceSummary | null>("i485-by-field-office/[office].summary", null)),
    // A center's page carries our USCIS sample's I-485 figure; field offices don't read it. A failed read loses only it.
    isCenter(office)
      ? getSampleMonths().catch(softFail<SampleMonthsDoc | null>("i485-by-field-office/[office].sample", null))
      : Promise.resolve(null),
  ]);
  const sampleShown = sample !== null && newestCompleteMonths(sample, "I-485").length > 0;
  const stepsMeasured = !!summary && summary.steps.some((st) => st.median !== null);
  const waiting = summary?.waiting?.open ? summary.waiting : null;
  const waitingBody = (w: NonNullable<typeof waiting>) => (
    <>
      <p className="mt-1 max-w-2xl text-base text-muted-foreground">
        {`The ${formatInt(w.heard)} people heard from in the last year, at the furthest step each reported.`}
      </p>
      <div className="mt-3">
        <WhoIsWaiting waiting={w} total={w.heard} noun={["person", "people"]} />
      </div>
    </>
  );
  const year = officeYear(quarters, office.code);
  const newest = quarters[quarters.length - 1];
  const now = year[year.length - 1];
  // The office's newest row has to be the file's newest quarter: an office USCIS stopped listing gets no figures here.
  const current = now && newest && now.fy === newest.fy && now.quarter === newest.quarter ? now : null;
  const before = current && year.length > 1 ? year[year.length - 2]! : null;
  const path = `${INDEX}/${office.slug}`;
  const place = officePlace(office);
  const center = isCenter(office);

  const peers = newest ? splitOffices(Object.values(newest.byCode).filter((r) => r.code !== "ALL")) : null;
  const sameKind: OfficeRow[] = peers ? (center ? peers.serviceCenters : peers.fieldOffices) : [];
  const kindWord = center ? "centers" : "field offices";
  const pendingPlace = standing(sameKind, office.code, (r) => r.empPending);
  const work = current ? quartersOfWork(current.row) : null;
  const decided =
    current && current.row.empApproved !== null && current.row.empDenied !== null
      ? current.row.empApproved + current.row.empDenied
      : null;

  const figures: RecordFigure[] = [];
  if (current) {
    const r = current.row;
    const prior = before ? slotShort(before) : "";
    if (r.empPending !== null) {
      figures.push({
        href: "#quarters",
        value: r.empPending,
        label: "employment-based I-485s pending here",
        asOf: current.quarterEnd,
        asOfKind: "through",
        trend: before ? countVs(r.empPending, before.row.empPending, prior, "fewer") : undefined,
      });
    }
    if (r.empApproved !== null && r.empApproved > 0) {
      figures.push({
        href: "#quarters",
        value: r.empApproved,
        label: "approved here in the quarter",
        asOf: current.quarterEnd,
        asOfKind: "through",
        trend: before ? countVs(r.empApproved, before.row.empApproved, prior, "more") : undefined,
      });
    }
    if (r.empReceived !== null && r.empReceived > 0) {
      figures.push({
        href: "#quarters",
        value: r.empReceived,
        label: "received here in the quarter",
        asOf: current.quarterEnd,
        asOfKind: "through",
        trend: before ? countVs(r.empReceived, before.row.empReceived, prior, null) : undefined,
      });
    }
  }

  // The one employment-based time USCIS posts for field offices, all of them together.
  const postedRow = !center && posted ? posted.newest.find((r) => r.form === "I-485" && r.subtype === EB_I485 && r.office === ALL_FIELD_OFFICES) : undefined;
  const postedMonths = postedRow && postedRow.posted !== null ? postedRow.posted : null;
  const papers = waitPapers(posted);
  const ownNow = ownPosted.length > 0 ? ownPosted[ownPosted.length - 1]! : null;
  const ownYear = yearChange(ownPosted);
  const ownPlace = officeStanding(posted, "I-485", "131A-FAM", office.code);
  const ownPlaceText = ownPlace
    ? ` Of the ${ownPlace.of} offices it posts that time for, ${
        ownPlace.shorter === 0 ? "none posts" : ownPlace.shorter === 1 ? "one posts" : `${ownPlace.shorter} post`
      } a shorter one.`
    : "";

  const neighbours = center
    ? USCIS_OFFICES.filter((o) => isCenter(o) && o.code !== office.code)
    : USCIS_OFFICES.filter((o) => o.state === office.state && o.code !== office.code);

  const quarterName = current ? quarterWords(current.fy, current.quarter) : null;
  const faqs = [
    {
      q: `How many employment-based I-485s are pending at ${theOffice(office)}?`,
      a: current
        ? `USCIS's file for ${quarterName} lists ${count(current.row.empPending)} employment-based I-485s pending at ${theOffice(office)} on the quarter's last day, with ${count(current.row.empApproved)} approved and ${count(current.row.empDenied)} denied during the quarter.`
        : `USCIS's newest quarterly file doesn't list ${theOffice(office)}, so this page has no current figure for it.`,
    },
    {
      q: `How long does ${theOffice(office)} take to decide an I-485?`,
      a: center
        ? `USCIS doesn't publish a wait for one office. Its quarterly file gives each office's pending pile and its quarter's decisions, which this page prints. USCIS's own posted processing times are on the I-485 processing times page.`
        : postedMonths !== null && posted
          ? `USCIS doesn't publish a wait for one field office's employment-based cases. It posts one time for every field office together: ${postedMonths} months, the time within which it decided 8 cases in 10, as of its ${formatAsOf(posted.published)} posting.`
          : `USCIS doesn't publish a wait for one field office's employment-based cases. It posts one time for every field office together, which is on the I-485 processing times page.`,
    },
    {
      q: `Can my I-485 be decided at an office other than my local one?`,
      a: `Yes. USCIS can move a case from one office to another while it waits, and its file counts a case wherever it sits on the quarter's last day. USCIS says it sends a transfer notice when it moves a case, and an interview or appointment notice names the office to go to.`,
    },
    {
      q: `How long did people at ${theOffice(office)} wait for their I-485?`,
      a: reportedAnswer(office, summary, shared),
    },
    {
      q: `Where do these numbers come from?`,
      a: `From the I-485 file USCIS publishes each quarter on its Immigration and Citizenship Data page, which lists every field office and service center. This site copies it as published and names the quarter beside every figure.`,
    },
  ];

  const faqSchema = getFAQPageSchema(faqs);
  // USCIS's own table for one office: its creator is USCIS and its licence usa.gov's (datasetSchemaFor).
  const datasetSchema = datasetSchemaFor(SITE_URL, DATASETS, {
    name: `I-485 applications at ${center ? `USCIS's ${office.name}` : `the USCIS ${office.name} field office`}, by quarter`,
    description: descriptionOf(office),
    url: `${SITE_URL}${path}`,
    ...(current ? { dateModified: current.quarterEnd } : {}),
    ...(center ? {} : { place }),
    variableMeasured: ["applications received", "approved", "denied", "pending", "category of admission"],
  });

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-6 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={datasetSchema} />
      <JsonLdScript schema={faqSchema} />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          <KeepWhole>{"I-485s at "}</KeepWhole>{theOffice(office)}
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {current && current.row.empPending !== null ? (
            <>
              On {formatAsOf(current.quarterEnd)}, USCIS&apos;s {center ? office.name : `field office in ${place}`} held{" "}
              <b className="font-bold text-foreground">{formatInt(current.row.empPending)}</b><KeepWhole>{" employment-based I-485s"}</KeepWhole>
              {current.row.empApproved !== null ? <>. It approved {formatInt(current.row.empApproved)} in the three months before</> : null}.
              These are USCIS&apos;s own counts.
            </>
          ) : (
            <>What USCIS&apos;s {center ? office.name : `field office in ${place}`} received, decided and still holds, from USCIS&apos;s own quarterly file.</>
          )}
        </p>{" "}
        {/* Standalone links, so each is a 44px target. */}
        <p className="mt-4 flex flex-wrap gap-x-6 text-base">
          <Link href={INDEX} className="link inline-flex min-h-11 items-center font-bold">
            Every office in one table
          </Link>{" "}
          <a href="#timelines" className="link inline-flex min-h-11 items-center font-bold">
            Timelines people shared from here
          </a>{" "}
          {reported && reported.length > 0 ? (
            <a href="#reported-cases" className="link inline-flex min-h-11 items-center font-bold">
              {formatInt(reported.length)} cases people reported here
            </a>
          ) : null}
        </p>{" "}
        {neighbours.length > 0 ? (
          <p className="mt-2 text-base">
            <span className="text-muted-foreground">{center ? "The other centers:" : `Also in ${office.state}:`}</span>{" "}
            {neighbours.map((o, i) => (
              <span key={o.code}>
                {i > 0 ? ", " : ""}
                <Link href={`${INDEX}/${o.slug}`} className="link">
                  {o.name}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </header>

      {!current ? (
        <QuarterlyEmpty file="i485_performance_data" />
      ) : (
        <>
          {figures.length > 0 ? <RecordStrip record={figures} label={`The quarter at ${theOffice(office)}`} /> : null}

          {work !== null && decided ? (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-soft">
              That pile is <b className="font-bold text-foreground">{work.toFixed(1)} quarters of work</b> at the
              quarter&apos;s pace of {formatInt(decided)} decisions
              {pendingPlace ? (
                <>
                  , and the {ordinal(pendingPlace.rank)} largest of {pendingPlace.of} {kindWord}
                </>
              ) : null}
              . It compares workload. It isn&apos;t a wait for any one case.
            </p>
          ) : pendingPlace ? (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-soft">
              It&apos;s the {ordinal(pendingPlace.rank)} largest pile of {pendingPlace.of} {kindWord}.
            </p>
          ) : null}

          <section id="quarters" className="mt-12 scroll-mt-24">
            <h2 className="font-heading text-2xl font-bold">The last {year.length === 1 ? "quarter" : `${year.length} quarters`}</h2>{" "}
            <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
              <KeepWhole>
                {"Employment-based I-485s at this office, newest quarter first, with the family-based pile beside " +
                  "them for scale. Pending is the count on the quarter's last day."}
              </KeepWhole>
            </p>{" "}
            <ScrollBox label={`I-485s at ${theOffice(office)}, by quarter`} className="mt-4 border-t-2 border-[var(--object-border)]">
              <table className="w-full min-w-[640px] border-collapse text-left text-base">
                <caption className="sr-only"><KeepWhole>{"Employment-based I-485s received, approved, denied and pending at "}</KeepWhole>{theOffice(office)}, by quarter</caption>
                <thead className="dark border-b border-black bg-[#141414] text-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-3 text-sm font-bold">Quarter{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Received{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Approved{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Denied{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Pending{" "}</th>
                    <th scope="col" className="px-3 py-3 text-right text-sm font-bold">Family pending{" "}</th>
                  </tr>
                </thead>
                <tbody className="bg-card">
                  {[...year].reverse().map((p) => (
                    <tr key={`${p.fy}-${p.quarter}`} className="border-t-2 border-border/30">
                      <th scope="row" className="px-3 py-3 font-semibold">{quarterWords(p.fy, p.quarter)}{" "}</th>
                      <td className="px-3 py-3 text-right tabular-nums">{count(p.row.empReceived)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{count(p.row.empApproved)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{count(p.row.empDenied)}{" "}</td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">{count(p.row.empPending)}{" "}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-soft">{count(p.row.famPending)}{" "}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollBox>{" "}
            <p className="mt-3 text-sm text-muted-foreground">
              Source: USCIS, {newest!.sourceFile}, through {formatAsOf(current.quarterEnd)}. &ldquo;Withheld&rdquo; is a cell USCIS
              prints as D because it holds one to nine cases.
            </p>
          </section>

          {!center ? (
            <section id="posted-time" className="mt-12 scroll-mt-24">
              <h2 className="font-heading text-2xl font-bold">The processing time USCIS posts</h2>{" "}
              <p className="mt-2 max-w-2xl text-base leading-relaxed">
                {postedMonths !== null && posted ? (
                  <>
                    <KeepWhole>
                      {"USCIS posts one time for employment-based I-485s at every field office together:"}
                    </KeepWhole>{" "}
                    <b className="font-bold">{postedMonths} months</b>, as of its {formatAsOf(posted.published)} posting. That&apos;s
                    the time within which it decided 8 cases in 10. It posts no separate time for {office.name}.
                  </>
                ) : (
                  <><KeepWhole>{"USCIS posts one time for employment-based I-485s at every field office together, and no separate time for "}</KeepWhole>{office.name}.</>
                )}{" "}
                <Link href="/uscis-processing-times/i-485" className="link font-bold">
                  <KeepWhole>{"Every I-485 time USCIS posts"}</KeepWhole>
                </Link>
              </p>{" "}
              {ownNow ? (
                <>
                  <p className="mt-4 max-w-2xl text-base leading-relaxed">
                    <KeepWhole>{`The one time USCIS posts for ${office.name} alone is for family-based I-485s: ${ownNow[1]} months, as of its ${formatAsOf(ownNow[0])} posting${ownYear ? `, ${changeWords(ownYear)}` : ""}.${ownPlaceText} It isn't the wait for an employment-based case, but it moves with how busy this office is, so its history below is the closest public measure of this office's own pace.`}</KeepWhole>
                  </p>{" "}
                  <div className="mt-4 max-w-3xl">
                    <PostedI140History
                      label={`USCIS's posted time for family-based I-485s at ${office.name}, every posting since ${formatAsOf(ownPosted[0]![0])}`}
                      series={[
                        {
                          form: "I-485",
                          subtype: "131A-FAM",
                          office: office.code,
                          label: null,
                          officeLabel: office.name,
                          points: ownPosted,
                          code: "family",
                          name: `Family-based, ${office.name}`,
                        },
                      ]}
                    />
                  </div>
                </>
              ) : null}{" "}
              {papers && (papers.ead || papers.ap) ? (
                <p className="mt-4 max-w-2xl text-base leading-relaxed">
                  <KeepWhole>{`While an I-485 waits, USCIS posts ${[
                    papers.ead ? `${papers.ead.months} months for a work permit based on it (I-765, category (c)(9), at the ${papers.ead.office})` : null,
                    papers.ap ? `${papers.ap.months} months for advance parole (I-131, at ${papers.ap.office})` : null,
                  ]
                    .filter(Boolean)
                    .join(" and ")}, as of its ${formatAsOf(papers.published)} posting.`}</KeepWhole>
                </p>
              ) : null}
            </section>
          ) : null}

          <section id="limits" className="mt-12 scroll-mt-24">
            <h2 className="font-heading text-2xl font-bold">What these numbers can&apos;t tell you</h2>{" "}
            <ul className="mt-3 max-w-2xl list-disc space-y-2 pl-5 text-base leading-relaxed">
              <li>
                <b className="font-bold">How long your own case will take.</b> USCIS publishes a pile and a quarter&apos;s decisions per
                office. It doesn&apos;t publish a wait per office.
              </li>{" "}
              <li>
                <b className="font-bold">Where your case is.</b> USCIS can move a case between offices while it waits, and this file
                counts it wherever it sits on the quarter&apos;s last day. USCIS says it sends a transfer notice when it moves a case,
                and an interview or appointment notice names the office to go to.
              </li>{" "}
              <li>
                <b className="font-bold">Why a count moved.</b> Cases sent in from another office and cases newly filed both show as
                received.
              </li>
            </ul>{" "}
            <p className="mt-4 max-w-2xl text-base leading-relaxed">
              For the office&apos;s address, hours and the area it serves, use{" "}
              <a href={USCIS_OFFICE_FINDER} target="_blank" rel="noopener" className="link font-bold">
                USCIS&apos;s own list of field offices
              </a>
              .
            </p>
          </section>
        </>
      )}

      {sample && sampleShown ? (
        <section id="sample" className="mt-12 scroll-mt-24" aria-labelledby="sample-h">
          <h2 id="sample-h" className="font-heading text-2xl font-bold">
            <KeepWhole>{"Online I-485s approved so far, by the month filed"}</KeepWhole>
          </h2>{" "}
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
            <KeepWhole>
              {"Our own daily sample of USCIS's Case Status page, beside USCIS's counts above. It holds I-485s of every kind, family and employment."}
            </KeepWhole>
          </p>{" "}
          <div className="mt-5">
            <SampleMonthFigures
              doc={sample}
              form="I-485"
              note="The sample can't tell which office holds a case, so these are every office's online I-485s together, not this center's alone."
            />
          </div>
        </section>
      ) : null}

      {stepsMeasured ? (
        <section id="reported-figures" className="mt-12 scroll-mt-24" aria-labelledby="reported-figures-h">
          <h2 id="reported-figures-h" className="font-heading text-2xl font-bold">
            How long each step took here, as people report it
          </h2>{" "}
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            {`From the ${formatInt(summary.cases)} cases people reported at ${theOffice(office)} in ${REPORTED_COMMUNITY_PLACES} and on this site, each person once. Each step counts the cases that finished it in the last 6 months, or 12 when 6 hold too few. Self-reported, beside USCIS's own figures above, never in place of them.`}
          </p>
          <div className="mt-5">
            <StepsByStage steps={summary.steps} stages={[{ groups: ["i485"], title: "Each step of the I-485" }]} />
          </div>{" "}
          {waiting ? (
            <div className="mt-8">
              <h3 className="font-heading text-xl font-bold">Who&apos;s waiting here</h3>{" "}
              {waitingBody(waiting)}
            </div>
          ) : null}{" "}
          <p className="mt-5 max-w-3xl text-base leading-relaxed">
            <Link href="/green-card-timelines" className="link font-bold">
              Every step, from every office and source
            </Link>
            . What a{" "}
            <Link href="/guides/i485-transferred-to-field-office" className="link">
              transfer to a field office
            </Link>{" "}
            means, and{" "}
            <Link href="/guides/i485-interview-to-green-card" className="link">
              the wait after the interview
            </Link>
            .
          </p>
        </section>
      ) : null}

      {!stepsMeasured && waiting ? (
        // No step has a median here yet, but who's waiting is its own count and stands alone (Nov 25 2026: it sat
        // inside the steps' section and vanished with it).
        <section id="reported-figures" className="mt-12 scroll-mt-24" aria-labelledby="waiting-here-h">
          <h2 id="waiting-here-h" className="font-heading text-2xl font-bold">
            Who&apos;s waiting here
          </h2>{" "}
          {waitingBody(waiting)}
        </section>
      ) : null}

      <OfficeTimelines office={office} view={shared} mergedShown={stepsMeasured} />

      {reported === null ? (
        <NoteBanner alert className="mt-12 max-w-2xl">
          <p>The cases people reported here can&apos;t be read right now. Try again in a few minutes.</p>
        </NoteBanner>
      ) : (
        <OfficeReportedCases cases={reported} builtAt={reportedAt} officeName={theOffice(office)} />
      )}

      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">Questions about this office</h2>
        <FaqList items={faqs} />
      </section>

      <section className="mt-12 border-2 border-border bg-card p-6 shadow-hard sm:p-8">
        <h2 className="font-heading text-2xl font-bold">Read next</h2>{" "}
        <ul className="mt-4 space-y-2">
          <li>
            <Link href={INDEX} className="link">
              <KeepWhole>{"The I-485 at every USCIS field office and service center"}</KeepWhole>
            </Link>
          </li>{" "}
          <li>
            <Link href="/guides/fastest-field-office-eb-i485" className="link">
              <KeepWhole>{"Which field office is fastest for an employment-based I-485"}</KeepWhole>
            </Link>
          </li>{" "}
          <li>
            <Link href="/tools/i485-queue-position" className="link">
              <KeepWhole>{"Your place in USCIS's I-485 inventory by priority date"}</KeepWhole>
            </Link>
          </li>{" "}
          <li>
            <Link href="/visa-bulletin" className="link">
              Whether your priority date is current this month
            </Link>
          </li>
        </ul>
      </section>

      <DataProvenance datasets={sampleShown ? [...DATASETS, "uscis-sample"] : DATASETS} />
    </div>
  );
}
