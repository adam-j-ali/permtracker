/**
 * Every page that reads the shared timelines' board (`communityTimelines.board`). A sibling module: a route file
 * may export only handlers. An office's own page reads `communityTimelines.office` and is refreshed by its code.
 */
export const TIMELINE_PAGES: readonly string[] = ["/green-card-timelines"];

/**
 * The other pages that read the merged list of reported cases (`src/lib/db/communityReports.ts`), refreshed with the
 * board's whenever the list changes: the I-140 form page shows the I-140s people reported. The timelines page reads
 * the list too, and is already among the board's pages.
 */
export const LIST_PAGES: readonly string[] = [
  "/uscis-processing-times/i-140",
  // The pages that draw the reported cases' summary (scripts/lib_reported_summary.py), which moves every day.
  "/uscis-processing-times/i-485",
  "/uscis-processing-times/i-765",
  "/uscis-processing-times/i-131",
  "/uscis-processing-times/i-129",
  "/consular-posts",
  "/perm-processing-times",
];

/** Every fixed page a valid call refreshes. */
export const FIXED_PAGES: readonly string[] = [...TIMELINE_PAGES, ...LIST_PAGES];

/** The family each USCIS office's page lives under. */
export const OFFICE_PAGES = "/i485-by-field-office";

/** The most offices one call may name; a decision touches one, an edit that changes the office two. */
// The summary's windows move every day, so one hourly build can move every office's and every consulate's figures.
export const MAX_OFFICES = 120;

export const POST_PAGES = "/consular-posts";

export const MAX_POSTS = 200;
