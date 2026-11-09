/**
 * FAQ Page
 *
 * Comprehensive PERM and PERM Tracker FAQ page.
 * FAQPage JSON-LD for rich results and AI citability.
 */

import { Fragment } from "react";
import type { Metadata } from "next";
import { withSocialCard } from "@/lib/socialCard";
import Link from "next/link";
import { BriefcaseIcon, CalculatorIcon, ChartBarIcon, ClockIcon } from "@phosphor-icons/react/ssr";
import { CaseLookupForm } from "@/components/tools/CaseLookupForm";
import { getFAQPageSchema } from "@/lib/structuredData";
import { openGraphBase } from "@/lib/openGraphBase";
import { FaqList } from "@/components/tools/FaqList";
import { approvalRate, type CasesMeta } from "@/lib/approvalRate";
import { getCasesMeta } from "@/lib/db/publicData";
import { getObservedDays } from "@/lib/db/pulse";
import { howLongSentence } from "@/lib/dolNow";
import { getPermBoard } from "@/lib/db/board";
import { getPermLine } from "@/lib/db/permLine";
import { getProcessingTimes } from "@/lib/db/processingTimes";
import { softFail } from "@/lib/softRead";
import { JsonLdScript } from "@/components/seo/JsonLdScript";

const START_LINKS = [
  { href: "/perm-processing-times", label: "Processing times", note: "Which month DOL is reviewing now", Icon: ClockIcon },
  { href: "/tools", label: "Live PERM data", note: "The queue and the wage backlog, from DOL's figures", Icon: ChartBarIcon },
  { href: "/calculators", label: "Calculators", note: "Deadlines and decision estimates", Icon: CalculatorIcon },
  { href: "/for-attorneys", label: "For professionals", note: "Free case and deadline tracking", Icon: BriefcaseIcon },
] as const;

/** A question group's anchor, from its heading. */
const groupId = (category: string) =>
  `faq-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

export const dynamic = "force-static";
// One answer quotes DOL's published average, so the page refreshes daily and
// whenever DOL republishes (it is on revalidate-dol's list).
export const revalidate = 86400;

// Replaced at render with the wait of DOL's latest decisions, the month our daily check sees DOL deciding, and
// DOL's own average with its date (howLongSentence in lib/dolNow.ts, the case page's sentence too).
const HOW_LONG = "{howLong}";
// Replaced at render with DOL's own approval rate, its count and dates, and our check's newest 30 days
// (lib/approvalRate.ts, the homepage's and the approval page's sentence too).
const APPROVAL = "{approval}";

export const metadata: Metadata = withSocialCard({
  // Named for what the page answers (it is the main sitelink under a search
  // for "perm tracker", 23,571 appearances in the 3 months to Oct 5 2026).
  title: "PERM FAQ: Timelines, Audits and Next Steps",
  description:
    "Plain answers to common PERM questions: how long it takes, what triggers an audit, the denial rate, the I-140 deadline and how to check your status.",
  alternates: { canonical: "/faq" },
  openGraph: {
    ...openGraphBase,
    title: "PERM FAQ: Timelines, Audits and Next Steps | PERM Tracker",
    description:
      "Plain answers to common PERM questions: how long it takes, what triggers an audit, the denial rate, the I-140 deadline and how to check your status.",
    url: "/faq",
  },
}, "faq");

// Comprehensive FAQ data — all plain text for structured data compatibility
const faqData = [
  {
    // The four brand-defining questions (what it does, is it free, client
    // data, import) live on the HOMEPAGE; see
    // components/home/faqData.tsx. This page keeps the process questions.
    category: "Using PERM Tracker",
    items: [
      {
        question: "How is this different from using a spreadsheet?",
        answer:
          "A spreadsheet needs its deadline math done by hand. It doesn’t send reminders, and it breaks when the regulations change. PERM Tracker works out 11 deadline types per case from DOL’s regulations (20 CFR 656) and sends an alert before each one. It checks each case against the rules, and when one date changes it updates every date that follows.",
      },
      {
        question: "What happens if DOL changes regulations?",
        answer:
          "We watch for changes to DOL’s regulations and update the deadline calculations to match. Your existing cases are then recalculated automatically, so you don’t need to update formulas or check for rule changes yourself.",
      },
    ],
  },
  {
    category: "The PERM process",
    items: [
      {
        question: "What’s PERM labor certification?",
        answer:
          "PERM (Program Electronic Review Management) is how a U.S. employer shows the Department of Labor that there are no qualified, willing, and available U.S. workers for a job it’s offering a foreign national. It’s typically the first step toward an employment-based green card in the EB-2 and EB-3 categories.",
      },
      {
        question: "How long does the PERM process take?",
        answer:
          "The whole PERM process typically runs 18 to 36 months: the prevailing wage determination, the recruitment period (2 to 3 months), the 30-day quiet period, and DOL's own review of the ETA 9089. {howLong} Cases selected for audit take longer. The processing times page carries the live figure, and the case status page reads any specific case number.",
      },
      {
        question: "What are the main steps in the PERM process?",
        answer:
          "There are five main stages. (1) The prevailing wage determination: the employer applies to the National Prevailing Wage Center (NPWC) and gets back the wage level for the job. (2) Recruitment: the required advertising, including the SWA job order, newspaper ads and extra steps for professional jobs. (3) Filing: ETA Form 9089 goes in electronically after the 30-day quiet period. (4) DOL’s review, which ends in an approval or a denial, or sends the case to audit. (5) The I-140: the immigrant petition, filed within 180 days of PERM certification.",
      },
      {
        question: "What’s a prevailing wage determination (PWD)?",
        answer:
          "The National Prevailing Wage Center sets the minimum wage an employer must offer for the role, from its occupation, skill level and area. How long it stays valid depends on the wage year. It isn’t counted from the determination date: one issued 30 June 2026 is good for 90 days, and one issued the next morning is good for 364. The PERM has to be filed before it expires. Track a request by putting its P- number into case status, or search by employer.",
      },
      {
        question: "What recruitment steps are required for PERM?",
        answer:
          "Every PERM case needs a State Workforce Agency (SWA) job order for 30 days, two print newspaper ads and a 30-day internal posting at the company. Professional jobs (those requiring a bachelor's degree or higher) also need three more recruitment steps. They're chosen from a list that includes job fairs, the employer's website, an employee referral program, campus recruiting, trade or professional organizations and private placement agencies.",
      },
      {
        question: "What triggers a PERM audit?",
        answer:
          "A layoff in the same occupation within 6 months is a common trigger. So are job requirements above the norm for the occupation, such as a specific degree or a foreign language with no business necessity. A mismatch between the job offer and the beneficiary's qualifications can draw one too, and so can an unusual wage level. DOL also picks some cases at random. Clean documentation and well-justified job requirements lower the risk.",
      },
      {
        question: "What’s the ETA 9089 filing window?",
        answer:
          "The ETA 9089 can be filed once 30 days have passed since the last mandatory recruitment step, and no later than 180 days after the first one: under 20 CFR 656.17(e), no mandatory step may be more than 180 days old on the day you file. Filing too early is a denial. Missing the end means starting recruitment over. PERM Tracker works out this window from your recruitment dates.",
      },
      {
        question: "How long do I have to file the I-140 after PERM certification?",
        answer:
          "The I-140 immigrant petition must be filed within 180 days of PERM certification. If it isn’t, the certification expires and everything starts over. PERM Tracker tracks this deadline automatically and sends reminders as it gets close.",
      },
    ],
  },
  {
    category: "The live data",
    items: [
      {
        question: "Is there any way to check my PERM status myself?",
        answer:
          "Yes. A lot of advice says only the employer or the attorney can check a pending PERM. In fact DOL's own FLAG system answers a case number for anyone who has it, pending cases included. Put yours into case status for the live DOL status, your place in the queue, a stage-aware estimate and an optional email alert. Wage request (P-) and H-1B LCA (I-) numbers work the same way. The number is on the filing receipt. Without it, search the employer by name.",
      },
      {
        question: "Where do the processing time numbers come from?",
        answer:
          "Straight from the Department of Labor. The queue position and average days come from DOL's own published processing times, which refresh automatically. DOL's quarterly disclosure files supply the medians: 250,000+ decided cases, combined and de-duplicated by case number. The methodology page lists every source and how each figure is built.",
      },
      {
        question: "Which states file the most PERM cases?",
        answer:
          "California and Texas lead by a wide margin. Volume follows where the industries are, and no state has a faster or slower line: DOL works one national queue, oldest first. The interactive state map shows filings, approval rates, median days and median wages for every state, from DOL's own files.",
      },
      {
        question: "What do PERM cases pay?",
        answer:
          "The wages page shows median offered wages by occupation from DOL's disclosure files. These are wages employers committed to in federal filings. Hourly and other units are annualized before medians are taken.",
      },
      {
        question: "How often is PERM approved?",
        answer: `${APPROVAL} The approval and denial rates page breaks it down by offered wage, job, state and the answers on the form.`,
      },
      {
        question: "What’s the PERM denial rate?",
        answer:
          "Denials are rare: across DOL's current disclosure window under 3% of decided PERM cases were denied, with withdrawn cases excluded from both sides of that ratio. The rate isn’t evenly spread. The denial rates page breaks it down by offered wage, by fiscal year, and by the three risk questions the ETA-9089 itself asks. A group rate isn’t a probability for any single case.",
      },
      {
        question: "Which law firms file the most PERM cases?",
        answer:
          "Fragomen files by far the most, followed by Berry Appleman & Leiden and Ogletree Deakins. Our law firms page ranks the most active firms with case volume, approval rate and median processing days, straight from the firm name DOL prints on every filing. The page carries one caution: DOL prints a single practice under several spellings, so a big firm's total can span more than one row. Approval rates cluster above 99% across the whole list.",
      },
      {
        question: "Which employers sponsor the most green cards?",
        answer:
          "The employers page ranks the hundred biggest PERM sponsors in the current disclosure window, searchable, with each one's filings, certifications, approval rate and median processing days. Names appear exactly as DOL prints them, so one company can appear under several legal entities.",
      },
    ],
  },
];

const LEARN_MORE = [
  { href: "/blog/what-is-perm-labor-certification", label: "What's PERM?", note: "the whole process, start to finish" },
  { href: "/blog/perm-processing-times-2026", label: "Processing times in 2026", note: "where DOL's queue stands" },
  { href: "/guides/getting-started", label: "Getting started", note: "the lookup, the alerts and the app" },
] as const;

export default async function FAQPage() {
  const [times, permBoard, permLine, casesMeta, observed] = await Promise.all([
    getProcessingTimes().catch(softFail("faq/page.getProcessingTimes", null)),
    getPermBoard().catch(softFail("faq/page.getPermBoard", null)),
    getPermLine().catch(softFail("faq/page.getPermLine", null)),
    getCasesMeta<CasesMeta>().catch(softFail("faq/page.getCasesMeta", null)),
    getObservedDays().catch(softFail("faq/page.getObservedDays", [])),
  ]);
  const howLong = howLongSentence(permBoard, times, permLine);
  const rate = approvalRate(casesMeta, observed);
  // With DOL's files unreadable the answer says where the figures are rather than printing none.
  const approval = rate
    ? `${rate.files}${rate.recent ? ` ${rate.recent}` : ""}`
    : "Most PERM cases DOL decides are certified, by DOL's own disclosure files.";
  const faq = faqData.map((section) => ({
    ...section,
    items: section.items.map((i) => ({ ...i, answer: i.answer.replace(HOW_LONG, howLong).replace(APPROVAL, approval) })),
  }));
  // Flatten all FAQ items for structured data
  const allFAQs = faq.flatMap((section) => section.items);
  const groups = faq.map((section) => ({ ...section, id: groupId(section.category) }));
  const { '@context': _1, ...faqSchema } = getFAQPageSchema(allFAQs);
  const schemas = { '@context': 'https://schema.org', '@graph': [faqSchema] };

  return (
    <>
      <JsonLdScript schema={schemas} />

      <section className="border-b-2 border-border bg-card">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-start [&>*]:min-w-0">
          <div>
            <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl mb-3">
              Frequently asked questions
            </h1>{" "}
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              What applicants and attorneys ask about PERM Tracker and
              the PERM labor certification process.
            </p>{" "}
            {/* Most visits here come from a search for the site's name, and
                the pages people open next are the lookup, processing times
                and the data (PostHog, 30 days to Oct 6 2026). */}
            <CaseLookupForm className="mt-8 max-w-2xl" source="faq" />
          </div>{" "}
          <nav aria-label="Main tools" className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            {START_LINKS.map((l) => (
              <Fragment key={l.href}>
                {" "}
                <Link
                  href={l.href}
                  className="group flex flex-col border-2 border-input bg-card p-4 transition-[color,background-color,border-color,box-shadow,transform] hover:bg-accent shadow-hard-sm motion-safe:hover:-translate-y-0.5"
                >
                  <l.Icon aria-hidden="true" className="size-6 text-primary-text" />{" "}
                  <span className="mt-3 font-heading text-base font-bold leading-tight">{l.label}</span>{" "}
                  <span className="mt-1 text-sm leading-snug text-muted-foreground">{l.note}</span>
                </Link>
              </Fragment>
            ))}
          </nav>
        </div>
      </section>{" "}

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-[14rem_minmax(0,1fr)] [&>*]:min-w-0">
        {/* The groups, with how many questions each holds: a contents list
            that stays beside the questions on a wide screen. */}
        <nav aria-label="Question groups" className="max-lg:hidden">
          <ol className="sticky top-[calc(var(--site-header-h)+1.5rem)] space-y-1 border-l-4 border-border pl-4">
            {groups.map((g) => (
              <Fragment key={g.id}>
                {" "}
                <li>
                  <a
                    href={`#${g.id}`}
                    className="flex min-h-11 items-center justify-between gap-3 text-sm font-bold hover:text-primary-text"
                  >
                    <span>{g.category}</span>{" "}
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">{g.items.length}</span>
                  </a>
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>{" "}
        <div className="max-w-[820px] space-y-12">
        {groups.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`}>
            <h2 id={`${g.id}-title`} className="font-heading text-xl font-bold">
              {g.category}
            </h2>
            <FaqList items={g.items.map((i) => ({ q: i.question, a: i.answer }))} openFirst={false} />
          </section>
        ))}

        <nav aria-labelledby="learn-more" className="border-t border-border pt-8">
          <h2 id="learn-more" className="font-heading text-xl font-bold">Learn more</h2>{" "}
          <ul className="mt-4 space-y-3 text-base">
            {LEARN_MORE.map((l) => (
              <Fragment key={l.href}>
                <li>
                  <Link href={l.href} className="link">
                    {l.label}
                  </Link>{" "}
                  <span className="text-muted-foreground">{l.note}</span>
                </li>{" "}
              </Fragment>
            ))}
          </ul>
        </nav>
        </div>
      </div>
    </>
  );
}
