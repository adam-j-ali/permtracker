import type { Metadata } from "next";

import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { FaqList } from "@/components/tools/FaqList";
import { I751WindowCalculator } from "@/components/tools/I751WindowCalculator";
import { ToolPageFooter } from "@/components/tools/ToolPageFooter";
import { KeepWhole } from "@/components/ui/keep-whole";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";

/**
 * The 90 days to file the I-751 that removes the conditions on a two-year green card, as a calculator. The rule is
 * i751FilingWindow in convex/lib/perm, read from 8 CFR 216.4(a) and USCIS's own filing calculator.
 */

const TITLE = "I-751 Filing Window Calculator";
const DESCRIPTION =
  "When to file the I-751 to remove conditions on a green card: the 90 days before the date it expires, worked out from the card, with the rules behind it.";

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools/i751-filing-window" },
  openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: "/tools/i751-filing-window" },
}, "i751-filing-window");

export const dynamic = "force-static";

const FAQS = [
  {
    q: "When can I file the I-751?",
    a: "In the 90 days before the date under Card expires on your two-year green card. 8 CFR 216.4(a)(1) sets the window as the 90 days immediately before the second anniversary of the day you became a conditional resident, and that anniversary is the card's date. USCIS's own calculator counts back 90 days from it.",
  },
  {
    q: "What happens if I miss the window?",
    a: "The conditional status ends on its own (8 CFR 216.4(a)(6)). A late petition can still be filed with a written explanation, and USCIS excuses it only for good cause. The form's instructions ask you to show that the delay came from circumstances beyond your control and that its length was reasonable.",
  },
  {
    q: "Can I file without my spouse?",
    a: "Yes, with a request to waive the joint filing: when your spouse has died, the marriage has ended, you were battered or subjected to extreme cruelty, or losing status would cause extreme hardship. USCIS says that request can be filed before or after the 90 days, until a final removal order.",
  },
  {
    q: "Is my green card still good while the petition waits?",
    a: "Yes. A properly filed I-751 extends the conditional status until USCIS decides (8 CFR 216.4(a)(1)). USCIS says the receipt notice extends the status and work authorization for 48 months past the card's date.",
  },
  {
    q: "Do my children file too?",
    a: "A child who became a conditional resident the same day as you, or within 90 days after, goes on your petition. A child who got status later files a separate I-751.",
  },
  {
    q: "Does the same window apply to investors?",
    a: "Yes. USCIS says an investor files the I-829 within the 90 days before the green card expires, so the dates here are the same.",
  },
  {
    q: "Is this legal advice?",
    a: "No. It's the rule's arithmetic on the date you enter, with each citation. Whether a waiver fits your case is a question for an immigration attorney.",
  },
];

export default function I751FilingWindowPage() {
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
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          <KeepWhole>{"I-751 filing window: when to file to remove conditions"}</KeepWhole>
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          <KeepWhole>
            {"A two-year green card's conditions come off with a petition filed in the 90 days before the card " +
              "expires. Enter the date on the card."}
          </KeepWhole>
        </p>
      </header>
      <section className="mt-10">
        <I751WindowCalculator />
      </section>
      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">FAQs</h2>
        <FaqList items={FAQS} />
      </section>
      <ToolPageFooter
        currentHref="/tools/i751-filing-window"
        reading={[
          { href: "/uscis-processing-times/i-751", label: "I-751 processing times", note: "how long USCIS takes once it's filed" },
          { href: "/tools/n400-early-filing", label: "N-400 early filing date", note: "when the same card lets you apply for citizenship" },
          { href: "/uscis-case-status", label: "USCIS case status", note: "follow the petition by its receipt number" },
        ]}
      />
    </div>
  );
}
