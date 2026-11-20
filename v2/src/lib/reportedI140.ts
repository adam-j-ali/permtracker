/**
 * The names of the kinds of premium processing people report on an I-140, as the I-140 page's figures label them.
 * The figures themselves are the hourly build's (scripts/lib_reported_summary.py `i140_figures`), over the decisions of
 * the last 6 months, so no page works them out again.
 */

export type Premium = "with filing" | "after filing" | "yes" | "none" | "not given";

export const PREMIUM_LABELS: Record<Premium, string> = {
  "with filing": "Premium from filing",
  "after filing": "Premium added later",
  yes: "Premium, when not said",
  none: "No premium",
  "not given": "Premium not said",
};
