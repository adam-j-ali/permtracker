/**
 * Which of an employer's same-title wage requests a PERM case rests on (N24-W, Nov 24 2026).
 *
 * DOL's published PERM file names the wage request (pwd_number) once a case is decided; DOL's live record of a pending
 * case doesn't. Until then the case page lists the employer's PERM wage requests for the same job title (lib/db/
 * employerWageRequests.ts reads them). This narrows that list by every rule we know, then ranks what's left:
 *
 *   - a wage decided after the case was filed can't be it: a 9089 is filed on a wage already issued;
 *   - a wage that expired more than RECRUITMENT_SLACK_DAYS before filing can't be it: 20 CFR 656.40(c) lets the
 *     employer file or BEGIN recruitment inside the validity period, and recruitment runs at most 180 days before
 *     filing (the ETA 9089 window), so a filing later than that has nothing inside the validity left to stand on;
 *   - the rest rank first by how many other published PERM cases used the request shortly before this one was filed
 *     (NAMED_RECENT_DAYS), then by how many used it at all, then by how close their determination-to-filing gap is to
 *     TYPICAL_GAP_DAYS. Employers reuse one wage request for several workers in the same job: on Nov 24 2026 the
 *     backtest found the first version's rule ("another case names it, so it's taken") threw out the case's own
 *     request in 22,949 of 339,604 decided cases, and that reuse is the strongest sign of the one in use.
 *
 * Whether the top one may be called "most likely" is MOST_LIKELY: the backtest on decided cases, where the truth is
 * known (scripts/backtest_wage_links.ts), measures how often the top-ranked candidate is the named one, by how many
 * candidates were left; the label is shown only where that clears the stated rate.
 *
 * Plain module, no reads: the site's case page and the backtest run this one rule.
 */
import { calculatePWDExpiration } from "@convex/lib/perm";
import { daysBetweenOrNull } from "@convex/lib/time";

/** The median days from a wage determination to the PERM filed on it, measured on decided cases (the backtest). */
export const TYPICAL_GAP_DAYS = 165; // 339,604 decided cases, Nov 24 2026: middle half 111 to 222 days
/** A use by another case within this many days before the filing counts as recent. */
export const NAMED_RECENT_DAYS = 120;
/** How long before filing recruitment may have begun inside a wage's validity (the ETA 9089 recruitment window). */
export const RECRUITMENT_SLACK_DAYS = 180;

export interface WageCandidate {
  caseNumber: string;
  /** When DOL received the request. */
  received: string | null;
  /** When DOL issued the wage (its determination day); null when not known yet. */
  decided: string | null;
  /** How many other published PERM cases name this request, decided before this case was filed. */
  namedCount: number;
  /** Of those, how many were decided within NAMED_RECENT_DAYS before the filing. */
  namedRecent: number;
}

export interface RankedCandidate extends WageCandidate {
  /** Days from the determination to the PERM's filing; null when the determination day isn't known. */
  gapDays: number | null;
}

export interface NarrowedCandidates {
  kept: RankedCandidate[];
  dropped: { caseNumber: string; why: string }[];
}

/** namedCount and namedRecent from the decision days of the other cases that name a request: only those decided
 *  before the filing count (what was known while the case was pending). */
export function usesBefore(days: readonly string[] | undefined, filed: string): { namedCount: number; namedRecent: number } {
  const on = filed.slice(0, 10);
  let namedCount = 0;
  let namedRecent = 0;
  for (const d of days ?? []) {
    const since = daysBetweenOrNull(d.slice(0, 10), on);
    if (since === null || since <= 0) continue;
    namedCount += 1;
    if (since <= NAMED_RECENT_DAYS) namedRecent += 1;
  }
  return { namedCount, namedRecent };
}

function expiresOn(decided: string): string | null {
  try {
    return calculatePWDExpiration(decided.slice(0, 10));
  } catch {
    return null; // not a real day: the rule can't be applied, so it can't drop the candidate
  }
}

export function narrowWageCandidates(
  candidates: readonly WageCandidate[],
  perm: { caseNumber: string; filed: string },
): NarrowedCandidates {
  const filed = perm.filed.slice(0, 10);
  const kept: RankedCandidate[] = [];
  const dropped: NarrowedCandidates["dropped"] = [];
  for (const c of candidates) {
    const decided = c.decided ? c.decided.slice(0, 10) : null;
    const gap = daysBetweenOrNull(decided, filed);
    if (gap !== null && gap < 0) {
      dropped.push({ caseNumber: c.caseNumber, why: "decided after the case was filed" });
      continue;
    }
    const expires = decided ? expiresOn(decided) : null;
    const pastValidity = daysBetweenOrNull(expires, filed);
    if (pastValidity !== null && pastValidity > RECRUITMENT_SLACK_DAYS) {
      dropped.push({ caseNumber: c.caseNumber, why: "expired too long before the case was filed" });
      continue;
    }
    kept.push({ ...c, gapDays: gap });
  }
  kept.sort((a, b) => {
    if (b.namedRecent !== a.namedRecent) return b.namedRecent - a.namedRecent;
    if (b.namedCount !== a.namedCount) return b.namedCount - a.namedCount;
    if (a.gapDays === null || b.gapDays === null) return a.gapDays === null ? (b.gapDays === null ? 0 : 1) : -1;
    return Math.abs(a.gapDays - TYPICAL_GAP_DAYS) - Math.abs(b.gapDays - TYPICAL_GAP_DAYS) || b.gapDays - a.gapDays;
  });
  return { kept, dropped };
}

/**
 * Where the page may call the top candidate "most likely": when at most MOST_LIKELY_MAX_LEFT candidates are left,
 * the backtest (strict cutoff) found the top one was the named request at least MOST_LIKELY_MIN_RATE of the time.
 * 0 means never, until a backtest says otherwise. MEASURED holds what it found, for the page to say.
 */
export const MOST_LIKELY_MIN_RATE = 0.8;
// The backtest of Nov 24 2026 (scripts/backtest_wage_links.ts, strict cutoff, 339,604 decided cases): with one request
// left the top was the case's own 99.3% of the time; with two, 60.7%; three, 47.2%; four or five, 36.5%; six or more,
// 12.8%. Only one left clears the rate.
export const MOST_LIKELY_MAX_LEFT = 1;
export const MEASURED: { on: string; cases: number; topRightByLeft: Record<string, number> } | null = {
  on: "Nov 24, 2026",
  cases: 339_604,
  topRightByLeft: { "1": 0.993, "2": 0.607, "3": 0.472, "4-5": 0.365, "6+": 0.128 },
};

/** The measured rate for this many requests left, as the backtest bucketed them. */
export function topRightRate(left: number): number | null {
  if (!MEASURED || left < 1) return null;
  const key = left >= 6 ? "6+" : left >= 4 ? "4-5" : String(left);
  return MEASURED.topRightByLeft[key] ?? null;
}

export function mostLikelyOf(kept: readonly RankedCandidate[]): string | null {
  const top = kept[0];
  if (!top || top.gapDays === null || kept.length > MOST_LIKELY_MAX_LEFT) return null;
  return top.caseNumber;
}
