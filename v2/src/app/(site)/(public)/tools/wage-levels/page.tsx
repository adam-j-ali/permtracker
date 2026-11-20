import type { Metadata } from "next";

import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { FaqList } from "@/components/tools/FaqList";
import { ToolPageFooter } from "@/components/tools/ToolPageFooter";
import { readRules } from "@/lib/db/rulePipeline";
import { softFail } from "@/lib/softRead";
import { WAGE_PROPOSAL } from "@/lib/wageProposal";
import { US_STATE_NAMES } from "@/lib/usStateNames";
import { WageLevelsTool } from "@/components/tools/WageLevelsTool";
import { openGraphBase } from "@/lib/openGraphBase";
import { SOC_CODE_RE, socGroup } from "@/lib/socCode";
import { withSocialCard } from "@/lib/socialCard";
import { StepBothSources } from "@/components/community/StepBothSources";

/**
 * DOL's four prevailing wage levels for an occupation in an area, read live
 * from the OFLC wage search. The one wage question every PERM and every
 * H-1B starts with, answered from the source that sets it.
 */

const TITLE = "Prevailing Wage Levels by Occupation and Area";
const DESCRIPTION =
  "DOL's four prevailing wage levels for any job and area, and the level your job will likely get by DOL's own method, checked against its decisions.";

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools/wage-levels" },
  openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: "/tools/wage-levels" },
}, "wage-levels");

export const dynamic = "force-dynamic";

const FAQS = [
  {
    q: "Which wage level will my job get?",
    a: "DOL starts every job at Level I and adds a level for experience beyond the occupation's usual range, a degree above its usual one, a foreign language and supervising, then caps the total at Level IV. The estimate under the levels follows those written steps, plus required travel, which DOL's own decisions show adds a level for many jobs. Run on DOL's PERM decisions from April to September 2026, it matched DOL's level about 84% of the time and came within one level about 99% of the time. DOL also reads the job's duties, so treat it as an estimate.",
  },
  {
    q: "Where do these numbers come from?",
    a: "From DOL's own wage search on flag.dol.gov, the same lookup the National Prevailing Wage Center's determinations are drawn from, using the all-industries OEWS series. This page asks DOL for the occupation and area you pick and prints what DOL answers, with the series year. When DOL's search doesn't answer, the page shows the same figures from DOL's published wage file for that year, and says so.",
  },
  {
    q: "Which level will my case get?",
    a: "The level is set from the job's requirements against what the occupation normally requires: education, experience, supervision, special skills. Level I is entry, Level IV fully competent. DOL decides it on the ETA-9141. This page shows the four figures so a determination can be read against them.",
  },
  {
    q: "Why does the series matter?",
    a: "OEWS wages turn over every July 1. A determination issued between July 1 and June 30 uses that July's series, and its validity runs to the next June 30 or 90 days, whichever the rule gives. Pick the series a determination was issued in to read the figures it was set from.",
  },
  {
    q: "What if DOL prints no wage for my area?",
    a: "Some occupation and area pairs have no OEWS estimate, and DOL's search answers with zeros. This page says so instead of showing zero dollars. The wage request itself can still be determined. The center uses a broader area or another source when the local estimate is missing.",
  },
];

export default async function WageLevelsPage({ searchParams }: { searchParams: Promise<{ soc?: string; state?: string }> }) {
  const { soc, state } = await searchParams;
  const initialSoc = soc && SOC_CODE_RE.test(soc) ? socGroup(soc) ?? "" : "";
  // A state a link names (a case's job card passes its job state): only a real two-letter code, else none.
  const initialState = typeof state === "string" && /^[A-Za-z]{2}$/.test(state) && US_STATE_NAMES[state.toUpperCase()] ? state.toUpperCase() : "";
  // Where the proposed wage rule stands, from the rule watch. Unread, the table says only what's printed in the
  // proposal: it never guesses a stage.
  const rule = (await readRules([WAGE_PROPOSAL.rin]).catch(softFail("tools/wage-levels.rule", null)))?.get(WAGE_PROPOSAL.rin) ?? null;
  const ruleStage = rule ? { sentToReview: rule.fReceived, finalPublished: rule.finalPublished } : null;
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
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">Prevailing wage levels</h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          DOL&apos;s four wage levels for an occupation in a metro or non-metro area, read live from the OFLC wage
          search, and the level your job will likely get by DOL&apos;s own method. Pick the series a determination was
          issued in and read it against the four.
        </p>
      </header>
      <section data-embed="wage-levels" className="mt-10">
        <WageLevelsTool initialSoc={initialSoc} initialState={initialState} ruleStage={ruleStage} />
      </section>
      <StepBothSources here="/tools/wage-levels" groups={["pwd"]} />{" "}
      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">FAQs</h2>
        <FaqList items={FAQS} />
      </section>
      <ToolPageFooter
        currentHref="/tools/wage-levels"
        reading={[
          { href: "/guides/how-dol-sets-a-prevailing-wage", label: "How DOL sets a prevailing wage", note: "the level rule and the survey behind it" },
          { href: "/tools/salary-explorer", label: "Salary explorer", note: "what certified PERM jobs offered, by occupation and state" },
          { href: "/tools/pwd-validity", label: "Wage determination validity", note: "when a determination expires" },
        ]}
      />
    </div>
  );
}
