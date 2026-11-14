/**
 * For the people at an employer who keep track of its PERM cases: HR, global mobility, in-house immigration.
 *
 * The person waiting on one case has the homepage and the case lookup; the firm that files the cases has
 * /for-attorneys. This page is for whoever sits between them and gets asked "where are our cases": it opens with
 * the way to the company's own page, shows the email a follow sends on a day cases change, and then the pages
 * behind it as dated captures. Everything it describes is live: the search is the employers list's own, the email
 * is the follow alert's own template drawn from a sample (src/components/marketing/employerEmailSample.ts), and
 * the three figures are read from the same records the data pages print.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { IndexFigures, IndexSearch, type IndexFigure } from "@/components/data/IndexHeader";
import { AppWindow } from "@/components/marketing/AppWindow";
import { EMPLOYER_EMAIL_SUBJECT } from "@/components/marketing/employerEmailSample";
import { EMPLOYER_SHOTS } from "@/components/marketing/employerShots";
import { EmployersTour } from "@/components/marketing/EmployersTour";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { FaqList } from "@/components/tools/FaqList";
import { SITE_URL } from "@/lib/constants/site";
import { getActivitySeries } from "@/lib/db/activity";
import { getEmployerStages } from "@/lib/db/employerStages";
import { dolDayOf } from "@/lib/dolDay";
import { EMPLOYER_FAQS, EMPLOYER_STEPS } from "@/lib/forEmployers";
import { formatInt } from "@/lib/format";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";
import { softFail } from "@/lib/softRead";
import { CASE_CHECKS } from "@/lib/sweepSchedule";
import { longDate, weekdayName } from "@convex/lib/months";

/** The three figures move once a day at most. */
export const revalidate = 86400;

const PATH = "/for-employers";
const TITLE = "PERM Case Tracking for Employers and HR Teams";
const DESCRIPTION =
  "See every PERM case your company has at the Department of Labor and where each stands, and get an email the day one is certified, denied or questioned.";

export const metadata: Metadata = withSocialCard(
  {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: PATH },
    openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: PATH },
  },
  "for-employers",
);

/** The last complete working day in the record of decisions, or null when it can't be read. */
async function lastWorkingDay() {
  const series = await getActivitySeries().catch(softFail("for-employers/activity", []));
  const today = dolDayOf(Date.now());
  const days = series.find((s) => s.source === "sweep-observed")?.days ?? [];
  return (
    days.filter((d) => d.date < today && d.total > 0 && !["Saturday", "Sunday"].includes(weekdayName(d.date) ?? "")).at(-1) ??
    null
  );
}

export default async function ForEmployersPage() {
  const [stages, day] = await Promise.all([
    getEmployerStages().catch(softFail("for-employers/stages", null)),
    lastWorkingDay(),
  ]);
  const figures: IndexFigure[] = [
    ...(stages
      ? [{ label: "PERM cases waiting at DOL", value: formatInt(stages.pendingTotal), note: `As of ${longDate(stages.asOf)}`, href: "/perm-processing-times" }]
      : []),
    ...(day
      ? [{ label: "Decided on DOL's last working day", value: formatInt(day.total), note: `${weekdayName(day.date)}, ${longDate(day.date)}`, href: "/perm-decision-activity" }]
      : []),
    { label: "Read from DOL's case system", value: `${CASE_CHECKS.length} times a day`, note: "Every waiting case, each weekday" },
  ];
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: EMPLOYER_FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  // Who the page is for, said to machines the way the title says it to people.
  const pageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}${PATH}`,
    audience: { "@type": "BusinessAudience", audienceType: "Human resources, global mobility and in-house immigration teams" },
    about: { "@type": "Thing", name: "PERM labor certification case status" },
  };
  const email = EMPLOYER_SHOTS.email;
  return (
    <>
      <JsonLdScript schema={faqSchema} />
      <JsonLdScript schema={pageSchema} />
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        {/* Wide: the words and the steps in one column, the picture beside both. On a phone the picture comes
            straight after the search and the steps follow it, so the way in and what it leads to share a screen. */}
        <header className="grid grid-cols-1 gap-x-14 gap-y-8 pt-10 [&>*]:min-w-0 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:grid-rows-[auto_1fr]">
          <div className="lg:pt-6">
            <h1 className="text-balance font-heading text-4xl font-bold leading-tight sm:text-5xl">
              Track your company&apos;s PERM cases
            </h1>{" "}
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-soft">
              Find your company to see every case it has at the Labor Department and where each stands. Follow it to
              hear the day one changes.
            </p>{" "}
            <div id="find" className="mt-6 max-w-xl scroll-mt-28">
              <IndexSearch
                title="Find your company"
                action="/perm-employers#all"
                placeholder="Your company's name"
                button="Find it"
                note="Every employer with a PERM case has a page, the cases DOL hasn't decided included."
                footer={
                  <p className="pt-3">
                    Have a case number?{" "}
                    <Link href="/perm-case-status" className="link">
                      Look the case up
                    </Link>
                  </p>
                }
              />
            </div>
          </div>{" "}
          <AppWindow
            className="mx-auto w-full max-w-md lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-w-none"
            url={EMPLOYER_EMAIL_SUBJECT}
            shots={email.shots}
            alt={email.alt}
            caption="The email on a day cases change. A sample company and sample cases."
            priority
          />{" "}
          <ol aria-label="How to follow your company" className="max-w-xl border-t-2 border-border lg:col-start-1 lg:row-start-2 lg:self-start">
            {EMPLOYER_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 border-b-2 border-border py-3">
                <span className="flex size-8 shrink-0 items-center justify-center bg-primary font-mono text-base font-bold text-primary-foreground" aria-hidden="true">
                  {i + 1}
                </span>{" "}
                <p className="min-w-0 text-base leading-relaxed">
                  <span className="font-heading text-lg font-bold leading-snug">{s.title}.</span>{" "}
                  <span className="text-soft">{s.body}</span>
                </p>
              </li>
            ))}
          </ol>
        </header>{" "}
        <IndexFigures figures={figures} className="mt-12" />
      </div>{" "}
      <EmployersTour />{" "}
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
        <section className="mt-14" aria-labelledby="questions">
          <h2 id="questions" className="font-heading text-2xl font-bold">
            Questions
          </h2>
          <FaqList items={EMPLOYER_FAQS} />
        </section>{" "}
        <p className="mt-10 max-w-2xl text-base leading-relaxed text-soft">
          Every status here is the Department of Labor&apos;s own, read from its{" "}
          <a href="https://flag.dol.gov/case-status-search" className="link" target="_blank" rel="noopener noreferrer">
            case-status service
          </a>{" "}
          and its quarterly disclosure files.{" "}
          <Link href="/methodology" className="link">
            How the numbers are made
          </Link>
          .
        </p>
      </div>
    </>
  );
}
