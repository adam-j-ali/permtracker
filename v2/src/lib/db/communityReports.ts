import "server-only";
import { cache } from "react";

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
