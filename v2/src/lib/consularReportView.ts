/**
 * Each consulate's "What people report", as the server's hourly build works it out (scripts/lib_reported_summary.py
 * report_view) and stores it in `reported_summary` ("reports:<slug>", "reports:all", "reports:_none"). The build
 * counts every figure and holds each one to the three-report floor; this module only puts the form's own words and
 * order (convex/lib/consularReport.ts) on the ids it stored, and counts nothing.
 */

import {
  CANCELLED_BY,
  HOLD_REASONS,
  REPORT_CATEGORIES,
  REPORT_OUTCOMES,
  linesFor,
  type ReportCategoryId,
} from "@/lib/consularReport";

export interface ReportCount {
  id: string;
  label: string;
  count: number;
}
export interface ReportWindow {
  days: number;
  /** Every report the window holds: a number of reports says nothing about anyone. */
  total: number;
  /** The breakdown shows only from the floor. */
  open: boolean;
  byOutcome: ReportCount[];
}
/**
 * After the interview or drop box: how many finished and how many still wait. The pair comes from the floor, and the
 * median only from the floor of finished, so a median of the finished never shows without the count still waiting.
 */
export interface AfterView {
  finished: number | null;
  waiting: number | null;
  median: number | null;
}
export interface ReportCategoryCell {
  id: ReportCategoryId;
  label: string;
  /** Reports in the last 90 days; null under the floor. */
  count: number | null;
  open: boolean;
  byOutcome: ReportCount[];
  /** The exact categories reported (EB-2, F2A...), when the cell is open and anyone gave one. */
  byLine: ReportCount[];
  /** The NVC-to-interview median for this kind of visa; null under the floor. */
  waitMedian: number | null;
  after: AfterView;
}
export interface ReportWeek {
  /** The Monday the week starts. */
  start: string;
  /** Interviews held that week; null under the floor. */
  count: number | null;
  /** The week holds today, so it's still filling. */
  partial: boolean;
}
export interface ReportView {
  today: string;
  total: number;
  /** The fewest reports a figure needs. */
  floor: number;
  windows: ReportWindow[];
  categories: ReportCategoryCell[];
  weeks: ReportWeek[];
  /** Interviews with a result, and how many were a 221(g); null under the floor. */
  results: { days: number; n: number | null; g221: number | null; share: number | null; holdReasons: ReportCount[] };
  /** Interviews cancelled or moved, and who did it among the reports that say; empty under the floor. */
  moved: { days: number; n: number | null; byWho: ReportCount[] };
  /** NVC's month to the interview, over interviews held in the window; null under the floor. */
  wait: { days: number; n: number | null; median: number | null };
}

/** The consulates with the most reports in the last 30 days, each from the floor (the index page's panel). */
export interface BusiestPost {
  post: string;
  reports30: number;
  results: number | null;
  g221: number | null;
}

type Counts = Readonly<Record<string, number>>;

/** What the build stores: counts keyed by the form's ids, and a cell only for a kind of visa someone reported. */
export interface StoredReportView {
  today: string;
  total: number;
  floor: number;
  windows: { days: number; total: number; open: boolean; byOutcome: Counts }[];
  categories: Readonly<Record<string, Omit<ReportCategoryCell, "id" | "label" | "byOutcome" | "byLine"> & { byOutcome: Counts; byLine: Counts }>>;
  weeks: ReportWeek[];
  results: Omit<ReportView["results"], "holdReasons"> & { holdReasons: Counts };
  moved: Omit<ReportView["moved"], "byWho"> & { byWho: Counts };
  wait: ReportView["wait"];
  busiest?: BusiestPost[];
}

/** Counts in a list's order with its words, leaving out answers nobody gave. */
function labelled(counts: Counts, list: readonly { id: string; label: string }[]): ReportCount[] {
  return list.flatMap((x) => {
    const n = counts[x.id];
    return n ? [{ id: x.id, label: x.label, count: n }] : [];
  });
}

const NOBODY: Omit<ReportCategoryCell, "id" | "label"> = {
  count: null,
  open: false,
  byOutcome: [],
  byLine: [],
  waitMedian: null,
  after: { finished: null, waiting: null, median: null },
};

/** A stored view with the form's words on it: every kind of visa in the form's order, one nobody reported empty. */
export function reportView(s: StoredReportView): ReportView {
  return {
    today: s.today,
    total: s.total,
    floor: s.floor,
    windows: s.windows.map((w) => ({ ...w, byOutcome: labelled(w.byOutcome, REPORT_OUTCOMES) })),
    categories: REPORT_CATEGORIES.map((c) => {
      const cell = s.categories[c.id];
      return cell
        ? { ...cell, id: c.id, label: c.label, byOutcome: labelled(cell.byOutcome, REPORT_OUTCOMES), byLine: labelled(cell.byLine, linesFor(c.id)) }
        : { ...NOBODY, id: c.id, label: c.label };
    }),
    weeks: s.weeks,
    results: { ...s.results, holdReasons: labelled(s.results.holdReasons, HOLD_REASONS) },
    moved: { ...s.moved, byWho: labelled(s.moved.byWho, CANCELLED_BY) },
    wait: s.wait,
  };
}

/** A stored body, parsed and checked for the parts every page reads; null when it isn't one. */
export function parseReportView(body: string | null | undefined): StoredReportView | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as StoredReportView;
    return typeof v?.today === "string" && Array.isArray(v.windows) && Array.isArray(v.weeks) && typeof v.categories === "object" && v.categories !== null
      ? v
      : null;
  } catch {
    return null;
  }
}
