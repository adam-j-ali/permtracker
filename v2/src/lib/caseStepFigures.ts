/**
 * The three kinds of figure behind the green card tab's per-step estimates (src/lib/caseStepEstimates.ts), built from
 * what the public pages read: USCIS's posted times (getUscisPosted), our receipt sample by the month USCIS received
 * each case (getSampleMonths) and the cases people reported (getReportedSummary). /api/step-estimates serves them.
 *
 * Aggregates only: shares and counts by month, posted months, medians. A source that couldn't be read, or holds
 * nothing for a step, is null for that step, never an empty figure.
 */

import type { EstimateStep, StepFigureSet, StepFiguresPayload } from "@/lib/caseStepEstimates";
import type { ReportedSummary } from "@/lib/reportedSummary";
import { isCurrent, postedByCategory, waitPapers, type UscisPosted } from "@/lib/uscisPosted";
import { monthRows, type SampleMonthsDoc } from "@/lib/uscisSample";

/** The sample's form for each step. The I-765 counts every work permit category: the sample doesn't tell them apart. */
const SAMPLE_FORM: Record<EstimateStep, string> = { i485: "I-485", ead: "I-765" };

/** The reported step each one reads (scripts/lib_reported_summary.py STEPS). */
const REPORTED_STEP: Record<EstimateStep, string> = { i485: "i485-gc", ead: "i485-ead" };

/** How many receipt months to send: enough for a case filed two years ago to find its own. */
const MONTHS_SENT = 24;

function official(step: EstimateStep, posted: UscisPosted | null, today: string): StepFigureSet["official"] {
  if (!posted || !isCurrent(posted, today)) return null;
  if (step === "ead") {
    const ead = waitPapers(posted)?.ead;
    return ead ? { min: ead.months, max: ead.months, postedOn: posted.published, where: ead.office } : null;
  }
  const employment = postedByCategory(posted, "I-485").find((c) => /employment-based/i.test(c.label));
  if (!employment || employment.min === null || employment.max === null) return null;
  return { min: employment.min, max: employment.max, postedOn: posted.published, where: "field offices" };
}

function measured(step: EstimateStep, sample: SampleMonthsDoc | null): StepFigureSet["measured"] {
  if (!sample) return null;
  // The month the sample is dated in is still filling: its share reads low, so it's left out, as on the form pages.
  const filling = sample.as_of.slice(0, 7);
  const months = monthRows(sample, SAMPLE_FORM[step])
    .filter((r) => r.month < filling && r.counted > 0)
    .slice(0, MONTHS_SENT)
    .map((r) => ({ month: r.month, counted: r.counted, share: r.approved.share, low: r.approved.low, high: r.approved.high }));
  return months.length ? { asOf: sample.as_of, months } : null;
}

function community(step: EstimateStep, summary: ReportedSummary | null): StepFigureSet["community"] {
  const s = summary?.steps.find((x) => x.id === REPORTED_STEP[step]);
  return s ? { median: s.median, p25: s.p25, p75: s.p75, n: s.n, windowDays: s.windowDays } : null;
}

export function buildStepFigures(input: {
  posted: UscisPosted | null;
  sample: SampleMonthsDoc | null;
  summary: ReportedSummary | null;
  today: string;
  unreadable?: StepFiguresPayload["unreadable"];
}): StepFiguresPayload {
  const set = (step: EstimateStep): StepFigureSet => ({
    official: official(step, input.posted, input.today),
    measured: measured(step, input.sample),
    community: community(step, input.summary),
  });
  return { steps: { i485: set("i485"), ead: set("ead") }, unreadable: input.unreadable ?? [] };
}
