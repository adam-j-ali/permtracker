import "server-only";
import { cache } from "react";

import { parseSummary, type PlaceSummary, type ReportedSummary } from "../reportedSummary";
import { rows } from "./client";

/**
 * One stored summary of the reported cases (scripts/build_reported_cases.py writes `reported_summary` each hour):
 * "all", "office:<code>" or "post:<slug>". Null when the build hasn't made that one (an office with too few cases);
 * a failed read throws, so the page keeps its last good render.
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

export const getPostSummary = async (slug: string): Promise<PlaceSummary | null> =>
  parseSummary<PlaceSummary>(await read(`post:${slug}`));
