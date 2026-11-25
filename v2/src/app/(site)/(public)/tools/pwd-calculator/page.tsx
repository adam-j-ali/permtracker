import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/ssr";

import { PwdQueueEstimator } from "@/components/tools/PwdQueueEstimator";
import { PwdValidityWindow } from "@/components/tools/PwdValidityWindow";
import { ToolPageFooter } from "@/components/tools/ToolPageFooter";
import { FaqList } from "@/components/tools/FaqList";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { getFAQPageSchema } from "@/lib/structuredData";
import { openGraphBase } from "@/lib/openGraphBase";
import { getPwdEstimatorData } from "@/lib/db/estimate";
import { getPwdDayData, getPwdLine, getPwdNowDocs } from "@/lib/db/pwdDayQueue";
import { PwdDateEstimate } from "@/components/pwd/PwdDateEstimate";
import { softFail } from "@/lib/softRead";
import { easternDay } from "@/lib/time";
import { currentMonthUtc } from "@/lib/dolFormat";
import { QueueAlertForm } from "../../perm-processing-times/QueueAlertForm";

import { DataProvenance } from "@/components/data/DataProvenance";
import { withSocialCard } from "@/lib/socialCard";
import { buttonVariants } from "@/components/ui/button";
import { StepBothSources } from "@/components/community/StepBothSources";
/**
 * Prevailing wage determination queue calculator.
 *
 * The PWD is the first step of a PERM and it gates every date after it, and
 * essentially every public PERM estimator skips it and starts the clock at the
 * ETA-9089. It also happens to have the better data behind it: DOL publishes
 * pending counts per receipt month here, which it does not for PERM itself.
 */

const TITLE = "PWD Processing Time Calculator";
const DESCRIPTION =
  "When a wage request is likely to be decided, from our daily check of DOL's case status, and how many sit ahead of it in DOL's own published backlog.";

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools/pwd-calculator" },
  openGraph: {
    ...openGraphBase,
    title: `${TITLE} | PERM Tracker`,
    description: DESCRIPTION,
    url: "/tools/pwd-calculator",
  },
}, "pwd-calculator");

// The disclosure files are quarterly, so an hourly window bought
// nothing and cost a regeneration per page per hour across 21,178
// entity pages. A day bounds staleness far below the data's own
// cadence, and the ingests expire it on demand when its data moves
// (the /api/revalidate-* routes).
export const revalidate = 86400;

const FAQS = [
  {
    q: "What’s a prevailing wage determination?",
    a: "It’s DOL's ruling on the minimum wage an employer must offer for a specific job in a specific place. It’s filed on form ETA-9141 and it has to be issued before the PERM recruitment can be relied on, which is why it sits in front of everything else.",
  },
  {
    q: "Why does the prevailing wage queue matter so much?",
    a: "Because the rest of the case is measured from the determination date. The filing date doesn't start any of those clocks. The recruitment window and the ETA-9089 filing window are both arithmetic on it, and the determination itself expires, so a long wage queue moves every deadline that follows.",
  },
  {
    q: "How is the estimate worked out?",
    a: "From our daily check of DOL's case status. It counts the PERM wage requests still in process that were filed before yours and divides them by how many DOL has been finishing a working day, counted in the days DOL works. The range is how far earlier estimates landed from the day DOL decided, or DOL's fastest and slowest recent pace where too few have been tested. DOL's own table counts pending requests by month only, which is why the month box shows how many are ahead.",
  },
  {
    q: "What’s the difference between the OEWS and non-OEWS queues?",
    a: "OEWS is the Occupational Employment and Wage Statistics survey, which is the default wage source. A request that relies on a different source, like an employer-provided survey, goes through a separate queue that DOL reports separately and which usually runs at a different pace.",
  },
];

export default async function PwdCalculatorPage() {
  const [data, line, dayData, nowDocs] = await Promise.all([
    getPwdEstimatorData(),
    getPwdLine(),
    // Our daily count by filing day: the day rule (estimatePwdDay) that /pwd-cases and the case page date from.
    getPwdDayData().catch(softFail("tools/pwd-calculator.getPwdDayData", null)),
    getPwdNowDocs().catch(softFail("tools/pwd-calculator.getPwdNowDocs", { queue: null, trend: null })),
  ]);
  // The day the page rendered, Eastern; the sweep revalidates this page after each run (revalidate-sweep/paths.ts).
  const today = easternDay();

  const faqSchema = getFAQPageSchema(FAQS);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">      <div className="pt-10 sm:pt-12" />
      <JsonLdScript schema={faqSchema} />

      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          Wage request wait calculator
        </h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          When a prevailing wage request is likely to be decided, and how many sit ahead of it in the Department of
          Labor&apos;s own published backlog.
        </p>
      </header>

      {dayData ? (
        <section aria-labelledby="pwd-when-h" className="object mt-10 p-6 sm:p-8">
          <h2 id="pwd-when-h" className="font-heading text-2xl font-bold leading-tight">
            When might mine be decided?
          </h2>{" "}
          <p className="mt-2 text-base text-muted-foreground">Put in the day it was filed. No number needed.</p>{" "}
          <div className="mt-5">
            <PwdDateEstimate data={dayData} lineDay={line?.day ?? null} filedByDay={nowDocs.queue?.filedByDay ?? []} />
          </div>
        </section>
      ) : null}{" "}

      <section data-embed="pwd-queue" className="mt-10">
        <PwdQueueEstimator
          frontier={data ? data.frontier : null}
          backlog={data ? data.backlog : []}
          asOf={data ? data.asOf : null}
          clearancePerMonth={data ? data.clearancePerMonth : null}
          measured={line ? { day: line.day, asOf: line.asOf } : null}
          dayData={dayData}
          today={today}
        />
      </section>

      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">
          What the determination is worth when it lands
        </h2>{" "}
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
          How long a determination stays valid depends on the month DOL issues
          it, so the time it gives you to recruit and file differs from case to
          case.
        </p>
        <PwdValidityWindow className="mt-6" />
      </section>

      {/* The alert, after the answer: the natural next step from reading a
          queue position is asking to hear when DOL reaches your month. Same
          machinery as the PERM month alerts, pointed at the PWD frontiers. */}
      <section className="mt-12">
        <QueueAlertForm
          source="pwd-calculator"
          newestMonth={currentMonthUtc()}
          queue="pwd-oews"
          allowPwdChoice
        />
      </section>

      <StepBothSources here="/tools/pwd-calculator" groups={["pwd"]} />{" "}
      <section className="mt-12">
        <h2 className="font-heading text-2xl font-bold">FAQs</h2>
        <FaqList items={FAQS} />
      </section>

      <section className="mt-12 bg-sage p-6 sm:p-8 border-2 shadow-hard border-border">
        <h2 className="font-heading text-2xl font-bold">
          The determination sets every date that follows
        </h2>{" "}
        <p className="mt-3 leading-relaxed text-muted-foreground">
          The recruitment window, the quiet period and the filing window all
          run from the determination date, and missing one restarts the case.
        </p>
        <Link
          href="/tools/perm-deadline-calculator"
          className={buttonVariants({ variant: "outline", size: "lg", className: "mt-6" })}
        >
          Work out those dates
          <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
        </Link>
      </section>

      <p className="mt-8 max-w-3xl text-base leading-relaxed text-soft">
        No number for your request?{" "}
        <Link href="/pwd-cases" className="link">
          Search wage requests by employer
        </Link>
        , or paste a P- number into the{" "}
        <Link href="/perm-case-status" className="link">
          status lookup
        </Link>{" "}
        to see where it sits.
      </p>{" "}
      <DataProvenance datasets={["processing-times"]} />


      <ToolPageFooter
        currentHref={"/tools/pwd-calculator"}
        reading={[
          { href: "/guides/complete-perm-filing-guide", label: "The complete filing guide", note: "What the determination is for, and every date it sets once issued." },
          { href: "/perm-processing-times", label: "DOL processing times", note: "The prevailing wage queues alongside the PERM ones, from DOL's own page." },
        ]}
      />
    </div>
  );
}
