import "server-only";
import { cache } from "react";

import type { SheetCase } from "../communitySheets";
import { rows } from "./client";

type Row = Record<string, string | number | null>;

const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * Every case the community sheets hold for one USCIS office (`community_case_reports`, loaded hourly by
 * scripts/ingest_community_sheets.py), in the sheet's own order. Before the first load the table isn't there, which is
 * the one answer read as "no cases"; any other failure throws, and the page names what it couldn't read.
 */
export const getOfficeSheetCases = cache(async (office: string): Promise<SheetCase[]> => {
  let got: Row[];
  try {
    got = await rows<Row>(
      "SELECT source, row_no, category, visa_availability, visa_status, chargeability, country, priority_date, " +
        "priority_note, receipt_date, biometrics_date, transfer_date, approval_date, card_date, valid_as_of " +
        "FROM community_case_reports WHERE office = ? ORDER BY source, row_no",
      [office],
    );
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
  return got.map((r) => ({
    source: String(r.source),
    rowNo: Number(r.row_no),
    category: text(r.category),
    visaAvailability: text(r.visa_availability),
    visaStatus: text(r.visa_status),
    chargeability: text(r.chargeability),
    country: text(r.country),
    priorityDate: text(r.priority_date),
    priorityNote: text(r.priority_note),
    receiptDate: text(r.receipt_date),
    biometricsDate: text(r.biometrics_date),
    transferDate: text(r.transfer_date),
    approvalDate: text(r.approval_date),
    cardDate: text(r.card_date),
    validAsOf: text(r.valid_as_of),
  }));
});

/** When the newest sheet load for an office finished, epoch ms, or null before the first. */
export const getSheetsReadAt = cache(async (): Promise<number | null> => {
  try {
    const got = await rows<{ at: number | string | null }>("SELECT max(fetched_at) AS at FROM community_case_reports");
    const at = Number(got[0]?.at);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
});
