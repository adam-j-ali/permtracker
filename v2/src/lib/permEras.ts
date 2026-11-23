/**
 * Where published PERM decisions live. `perm_cases` holds DOL's current files, from the first fiscal year below
 * (decisions from October 2023 on); `perm_cases_history` holds DOL's older files, FY2008 to FY2023. A figure read
 * from one table counts only its years, so it says so: the current table's figures follow "filings" with
 * `CURRENT_PERIOD`, and the older table's name their own first and last year (`fySpan`).
 */
export const CURRENT_FIRST_FY = 2024;

/** The oldest fiscal year `perm_cases_history` holds: DOL's first PERM disclosure file. */
export const HISTORY_FIRST_FY = 2008;

/** The current table's years, worded to follow "filings": "62% of their filings since FY2024". */
export const CURRENT_PERIOD = `since FY${CURRENT_FIRST_FY}`;

/** The same years as a choice or a label of their own: "Since FY2024". */
export const CURRENT_SINCE = `Since FY${CURRENT_FIRST_FY}`;

/** "FY2012 to FY2023", or "FY2019" for one year. */
export function fySpan(from: number, to: number): string {
  return from === to ? `FY${from}` : `FY${from} to FY${to}`;
}

/** The older table's whole span, "FY2008 to FY2023", for a figure that isn't one entity's. */
export const HISTORY_SPAN = fySpan(HISTORY_FIRST_FY, CURRENT_FIRST_FY - 1);
