/**
 * The approval rate: one rule, two definitions (D4, Nov 25 2026). Each page names the one it prints.
 *
 * - Over DECISIONS: approved / (approved + denied). A withdrawal is neither, since nobody decided it. Employer, firm,
 *   group, state, job and wage pages, the rankings, the sponsor finder, the case page's employer card, the API and
 *   USCIS's form tables print this one, and every denial rate is its complement over the same decisions.
 * - Over every OUTCOME: certified / everything that ended, withdrawals included. DOL's disclosure totals read this way,
 *   so the homepage's line, the FAQ, the pulse and /rfi's comparison print it and say "withdrawals included".
 *
 * Fractions from 0 to 1: a page that prints a percent multiplies where it prints. Null when there's nothing to divide,
 * never 0, because an employer with nothing decided has no rate and 0% would sort it below a real 50%. Floors (how many
 * decisions a page needs before it prints a rate) stay with each page: they differ on purpose.
 */

/** approved / (approved + denied): the approval rate over decisions. DOL's "certified" is USCIS's "approved". */
export function approvedShareOfDecisions(approved: number, denied: number): number | null {
  return shareOf(approved, approved + denied);
}

/** denied / (approved + denied): the denial rate, over the same decisions as approvedShareOfDecisions. */
export function deniedShareOfDecisions(approved: number, denied: number): number | null {
  return shareOf(denied, approved + denied);
}

/** certified / every outcome (certified, denied and withdrawn together): the share DOL's totals print. */
export function certifiedShareOfOutcomes(certified: number, outcomes: number): number | null {
  return shareOf(certified, outcomes);
}

function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}
