/**
 * The public community sheets people keep their own I-485 cases in, as this site stores them
 * (scripts/ingest_community_sheets.py, table `community_case_reports`), and the figures drawn from them.
 *
 * A row is one person's case with its dates. The sheet's username and receipt-number columns never reach this site.
 * The dates are self-reported and anyone with the link can edit the sheet, so a page says whose sheet it is, when it
 * was read, and that nothing in it is checked.
 */
import config from "../../scripts/data/community_sheets.json";

import { MS_PER_DAY } from "@/lib/time";

export interface SheetCase {
  source: string;
  rowNo: number;
  category: string | null;
  visaAvailability: string | null;
  visaStatus: string | null;
  chargeability: string | null;
  country: string | null;
  priorityDate: string | null;
  /** A priority date the sheet writes in words ("Current"). */
  priorityNote: string | null;
  receiptDate: string | null;
  biometricsDate: string | null;
  transferDate: string | null;
  approvalDate: string | null;
  cardDate: string | null;
  validAsOf: string | null;
}

export interface CommunitySheet {
  key: string;
  name: string;
  /** USCIS's own code for the office the sheet follows. */
  office: string;
  /** The sheet's read-only view. */
  url: string;
  /** The day it was first shared, and where. */
  shared: string;
  sharedWhere: string;
}

export const SHEETS: readonly CommunitySheet[] = config.sheets.map((s) => ({
  key: s.key,
  name: s.name,
  office: s.office,
  url: `https://docs.google.com/spreadsheets/d/${s.sheet_id}/htmlview`,
  shared: s.shared,
  sharedWhere: s.shared_where,
}));

export const sheetFor = (key: string): CommunitySheet | undefined => SHEETS.find((s) => s.key === key);

export interface TransferCohort {
  transferDate: string;
  cases: number;
  approved: number;
  /** The median days from the move to the approval, from MEDIAN_FROM approvals that came after the move. */
  medianDays: number | null;
  /** Still waiting with a visa number available: the ones the thread worries about. */
  waitingAvailable: number;
}

/** A median from fewer approvals than this reads as one person's case, so none is given. */
export const MEDIAN_FROM = 3;

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / MS_PER_DAY);

function median(xs: number[]): number | null {
  if (xs.length < MEDIAN_FROM) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Every transfer day the sheet names, newest first. A case without a transfer day isn't in any. */
export function transferCohorts(rows: readonly SheetCase[]): TransferCohort[] {
  const by = new Map<string, SheetCase[]>();
  for (const r of rows) {
    if (!r.transferDate) continue;
    const list = by.get(r.transferDate) ?? [];
    list.push(r);
    by.set(r.transferDate, list);
  }
  return [...by.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([transferDate, list]) => {
      const approved = list.filter((r) => r.approvalDate);
      const after = approved.filter((r) => r.approvalDate! >= transferDate).map((r) => days(transferDate, r.approvalDate!));
      return {
        transferDate,
        cases: list.length,
        approved: approved.length,
        medianDays: median(after),
        waitingAvailable: list.filter((r) => !r.approvalDate && r.visaAvailability === "Visa available").length,
      };
    });
}
