import Link from "next/link";

import { StepFigures } from "@/components/community/StepFigures";
import { getOfficeSummary, getPostSummary, getReportedSummary } from "@/lib/db/reportedSummary";
import { formatInt } from "@/lib/format";
import { windowText, type StepFigure } from "@/lib/reportedSummary";
import { softFail } from "@/lib/softRead";

/**
 * Live figures from every case people reported, for an article: the step cards for the steps it names, or one
 * step's median as words in a sentence. The figures are the hourly build's (scripts/lib_reported_summary.py), so an
 * article never carries a number typed in by hand, and each figure says its window and its count.
 *
 *   <ReportedStepsNow steps="i485-bio,i485-ead" />
 *   <ReportedStepsNow steps="i485-gc" place="office:SFV" />
 *   ...took <ReportedMedianNow step="interview-gc" /> from the interview...
 */

async function stepsFor(place: string | undefined): Promise<{ steps: StepFigure[]; cases: number } | null> {
  if (place?.startsWith("office:")) {
    const s = await getOfficeSummary(place.slice(7)).catch(softFail("ReportedStepsNow.office", null));
    return s ? { steps: s.steps, cases: s.cases } : null;
  }
  if (place?.startsWith("post:")) {
    const s = await getPostSummary(place.slice(5)).catch(softFail("ReportedStepsNow.post", null));
    return s ? { steps: s.steps, cases: s.cases } : null;
  }
  const s = await getReportedSummary().catch(softFail("ReportedStepsNow.all", null));
  return s ? { steps: s.steps, cases: s.headline.cases } : null;
}

export async function ReportedStepsNow({ steps, place }: { steps: string; place?: string }) {
  const got = await stepsFor(place);
  const ids = steps.split(",").map((s) => s.trim()).filter(Boolean);
  const chosen = got ? ids.flatMap((id) => got.steps.find((s) => s.id === id) ?? []) : [];
  if (!got || chosen.length === 0) {
    return (
      <p className="my-6 text-base text-muted-foreground">
        The figures people reported can&apos;t be read right now. They&apos;re on the{" "}
        <Link href="/green-card-timelines" className="link font-bold">
          green card timelines
        </Link>{" "}
        page.
      </p>
    );
  }
  return (
    <figure className="not-prose my-8">
      <StepFigures steps={chosen} />{" "}
      <figcaption className="mt-3 text-sm text-muted-foreground">
        {`Self-reported, from ${formatInt(got.cases)} cases people shared in Telegram groups, community sheets, Reddit, VisaStats and on PERM Tracker, each person once. Each step counts the cases that finished it in its window, updated hourly.`}{" "}
        <Link href="/green-card-timelines" className="link">
          Every step, from every source
        </Link>
      </figcaption>
    </figure>
  );
}

/** One step's median, as words for a sentence: "155 days (the median of 157 cases decided in the last 6 months)". */
export async function ReportedMedianNow({ step, place }: { step: string; place?: string }) {
  const got = await stepsFor(place);
  const s = got?.steps.find((x) => x.id === step);
  // A step still short of cases reads as a span nobody can give yet, never as a number.
  if (!s || s.median === null) return <>{"some time (too few people have reported this step yet to measure it)"}</>;
  const days = `${formatInt(s.median)} ${s.median === 1 ? "day" : "days"}`;
  return <>{`${days} (the median of ${formatInt(s.n)} ${s.n === 1 ? "case" : "cases"} that finished it in ${windowText(s.windowDays)})`}</>;
}
