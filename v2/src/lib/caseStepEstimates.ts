/**
 * The green card tab's per-step estimates for the I-485 and the work permit: three kinds of figure, each named, read
 * against the case's own dates in the browser.
 *
 * - The agency: USCIS's posted processing time, within which it decided 8 cases in 10.
 * - Our count: the share approved so far of the online cases USCIS received in the case's own month, from the receipt
 *   numbers we check on USCIS's Case Status page, with its 95% margin.
 * - People's reports: how long the cases people reported took, the median and the middle half.
 *
 * The figures come from /api/step-estimates (src/lib/caseStepFigures.ts builds them from the readers the public pages
 * use), which takes no case data: the case's dates never leave the page. Pure, so the tests read it directly.
 */

import { addDays, format, parseISO } from "date-fns";

import { MONTH_NAMES } from "@convex/lib/months";
import { formatAsOf } from "@/lib/dolFormat";
import { formatInt } from "@/lib/format";
import { windowText } from "@/lib/reportedSummary";
import { SOURCE_VIEWS } from "@/lib/sourceView";
import type { SourceKind } from "@/lib/sourceKind";

export type EstimateStep = "i485" | "ead";

export interface OfficialTime {
  /** USCIS's posted months, the shortest and the longest across the offices it posts the step under. */
  min: number;
  max: number;
  postedOn: string;
  /** Where USCIS posts it: "field offices", or one office's name. */
  where: string;
}

export interface SampleMonthFigure {
  /** "2026-08": the month USCIS received the cases. */
  month: string;
  counted: number;
  share: number;
  low: number;
  high: number;
}

export interface ReportedStep {
  median: number | null;
  p25: number | null;
  p75: number | null;
  n: number;
  windowDays: number | null;
}

export interface StepFigureSet {
  official: OfficialTime | null;
  measured: { asOf: string; months: SampleMonthFigure[] } | null;
  community: ReportedStep | null;
}

export interface StepFiguresPayload {
  steps: Record<EstimateStep, StepFigureSet>;
  /** The sources that couldn't be read just now. */
  unreadable: ("posted" | "sample" | "reported")[];
}

/** Each kind's name, as the site's sources switch says it (src/lib/sourceView.ts). */
export const KIND_LABELS = Object.fromEntries(
  SOURCE_VIEWS.flatMap((v) => (v.kind ? [[v.kind, v.label]] : [])),
) as Record<SourceKind, string>;

/** The case's dates these read. */
export interface EstimateCaseDates {
  i485FilingDate?: string | null;
  i485ReceiptDate?: string | null;
  i485ApprovalDate?: string | null;
  i485DenialDate?: string | null;
  eadFilingDate?: string | null;
  eadApprovalDate?: string | null;
  cardProducedDate?: string | null;
  cardReceivedDate?: string | null;
}

export interface StepEstimate {
  kind: SourceKind;
  label: string;
  value: string;
  note: string;
}

const DAYS_PER_MONTH = 30.44;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const day = (d: string | null | undefined): string | null => (d && ISO.test(d) ? d : null);
const plusDays = (iso: string, n: number) => format(addDays(parseISO(iso), Math.round(n)), "yyyy-MM-dd");
const shown = (iso: string) => format(parseISO(iso), "MMM d, yyyy");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const monthWords = (m: string) => `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

/** What each step is called in a sentence, by kind. */
const WORDS: Record<EstimateStep, { posted: string; sample: string; reported: string; done: string }> = {
  i485: {
    posted: "employment-based I-485s",
    sample: "online I-485s",
    reported: "from filing to approval",
    done: "approved",
  },
  ead: {
    posted: "a work permit based on a pending I-485 (category (c)(9))",
    sample: "online work permit applications (I-765, every category)",
    reported: "from the I-485's filing to the work permit",
    done: "in hand",
  },
};

/**
 * The step's own dates: when it was filed (the sample's month and the posted clock start there), when the people's
 * median starts (the I-485's filing for both steps, the way people report them), and whether it's decided, which drops
 * the case's own reading.
 */
function caseClock(step: EstimateStep, c: EstimateCaseDates) {
  const i485Filed = day(c.i485FilingDate) ?? day(c.i485ReceiptDate);
  if (step === "i485") {
    const decided = Boolean(c.i485ApprovalDate || c.i485DenialDate || c.cardProducedDate || c.cardReceivedDate);
    return { filed: i485Filed, reportedFrom: i485Filed, decided };
  }
  return { filed: day(c.eadFilingDate), reportedFrom: i485Filed, decided: Boolean(c.eadApprovalDate) };
}

const UNAVAILABLE = (kind: SourceKind, what: string): StepEstimate => ({
  kind,
  label: KIND_LABELS[kind],
  value: "Not available",
  note: `${what} can't be read just now.`,
});

/** The step's three figures, the agency's first, each read against the case's own dates while the step is pending. */
export function stepEstimates(step: EstimateStep, figures: StepFiguresPayload, c: EstimateCaseDates): StepEstimate[] {
  const set = figures.steps[step];
  const words = WORDS[step];
  const { filed, reportedFrom, decided } = caseClock(step, c);
  const out: StepEstimate[] = [];

  const o = set.official;
  if (!o) {
    out.push(UNAVAILABLE("official", "USCIS's posted time"));
  } else {
    const value = o.min === o.max ? months(o.min) : `${o.min} to ${o.max} months`;
    const from = filed && !decided ? plusDays(filed, o.min * DAYS_PER_MONTH) : null;
    const to = filed && !decided ? plusDays(filed, o.max * DAYS_PER_MONTH) : null;
    const yours = from && to ? ` Counted from your filing on ${shown(filed!)}, that's ${from === to ? shown(from) : `${shown(from)} to ${shown(to)}`}.` : "";
    out.push({
      kind: "official",
      label: KIND_LABELS.official,
      value,
      note: `USCIS's posted time for ${words.posted} at ${o.where === "field offices" ? "its field offices" : `the ${o.where}`}, within which it decided 8 cases in 10. Posted ${formatAsOf(o.postedOn) ?? o.postedOn}.${yours}`,
    });
  }

  const m = set.measured;
  if (!m || m.months.length === 0) {
    out.push(UNAVAILABLE("measured", "Our count of the receipts we check"));
  } else {
    const own = filed ? m.months.find((x) => x.month === filed.slice(0, 7)) : undefined;
    const row = own ?? m.months[0]!;
    out.push({
      kind: "measured",
      label: KIND_LABELS.measured,
      value: pct(row.share),
      note: `Of the ${words.sample} USCIS received in ${monthWords(row.month)}${own ? ", the month yours was" : ""}, approved so far. Margin ${pct(row.low)} to ${pct(row.high)}, from ${formatInt(row.counted)} ${row.counted === 1 ? "case" : "cases"} checked, as of ${formatAsOf(m.asOf) ?? m.asOf}.`,
    });
  }

  const r = set.community;
  if (!r) {
    out.push(UNAVAILABLE("community", "The cases people reported"));
  } else if (r.median === null || r.p25 === null || r.p75 === null) {
    out.push({
      kind: "community",
      label: KIND_LABELS.community,
      value: "Too few yet",
      note: `${formatInt(r.n)} ${r.n === 1 ? "case" : "cases"} reported in the last 12 months. A figure needs 5.`,
    });
  } else {
    const yours = reportedFrom && !decided ? ` At the median, yours would be ${words.done} around ${shown(plusDays(reportedFrom, r.median))}.` : "";
    out.push({
      kind: "community",
      label: KIND_LABELS.community,
      value: `${formatInt(r.median)} days`,
      note: `How long the cases people reported took ${words.reported}: the middle half ${formatInt(r.p25)} to ${formatInt(r.p75)} days, ${formatInt(r.n)} cases finished in ${windowText(r.windowDays)}.${yours}`,
    });
  }

  return out;
}
