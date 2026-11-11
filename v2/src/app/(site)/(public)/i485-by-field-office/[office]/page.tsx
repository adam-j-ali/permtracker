/**
 * One USCIS office's I-485 numbers: a page for each field office and service center.
 *
 * People waiting on an I-485 ask about one office at a time ("is Hartford slow?", "how long at Portland, Maine?").
 * The index page holds every office in one table; this page gives one office its own address, its last four
 * quarters, where it stands among the others, and the one processing time USCIS posts for employment-based cases.
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
import { FaqList } from "@/components/tools/FaqList";
import { DataProvenance } from "@/components/data/DataProvenance";
import { RecordStrip } from "@/components/home/RecordStrip";
import { QuarterlyEmpty } from "@/components/data/BarRows";
import { ScrollBox } from "@/components/ui/scroll-box";
import { countVs } from "@/lib/uscisTrends";
import { slotShort } from "@/lib/uscisForms";
import type { RecordFigure } from "@/lib/recordCounts";
import { getI485OfficeQuarters } from "@/lib/db/uscisQuarterly";
import { getUscisPosted } from "@/lib/db/uscisPosted";
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
import { formatInt } from "@/lib/format";

const INDEX = "/i485-by-field-office";
const USCIS_DATA_PAGE = "https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data";
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
  if (isCenter(o)) return `${o.name} I-485 Numbers`;
  const full = `${o.name} USCIS Field Office I-485 Numbers`;
  return full.length <= 45 ? full : `${o.name} Field Office I-485 Numbers`;
}

const descriptionOf = (o: UscisOffice) =>
  isCenter(o)
    ? `Employment-based I-485s received, approved, denied and pending at USCIS's ${o.name} each quarter, from USCIS's own data.`
    : `Employment-based I-485s received, approved, denied and pending at the USCIS field office in ${officePlace(o)} each quarter, from USCIS's own data.`;

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

/** The quarter in words alone: "April to June 2026". */
const quarterWords = (fy: number, quarter: number) => quarterLabel(fy, quarter).replace(/^FY\d+ Q\d \((.*)\)$/, "$1");

export default async function UscisOfficePage({ params }: { params: Promise<{ office: string }> }) {
  const office = officeBySlug((await params).office);
  if (!office) notFound();

  const [quarters, posted] = await Promise.all([getI485OfficeQuarters(), getUscisPosted()]);
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
      a: `Yes. USCIS can move a case from one office to another while it waits, and its file counts a case wherever it sits on the quarter's last day. A notice from USCIS, or your online account, says which office holds your case.`,
    },
    {
      q: `Where do these numbers come from?`,
      a: `From the I-485 file USCIS publishes each quarter on its Immigration and Citizenship Data page, which lists every field office and service center. This site copies it as published and names the quarter beside every figure.`,
    },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage" as const,
    mainEntity: faqs.map((f) => ({
      "@type": "Question" as const,
      name: f.q,
      acceptedAnswer: { "@type": "Answer" as const, text: f.a },
    })),
  };
  // USCIS's own table for one office; a bare Organization creator (Google's Dataset parser matches the type literally).
  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `I-485 applications at ${center ? `USCIS's ${office.name}` : `the USCIS ${office.name} field office`}, by quarter`,
    description: descriptionOf(office),
    url: `${SITE_URL}${path}`,
    ...(current ? { dateModified: current.quarterEnd } : {}),
    isBasedOn: USCIS_DATA_PAGE,
    creator: { "@type": "Organization", name: "U.S. Citizenship and Immigration Services", url: "https://www.uscis.gov" },
    isAccessibleForFree: true,
    license: "https://www.usa.gov/government-works",
    ...(center ? {} : { spatialCoverage: { "@type": "Place", name: place } }),
    variableMeasured: ["applications received", "approved", "denied", "pending", "category of admission"],
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-6 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={datasetSchema} />
      <JsonLdScript schema={faqSchema} />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          I-485s at {theOffice(office)}
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {current && current.row.empPending !== null ? (
            <>
              On {formatAsOf(current.quarterEnd)}, USCIS&apos;s {center ? office.name : `field office in ${place}`} held{" "}
              <b className="font-bold text-foreground">{formatInt(current.row.empPending)}</b> employment-based I-485s
              {current.row.empApproved !== null ? <>. It approved {formatInt(current.row.empApproved)} in the three months before</> : null}.
              These are USCIS&apos;s own counts.
            </>
          ) : (
            <>What USCIS&apos;s {center ? office.name : `field office in ${place}`} received, decided and still holds, from USCIS&apos;s own quarterly file.</>
          )}
        </p>{" "}
        <p className="mt-4 text-base">
          <Link href={INDEX} className="link font-bold">
            Every office in one table
          </Link>
          {neighbours.length > 0 ? (
            <>
              {" "}
              <span className="text-muted-foreground">{center ? "The other centers:" : `Also in ${office.state}:`}</span>{" "}
              {neighbours.map((o, i) => (
                <span key={o.code}>
                  {i > 0 ? ", " : ""}
                  <Link href={`${INDEX}/${o.slug}`} className="link">
                    {o.name}
                  </Link>
                </span>
              ))}
            </>
          ) : null}
        </p>
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
              Employment-based I-485s at this office, newest quarter first, with the family-based pile beside them for scale.
              Pending is the count on the quarter&apos;s last day.
            </p>{" "}
            <ScrollBox label={`I-485s at ${theOffice(office)}, by quarter`} className="mt-4 border-t-2 border-[var(--object-border)]">
              <table className="w-full min-w-[640px] border-collapse text-left text-base">
                <caption className="sr-only">Employment-based I-485s received, approved, denied and pending at {theOffice(office)}, by quarter</caption>
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
                    USCIS posts one time for employment-based I-485s at every field office together:{" "}
                    <b className="font-bold">{postedMonths} months</b>, as of its {formatAsOf(posted.published)} posting. That&apos;s
                    the time within which it decided 8 cases in 10. It posts no separate time for {office.name}.
                  </>
                ) : (
                  <>USCIS posts one time for employment-based I-485s at every field office together, and no separate time for {office.name}.</>
                )}{" "}
                <Link href="/uscis-processing-times/i-485" className="link font-bold">
                  Every I-485 time USCIS posts
                </Link>
              </p>
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
                counts it wherever it sits on the quarter&apos;s last day. A notice from USCIS or your online account names the office.
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

      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">Questions about this office</h2>
        <FaqList items={faqs} />
      </section>

      <section className="mt-12 border-2 border-border bg-card p-6 shadow-hard sm:p-8">
        <h2 className="font-heading text-2xl font-bold">Read next</h2>{" "}
        <ul className="mt-4 space-y-2">
          <li>
            <Link href={INDEX} className="link">
              The I-485 at every USCIS field office and service center
            </Link>
          </li>{" "}
          <li>
            <Link href="/guides/fastest-field-office-eb-i485" className="link">
              Which field office is fastest for an employment-based I-485
            </Link>
          </li>{" "}
          <li>
            <Link href="/tools/i485-queue-position" className="link">
              Your place in USCIS&apos;s I-485 inventory by priority date
            </Link>
          </li>{" "}
          <li>
            <Link href="/visa-bulletin" className="link">
              Whether your priority date is current this month
            </Link>
          </li>
        </ul>
      </section>

      <DataProvenance datasets={["uscis-i485-offices"]} />
    </div>
  );
}
