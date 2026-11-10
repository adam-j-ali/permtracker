import type { Metadata } from "next";

import { DataProvenance } from "@/components/data/DataProvenance";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { FaqList } from "@/components/tools/FaqList";
import { ToolPageFooter } from "@/components/tools/ToolPageFooter";
import { UscisCaseTimeline, type InquiryRow } from "@/components/tools/UscisCaseTimeline";
import { SearchParamsBoundary } from "@/hooks/useUrlSearchParams";
import { getUscisPosted } from "@/lib/db/uscisPosted";
import { getUscisFormQuarter } from "@/lib/db/uscisQuarterly";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";
import { softFail } from "@/lib/softRead";
import { medianLineFor, pickMedian } from "@/lib/uscisInquiry";
import { quarterLabel } from "@/lib/uscisQuarterlyShape";
import { longDate } from "@convex/lib/months";

/**
 * A USCIS case on its own calendar: from the form, the office and the receipt date, the day half of such cases
 * were decided by, the day eight in ten were, and the day USCIS will take a question about it.
 *
 * Every figure is USCIS's own. The posted time and the inquiry cutoff come from its processing-times page as
 * posted (`getUscisPosted`, expired by /api/revalidate-uscis-times the run a new posting is copied), and the
 * median from its quarterly report, only where a line of that report counts the same cases as the posted
 * category (`medianLineFor`). A failed read of the posting throws, so the page keeps its last good render; the
 * quarterly report is a soft read, and without it the page shows the posted figures alone.
 */

const TITLE = "USCIS Case Inquiry Date Calculator";
const DESCRIPTION =
  "From your form, office and receipt date: when half of such cases were decided, when 8 in 10 were, and the day USCIS will take a question about yours.";

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools/uscis-case-inquiry" },
  openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: "/tools/uscis-case-inquiry" },
}, "uscis-case-inquiry");

export const revalidate = 604800;

const FAQS = [
  {
    q: "When can I ask USCIS about my case?",
    a: "Once it has waited longer than the time USCIS took to finish 93% of similar cases. USCIS's processing-times page turns that into a receipt date for each form, category and office: a case received before it may be asked about. Where USCIS posts no time for a form, its default is six months from the receipt date.",
  },
  {
    q: "Why is that later than the processing time USCIS prints?",
    a: "The time USCIS prints is how long it took to finish 80% of cases. The inquiry date uses 93%. So a case can pass the printed time and still be inside what USCIS calls normal processing.",
  },
  {
    q: "What's the difference between the median and the posted time?",
    a: "The median is the time by which half of cases were decided, from USCIS's quarterly report, across every office. The posted time is the time by which 80% were, for one office. Most cases finish between the two.",
  },
  {
    q: "Does asking speed up my case?",
    a: "It gets you an answer about where the case stands. USCIS decides the timing, and an inquiry or a congressional request doesn't move a case ahead of others.",
  },
  {
    q: "Is anything I type here sent anywhere?",
    a: "No. The dates and the note are worked out in your browser. The page stores nothing and sends nothing.",
  },
  {
    q: "Is this legal advice?",
    a: "No. The dates are arithmetic on USCIS's own published figures and your receipt date. Whether a delay is unreasonable, and what to do about it, are questions for an immigration attorney.",
  },
];

export default async function UscisCaseInquiryPage() {
  const [posted, quarter] = await Promise.all([
    getUscisPosted(),
    getUscisFormQuarter().catch(softFail("uscis-case-inquiry/getUscisFormQuarter", null)),
  ]);
  const medians = quarter?.forms ?? [];
  const quarterName = quarter ? quarterLabel(quarter.fy, quarter.quarter) : "";
  const rows: InquiryRow[] = (posted?.newest ?? []).map((r) => {
    const months = pickMedian(medians.filter((m) => m.form === r.form), medianLineFor(r.form, r.subtype));
    return {
      form: r.form,
      subtype: r.subtype,
      label: r.label ?? r.subtype,
      office: r.office,
      officeLabel: r.officeLabel ?? r.office,
      requestDate: r.requestDate,
      posted: r.posted,
      postedText: r.postedText,
      median: months !== null ? { months, quarter: quarterName } : null,
    };
  });
  // A form's name, from the quarterly report's own title for it, without the basis in brackets.
  const formNames: Record<string, string> = {};
  for (const m of medians) if (!formNames[m.form]) formNames[m.form] = m.title.replace(/\s*\([^)]*\)\s*$/, "");

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage" as const,
    mainEntity: FAQS.map((f) => ({ "@type": "Question" as const, name: f.q, acceptedAnswer: { "@type": "Answer" as const, text: f.a } })),
  };
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <JsonLdScript schema={faqSchema} />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">When will USCIS decide my case, and when can I ask?</h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Pick your form and office and enter your receipt date. This puts USCIS&apos;s own figures on your case&apos;s calendar
          {posted ? `, from its posting of ${longDate(posted.published) ?? posted.published}` : ""}.
        </p>
      </header>
      <section data-embed="uscis-case-inquiry" className="mt-10">
        {rows.length > 0 && posted ? (
          <SearchParamsBoundary>
            <UscisCaseTimeline rows={rows} published={posted.published} formNames={formNames} />
          </SearchParamsBoundary>
        ) : (
          <p className="object p-5 text-base leading-relaxed sm:p-8">
            USCIS&apos;s posted times aren&apos;t on file at the moment, so this page can&apos;t date a case. USCIS&apos;s own{" "}
            <a href="https://egov.uscis.gov/processing-times/" className="link" target="_blank" rel="noopener noreferrer">
              processing times tool
            </a>{" "}
            gives the inquiry date for a receipt date.
          </p>
        )}
      </section>
      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">FAQs</h2>
        <FaqList items={FAQS} />
      </section>
      <DataProvenance datasets={["uscis-posted-times", "uscis-form-quarters"]} />
      <ToolPageFooter
        currentHref="/tools/uscis-case-inquiry"
        reading={[
          { href: "/guides/uscis-congressional-inquiry", label: "Congressional inquiry for a USCIS case", note: "when and how an office asks for you, and what comes after" },
          { href: "/uscis-processing-times", label: "USCIS processing times", note: "every posted time, and how each has moved" },
          { href: "/tools/priority-date-calculator", label: "Priority date calculator", note: "whether your date is current this month" },
        ]}
      />
    </div>
  );
}
