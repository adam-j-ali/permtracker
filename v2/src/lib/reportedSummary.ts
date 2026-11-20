/**
 * The figures over every case people reported, from every source together (the merged list), as the hourly build
 * works them out (scripts/lib_reported_summary.py) and stores them in `reported_summary`: one for all the data, one
 * for each USCIS office and each consulate with enough cases. Pages read a summary and draw it; nothing here counts.
 *
 * A step's figure covers the cases that finished it in its window (the last 6 months, or 12 when 6 hold too few), so
 * past years never outvote this one. Self-reported and unchecked, apart from the timelines the owner reviewed.
 */

export type StepGroup = "h1b" | "pwd" | "perm" | "i140" | "i485" | "consular";

export interface StepMonth {
  /** "2026-11". */
  month: string;
  n: number;
  /** Null when the month holds fewer than the floor: a gap, never a zero. */
  median: number | null;
}

export interface StepFigure {
  id: string;
  label: string;
  group: StepGroup;
  verified: boolean;
  /** The cases behind the figure (in its window), or, with no window, the cases of the last 12 months. */
  n: number;
  /** 183 or 365; null when even 12 months hold too few for a figure. */
  windowDays: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** The 6 months before the last 6, when both hold enough cases: the way the step is moving. */
  before: { median: number; n: number } | null;
  /** Every case ever reported for the step, any year. */
  allTime: number;
  months: StepMonth[];
}

export interface WaitingSummary {
  open: boolean;
  heardDays: number;
  heard: number;
  byStage: { id: string; label: string; count: number }[];
  lines: { category: string; country: string; counts: (number | null)[]; total: number }[];
  unlisted: number;
}

export interface I140Summary {
  category: string;
  premium: "with filing" | "after filing" | "yes" | "none" | "not given";
  reported: number;
  decidedAllTime: number;
  windowDays: number;
  decided: number;
  approvedShare: number | null;
  medianDays: number | null;
  rfeShare: number | null;
}

export interface ReportedSummary {
  today: string;
  headline: { cases: number; heard: number; heardDays: number; greenCards30: number; i140s30: number; perm30: number };
  /** The week's approvals, the board's shape (RecentApprovals): null counts are under 5. Absent before Nov 20 2026. */
  week?: { from: string; through: string; steps: { id: string; label: string; count: number | null }[] };
  steps: StepFigure[];
  waiting: WaitingSummary;
  i140: I140Summary[];
}

export interface PlaceSummary {
  today: string;
  cases: number;
  steps: StepFigure[];
  waiting?: WaitingSummary;
}

/** "the last 6 months" or "the last 12 months". */
export function windowText(days: number | null): string {
  return days !== null && days > 200 ? "the last 12 months" : "the last 6 months";
}

/** The steps of one group, in the journey's order. */
export const stepsIn = (steps: readonly StepFigure[], ...groups: StepGroup[]): StepFigure[] =>
  steps.filter((s) => groups.includes(s.group));

/**
 * Which way a step moved against the 6 months before, as the figure row's trend chip reads it ("15 days slower"; the
 * card or the note beside it names the 6 months before): fewer days is down and good for the person waiting, more is
 * up and bad. Null without both halves.
 */
export function stepTrend(
  s: Pick<StepFigure, "median" | "before">,
): { text: string; dir: "up" | "down" | "level"; tone: "good" | "bad" | "neutral" } | null {
  if (s.median === null || !s.before) return null;
  const d = s.median - s.before.median;
  if (d === 0) return { text: "No change", dir: "level", tone: "neutral" };
  const n = Math.abs(d);
  return {
    text: `${n.toLocaleString("en-US")} ${n === 1 ? "day" : "days"} ${d < 0 ? "faster" : "slower"}`,
    dir: d < 0 ? "down" : "up",
    tone: d < 0 ? "good" : "bad",
  };
}

/** A stored summary, parsed and checked for the parts every page reads; null when it isn't one. */
export function parseSummary<T extends { today: string; steps: StepFigure[] }>(body: string | null | undefined): T | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as T;
    return typeof v?.today === "string" && Array.isArray(v.steps) ? v : null;
  } catch {
    return null;
  }
}
