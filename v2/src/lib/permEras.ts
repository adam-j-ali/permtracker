/**
 * Where published PERM decisions live. `perm_cases` holds DOL's current files, from the first fiscal year below
 * (decisions from October 2023 on); `perm_cases_history` holds FY2008 to FY2023. A figure read from one table counts
 * only its years, so it says so: the current table's figures follow "filings" with `CURRENT_PERIOD`.
 */
export const CURRENT_FIRST_FY = 2024;

/** The current table's years, worded to follow "filings": "62% of their filings since FY2024". */
export const CURRENT_PERIOD = `since FY${CURRENT_FIRST_FY}`;
