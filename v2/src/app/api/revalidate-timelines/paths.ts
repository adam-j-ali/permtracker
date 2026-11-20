/**
 * Every page that reads the shared timelines' board (`communityTimelines.board`). A sibling module: a route file
 * may export only handlers. An office's own page reads `communityTimelines.office` and is refreshed by its code.
 */
export const TIMELINE_PAGES: readonly string[] = ["/green-card-timelines", "/perm-processing-times"];

/**
 * The other pages that read the merged list of reported cases (`src/lib/db/communityReports.ts`), refreshed with the
 * board's whenever the list changes: the I-140 form page shows the I-140s people reported. The timelines page reads
 * the list too, and is already among the board's pages.
 */
export const LIST_PAGES: readonly string[] = ["/uscis-processing-times/i-140"];

/** Every fixed page a valid call refreshes. */
export const FIXED_PAGES: readonly string[] = [...TIMELINE_PAGES, ...LIST_PAGES];

/** The family each USCIS office's page lives under. */
export const OFFICE_PAGES = "/i485-by-field-office";

/** The most offices one call may name; a decision touches one, an edit that changes the office two. */
export const MAX_OFFICES = 10;
