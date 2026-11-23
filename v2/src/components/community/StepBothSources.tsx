import Link from "next/link";

import { Figure, FigureRow } from "@/components/data/FigureRow";
import { PageSection } from "@/components/data/PageSection";
import { StepFigures } from "@/components/community/StepFigures";
import { getOfficialHeadlines } from "@/lib/db/officialHeadlines";
import { getReportedSummary } from "@/lib/db/reportedSummary";
import { softFail } from "@/lib/softRead";
import { stepsIn, windowText, type ReportedSummary, type StepGroup } from "@/lib/reportedSummary";
import { STEP_GROUP_NAMES } from "@/lib/stepSources";

/**
 * Both sources for a step, on every page about it: the agency's own headline figure (DOL, USCIS or State, dated
 * and linked to its page) beside how long people's own cases took (the hourly summary of every reported case,
 * src/lib/db/reportedSummary.ts). Every step before, during and after PERM shows both (the owner's call, Nov 20 2026),
 * and scripts and tests hold every step page to it (src/lib/stepSources.ts, STEP_PAGES).
 *
 * Each side reads on its own: a failed read loses only its side and says so. A step people rarely report (the wage
 * request) shows the agency's figure and says how few reported it, never a 0 that reads as a measurement.
 */
export async function StepBothSources({
  groups,
  reported: withReported = true,
  title = "How long this step is taking, from both sides",
  id = "both-sources",
  here,
}: {
  groups: readonly StepGroup[];
  /** The page's own path: a figure whose page this is links nowhere. */
  here?: string;
  /** False on a page that shows people's reported steps itself: the section adds only the agency's figures. */
  reported?: boolean;
  title?: string;
  id?: string;
}) {
  const [official, summary] = await Promise.all([
    getOfficialHeadlines(groups),
    withReported ? getReportedSummary().catch(softFail<ReportedSummary | null>("StepBothSources.summary", null)) : null,
  ]);
  const reported = summary ? groups.flatMap((g) => stepsIn(summary.steps, g)) : [];
  const measured = reported.filter((s) => s.median !== null);
  const few = reported.filter((s) => s.median === null && s.n > 0);
  const officials = groups.flatMap((g) => (official[g] ? [{ g, h: official[g]! }] : []));

  return (
    <PageSection
      id={id}
      title={title}
      lede={
        withReported
          ? "The agency's own count, beside how long the cases people reported to us took. Each says what it is and when it was true."
          : "The agency's own count for each step, dated, beside the reported steps on this page."
      }
    >
      {officials.length ? (
        <FigureRow>
          {officials.map(({ g, h }) => (
            <Figure
              key={g}
              label={h.label}
              value={h.value}
              kind={h.kind}
              note={
                <>
                  {h.note}{" "}
                  {h.href === here ? null : (
                    <Link href={h.href} className="link">
                      {`${STEP_GROUP_NAMES[g]}: the agency's figures`}
                    </Link>
                  )}
                </>
              }
            />
          ))}
        </FigureRow>
      ) : (
        <p className="text-base text-muted-foreground">The agency&apos;s figures for this step can&apos;t be read right now.</p>
      )}{" "}
      {!withReported ? null : summary === null ? (
        <p className="mt-6 text-base text-muted-foreground">The cases people reported can&apos;t be read right now.</p>
      ) : measured.length ? (
        <div className="mt-6">
          <StepFigures steps={measured} allHref="/green-card-timelines" label="How long people's own cases took at this step" />
        </div>
      ) : (
        <p className="mt-6 max-w-3xl text-base leading-relaxed">
          {few.length
            ? `Only ${few.map((s) => `${s.n} ${s.n === 1 ? "case" : "cases"} for "${s.label}"`).join(", ")} were reported in ${windowText(few[0]!.windowDays)}, too few for a typical wait. The agency's figure above covers every case.`
            : "Few people report this step's dates, so the agency's figure above is the guide."}{" "}
          <Link href="/green-card-timelines#add-h" className="link font-bold">
            Add your own dates
          </Link>
        </p>
      )}
    </PageSection>
  );
}
