/**
 * The public community sheets people keep their own green card cases in (scripts/data/community_sheets.json), read hourly
 * by scripts/ingest_community_sheets.py. Their rows reach the pages through the merged list of reported cases
 * (src/lib/reportedCases.ts), with every other source's.
 *
 * The sheet's username and receipt-number columns never reach this site. The dates are self-reported and anyone with
 * the link can edit the sheet, so a page says whose sheet it is and that nothing in it is checked.
 */
import config from "../../scripts/data/community_sheets.json";

export interface CommunitySheet {
  key: string;
  name: string;
  /** USCIS's own code for the office the sheet follows; none for a sheet that follows every office. */
  office?: string;
  /** The sheet's read-only view. */
  url: string;
  /** The day it was first shared, when that day is known, and where it was found. */
  shared?: string;
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
