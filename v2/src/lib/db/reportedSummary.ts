import "server-only";
import { cache } from "react";

import { parseReportView, reportView, type BusiestPost, type ReportView } from "../consularReportView";
import { parseSummary, type PlaceSummary, type ReportedSummary } from "../reportedSummary";
import { rows } from "./client";

/**
 * One stored summary of the reported cases (scripts/build_reported_cases.py writes `reported_summary` each hour):
 * "all", "office:<code>", "post:<slug>" or a consulate's reports ("reports:..."). Null when the build hasn't made that
 * one (an office with too few cases); a failed read throws, so the page keeps its last good render.
 */
const read = cache(async (key: string): Promise<string | null> => {
  try {
    const got = await rows<{ body: string }>("SELECT body FROM reported_summary WHERE key = ?", [key]);
    return got[0]?.body ?? null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
});

export const getReportedSummary = async (): Promise<ReportedSummary | null> => parseSummary<ReportedSummary>(await read("all"));

export const getOfficeSummary = async (code: string): Promise<PlaceSummary | null> =>
  parseSummary<PlaceSummary>(await read(`office:${code}`));

/** One office's family-based cases, kept apart from its employment-based ones (the build's "office-family:<code>"). */
export const getOfficeFamilySummary = async (code: string): Promise<PlaceSummary | null> =>
  parseSummary<PlaceSummary>(await read(`office-family:${code}`));

export const getPostSummary = async (slug: string): Promise<PlaceSummary | null> =>
  parseSummary<PlaceSummary>(await read(`post:${slug}`));

/**
 * One consulate's "What people report" (the build's "reports:<slug>"), or the figures for a consulate nobody has
 * reported yet ("reports:_none"). Null when the build hasn't made them yet: the page says they can't be read.
 */
export async function getPostReports(slug: string): Promise<ReportView | null> {
  const stored = parseReportView((await read(`reports:${slug}`)) ?? (await read("reports:_none")));
  return stored ? reportView(stored) : null;
}

/** Every consulate's reports together, and the busiest consulates (the build's "reports:all"); null before it's made. */
export async function getEveryPostReports(): Promise<{ all: ReportView; busiest: BusiestPost[] } | null> {
  const stored = parseReportView(await read("reports:all"));
  return stored ? { all: reportView(stored), busiest: stored.busiest ?? [] } : null;
}
