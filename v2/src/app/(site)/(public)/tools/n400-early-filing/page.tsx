import type { Metadata } from "next";

import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { getFAQPageSchema } from "@/lib/structuredData";
import { FaqList } from "@/components/tools/FaqList";
import { N400EarlyFilingCalculator } from "@/components/tools/N400EarlyFilingCalculator";
import { ToolPageFooter } from "@/components/tools/ToolPageFooter";
import { KeepWhole } from "@/components/ui/keep-whole";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";

/**
 * The first day a green card holder can apply for citizenship, as a calculator. The rule is n400EarliestFiling in
 * convex/lib/perm, read from INA 334(a), 8 CFR 334.2(b) and the USCIS Policy Manual (12 USCIS-PM D.6(D), G.3(E)).
 * It prints the day and its citation; physical presence and time abroad stay with the reader, who holds the dates.
 */

const TITLE = "N-400 Early Filing Calculator";
const DESCRIPTION =
  "The first day you can file the N-400: 90 days before your five years as a permanent resident are complete, or three married to a U.S. citizen.";

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools/n400-early-filing" },
  openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: "/tools/n400-early-filing" },
}, "n400-early-filing");

export const dynamic = "force-static";

const FAQS = [
  {
    q: "How early can I file the N-400?",
    a: "Up to 90 days before you first meet the continuous residence requirement. That's five years from the date under Resident since on your green card, or three years if you've been married to a U.S. citizen and living together for those three years. USCIS counts back 90 calendar days from that anniversary (8 CFR 334.2(b) and the USCIS Policy Manual, Volume 12, Part D, Chapter 6).",
  },
  {
    q: "Why does the law say three months when USCIS says 90 days?",
    a: "INA 334(a) says an application may be filed up to three months early. The regulation, 8 CFR 334.2(b), says 90 days, and the Policy Manual counts 90 calendar days with a worked example. The two can differ by a day or two. USCIS counts 90 days, so this calculator does too.",
  },
  {
    q: "Does early filing work on the three-year marriage rule?",
    a: "Yes, for the residence only. The Policy Manual (Volume 12, Part G, Chapter 3) says every other requirement must be met when you file. That includes three years of living in marital union with a spouse who was a U.S. citizen for all three, so the calculator waits for those three years when they end later.",
  },
  {
    q: "What else has to be true when I file?",
    a: "You need at least 30 months (913 days) in the United States out of the five years, or 18 months (548 days) out of the three. You need 3 months of living in your state or USCIS district, which 8 CFR 334.2(b) lets fall inside the 90 days. A single trip abroad of more than 6 months is presumed to break continuous residence, and a trip of a year or more breaks it unless an approved N-470 preserved it (Policy Manual, Volume 12, Part D, Chapter 3).",
  },
  {
    q: "Is this legal advice?",
    a: "No. It's the rule's arithmetic on the dates you enter, with the citation for each step. Whether your trips, your marriage or your record qualify is a question for USCIS and for an immigration attorney.",
  },
];

export default function N400EarlyFilingPage() {
  const faqSchema = getFAQPageSchema(FAQS);
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
      <div className="pt-10 sm:pt-12" />
      <JsonLdScript schema={faqSchema} />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          <KeepWhole>{"N-400 early filing date: when you can apply for citizenship"}</KeepWhole>
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          <KeepWhole>
            {"USCIS takes the application 90 days before your five years as a permanent resident are complete, or " +
              "three if you're married to a U.S. citizen. Enter the date on your green card."}
          </KeepWhole>
        </p>
      </header>
      <section className="mt-10">
        <N400EarlyFilingCalculator />
      </section>
      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">FAQs</h2>
        <FaqList items={FAQS} />
      </section>
      <ToolPageFooter
        currentHref="/tools/n400-early-filing"
        reading={[
          { href: "/uscis-processing-times/n-400", label: "N-400 processing times", note: "how long USCIS takes once it's filed" },
          { href: "/tools/i751-filing-window", label: "I-751 filing window", note: "the 90 days that come first on a two-year green card" },
          { href: "/uscis-case-status", label: "USCIS case status", note: "follow the application by its receipt number once it's in" },
        ]}
      />
    </div>
  );
}
