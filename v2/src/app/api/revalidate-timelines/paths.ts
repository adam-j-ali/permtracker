/**
 * Every page that reads the shared timelines' board (`communityTimelines.board`). A sibling module: a route file
 * may export only handlers. An office's own page reads `communityTimelines.office` and is refreshed by its code.
 */
export const TIMELINE_PAGES: readonly string[] = ["/green-card-timelines", "/perm-processing-times"];

/** The family each USCIS office's page lives under. */
export const OFFICE_PAGES = "/i485-by-field-office";

/** The most offices one call may name; a decision touches one, an edit that changes the office two. */
export const MAX_OFFICES = 10;
