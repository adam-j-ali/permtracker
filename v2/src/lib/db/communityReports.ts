import "server-only";
import { cache } from "react";

import { fromI140Row, type I140Case } from "../reportedI140";
import { fromRow, type ReportedCase } from "../reportedCases";
import { rows } from "./client";

type Row = Record<string, string | number | null>;

/**
 * Every case people reported for one USCIS office, merged across sources (`reported_cases`, built hourly by
 * scripts/build_reported_cases.py), newest transfer first. A case that adds nothing to a possible repeat and a case
 * no shown source holds never come back. Before the first build the table isn't there, which is the one answer read as
 * "no cases"; any other failure throws, and the page names what it couldn't read.
 */
export const getOfficeReportedCases = cache(async (office: string): Promise<ReportedCase[]> => {
  let got: Row[];
  try {
    got = await rows<Row>(
      "SELECT case_id, source_names, possible_dupes, category, chargeability, priority_date, priority_note, " +
        "i485_receipt, biometrics, transfer, i485_decision, i485_decided, card, visa_available, nonimmigrant_status, " +
        "as_of FROM reported_cases WHERE office = ? AND shows = 1 AND adds_nothing = 0 " +
        // The office pages are about employment-based I-485s: a family case people reported there stays in the list.
        "AND (category IS NULL OR category <> 'Family') " +
        "ORDER BY transfer IS NULL, transfer DESC, i485_receipt DESC, case_id",
      [office],
    );
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
  return got.map(fromRow);
});

/** When the reported-cases list was last built, epoch ms, or null before the first build. */
export const getReportedCasesBuiltAt = cache(async (): Promise<number | null> => {
  try {
    const got = await rows<{ at: number | string | null }>("SELECT max(built_at) AS at FROM reported_cases");
    const at = Number(got[0]?.at);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
});

/**
 * Every I-140 people reported, merged across sources: the cases with an I-140 date or decision. A case that adds
 * nothing to a possible repeat, or that no shown source holds, never comes back. Empty before the first build.
 */
export const getReportedI140Cases = cache(async (): Promise<I140Case[]> => {
  let got: Row[];
  try {
    got = await rows<Row>(
      "SELECT category, premium, i140_receipt, priority_date, i140_decision, i140_decided, i140_rfe FROM reported_cases " +
        "WHERE shows = 1 AND adds_nothing = 0 AND (i140_decision IS NOT NULL OR i140_receipt IS NOT NULL)",
    );
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
  return got.map(fromI140Row);
});

export interface ReportedOverview {
  /** Cases shown, each person once. */
  people: number;
  /** Of those, the ones more than one source reported. */
  inSeveral: number;
  bySource: { source: string; cases: number }[];
  /** Employment-based I-485s by USCIS office, the most reported first. */
  offices: { office: string; cases: number }[];
  i140s: number;
}

const SHOWN = "shows = 1 AND adds_nothing = 0";

/** The whole merged list at a glance, for the timelines page. Null before the first build. */
export const getReportedOverview = cache(async (): Promise<ReportedOverview | null> => {
  try {
    const [totals, sources, offices] = await Promise.all([
      rows<Row>(
        `SELECT count(*) AS people, sum(CASE WHEN json_array_length(source_names) > 1 THEN 1 ELSE 0 END) AS several, ` +
          `sum(CASE WHEN i140_decision IS NOT NULL OR i140_receipt IS NOT NULL THEN 1 ELSE 0 END) AS i140s ` +
          `FROM reported_cases WHERE ${SHOWN}`,
      ),
      rows<Row>(
        `SELECT j.value AS source, count(*) AS cases FROM reported_cases, json_each(reported_cases.source_names) j ` +
          `WHERE ${SHOWN} GROUP BY j.value ORDER BY cases DESC, source`,
      ),
      rows<Row>(
        `SELECT office, count(*) AS cases FROM reported_cases WHERE ${SHOWN} AND office IS NOT NULL ` +
          `AND (category IS NULL OR category <> 'Family') GROUP BY office ORDER BY cases DESC, office`,
      ),
    ]);
    const t = totals[0];
    return {
      people: Number(t?.people ?? 0),
      inSeveral: Number(t?.several ?? 0),
      i140s: Number(t?.i140s ?? 0),
      bySource: sources.map((r) => ({ source: String(r.source), cases: Number(r.cases) })),
      offices: offices.map((r) => ({ office: String(r.office), cases: Number(r.cases) })),
    };
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
});
