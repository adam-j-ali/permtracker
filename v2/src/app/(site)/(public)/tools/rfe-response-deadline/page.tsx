import type { Metadata } from "next";

import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { getFAQPageSchema } from "@/lib/structuredData";
import { FaqList } from "@/components/tools/FaqList";
import { ToolPageFooter } from "@/components/tools/ToolPageFooter";
import { UscisRfeDeadlineCalculator } from "@/components/tools/UscisRfeDeadlineCalculator";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";

/**
 * The day USCIS must receive the answer to a request for evidence or a notice of intent to deny, as a calculator.
 * The rule is rfeResponseDeadline in convex/lib/perm, as 1 USCIS-PM E.6(F) states it from 8 CFR 103.2(b)(8)(iv),
 * 103.8(b) and 1.2. A PERM request for information is DOL's and has its own page (/tools/rfi-deadline).
 */

const TITLE = "USCIS RFE Response Deadline Calculator";
const DESCRIPTION =
  "The day USCIS must receive your answer to a request for evidence or a notice of intent to deny: the notice's days, 3 more if mailed, past any weekend.";

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools/rfe-response-deadline" },
  openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: "/tools/rfe-response-deadline" },
}, "rfe-response-deadline");

export const dynamic = "force-static";

const FAQS = [
  {
    q: "How long do I have to answer an RFE?",
    a: "The notice says. A request for evidence gives at most 12 weeks (84 days), and a notice of intent to deny at most 30 days (8 CFR 103.2(b)(8)(iv)). The USCIS Policy Manual gives 30 days for the I-539 and the I-601A and 84 for every other form, and a naturalization applicant generally gets 30.",
  },
  {
    q: "Why are 3 days added?",
    a: "When USCIS mails a notice, 8 CFR 103.8(b) adds 3 days to the period, and counts the notice as served on the day it was mailed. So a mailed request for evidence gives at most 87 days from its date. A notice posted to your online account gets no extra days.",
  },
  {
    q: "What if the last day is a weekend or a holiday?",
    a: "The period runs to the end of the next day that isn't a Saturday, Sunday or federal holiday (8 CFR 1.2). The Policy Manual applies that rule to a mailed response. A response sent through your online account counts the day you submit it, a weekend included.",
  },
  {
    q: "Can I ask USCIS for more time?",
    a: "No. 8 CFR 103.2(b)(8)(iv) says additional time to respond may not be granted.",
  },
  {
    q: "What if I don't respond in time?",
    a: "The case may be denied as abandoned, denied on the record, or both (8 CFR 103.2(b)(13)(i)).",
  },
  {
    q: "How do I send the response?",
    a: "All of it at once, with the original notice (8 CFR 103.2(b)(11)). Sending only part of what was asked counts as a request for a decision on the record.",
  },
  {
    q: "Is a PERM RFI the same thing?",
    a: "No. A request for information on a PERM application comes from DOL, and its rule is 30 days from the date on DOL's letter. The RFI and audit deadline calculator counts that one.",
  },
];

export default function RfeResponseDeadlinePage() {
  const faqSchema = getFAQPageSchema(FAQS);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <JsonLdScript schema={faqSchema} />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          USCIS RFE response deadline: the day your answer must arrive
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          The days your notice gives, 3 more when it came by mail, and on past a weekend or a federal holiday. Enter the
          date on the notice.
        </p>
      </header>
      <section className="mt-10">
        <UscisRfeDeadlineCalculator />
      </section>
      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">FAQs</h2>
        <FaqList items={FAQS} />
      </section>
      <ToolPageFooter
        currentHref="/tools/rfe-response-deadline"
        reading={[
          { href: "/uscis-rfe-rates", label: "USCIS RFE rates", note: "how often USCIS asks for more evidence, form by form" },
          { href: "/uscis-case-status", label: "USCIS case status", note: "see when the response is received" },
          { href: "/tools/rfi-deadline", label: "RFI and audit deadline", note: "the PERM's own 30 days, from DOL's letter" },
        ]}
      />
    </div>
  );
}
