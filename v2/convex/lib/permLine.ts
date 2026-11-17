/**
 * Where DOL is in the PERM line by our own daily check of its case status: the newest filing month DOL has begun
 * deciding, from the census matrix (perm_docs['live_census'], rebuilt after every sweep).
 *
 * WHAT "BEGUN" MEANS, MEASURED. DOL works its queue a filing month at a time, and it begins the next month before
 * the last is finished: on Sep 22, Oct 20 and Nov 10 2026, once the month before was 80.0%, 80.9% and 82.5% decided
 * among the cases it can decide (src/lib/monthStart.ts). So a month has begun when DOL has made LINE_STARTED_MIN of
 * its own decisions on it (a month's first day of real work ran 75 to 222) and the month before is LINE_PREVIOUS_DONE
 * decided, or when DOL has made LINE_STARTED_FIRMLY decisions on it whatever the month before shows. A withdrawal is
 * the employer's act, never DOL's, so it doesn't count; a case on hold isn't one DOL can decide.
 *
 * Run on the record as it stood each day from Aug 30 2026, this names December 2025 on Sep 22, January 2026 on
 * Oct 20 and February 2026 on Nov 10, each the day DOL began it. The rule it replaced ("the oldest month under half
 * decided") named each a week or two before DOL began it: on Nov 17 it named March 2026, when DOL had decided 3 of
 * March's 7,042 cases and the rest of its 269 final statuses were withdrawals.
 *
 * The one copy of the rule. The site reads it through src/lib/permLine.ts, Convex's PERM month alerts read it
 * directly (DOL's processing-times page stopped printing a month on Oct 31 2026), and scripts/lib_perm_line.py is its
 * Python twin, held to the same answers by scripts/fixtures/perm_line.json. LINE_MIN_CASES equals FRONT_MIN_CASES
 * (src/lib/liveQueue.ts) and LINE_STARTED_MIN equals START_JUMP (src/lib/monthStart.ts); a test holds them together.
 *
 * Imports nothing, so Convex's bundle and the site's both take it.
 */

/** A month needs this many cases on record to count. */
export const LINE_MIN_CASES = 100;
/** DOL has begun a month once it has decided this many of its cases... */
export const LINE_STARTED_MIN = 50;
/** ...with the month before this far decided, among the cases DOL can decide (holds and withdrawals left out). */
export const LINE_PREVIOUS_DONE = 0.8;
/** Or once it has decided this many, whatever the month before shows (the Oct 2025 shutdown month never got there). */
export const LINE_STARTED_FIRMLY = 500;

export interface PermLine {
  /** The filing month DOL is deciding now, "YYYY-MM". */
  month: string;
  /** That month's cases, and how many of them have a final status (DOL's decisions and withdrawals). */
  total: number;
  decided: number;
  /** The day our check ran (ISO). */
  asOf: string;
}

/** One cell of the census: a filing month, a status, and how many cases hold it. */
export interface CensusCell {
  month: string;
  /** DOL's status word. A row without one counts a final status as DOL's decision. */
  status?: string;
  is_final: number;
  n: number;
}

interface MonthTally {
  total: number;
  /** Every final status. */
  final: number;
  /** DOL's own decisions: final statuses other than a withdrawal. */
  dol: number;
  withdrawn: number;
  held: number;
}

const MONTH = /^\d{4}-\d{2}$/;
const WITHDRAWN = /^WITHDRAWN/;
const ON_HOLD = "APPLICATION ON HOLD";

/** Each filing month's counts from the census matrix. */
export function tallyMonths(matrix: readonly CensusCell[]): Map<string, MonthTally> {
  const months = new Map<string, MonthTally>();
  for (const r of matrix) {
    if (!MONTH.test(r.month)) continue;
    const m = months.get(r.month) ?? { total: 0, final: 0, dol: 0, withdrawn: 0, held: 0 };
    const status = (r.status ?? "").trim().toUpperCase();
    m.total += r.n;
    if (r.is_final === 1) {
      m.final += r.n;
      if (WITHDRAWN.test(status)) m.withdrawn += r.n;
      else m.dol += r.n;
    } else if (status === ON_HOLD) {
      m.held += r.n;
    }
    months.set(r.month, m);
  }
  return months;
}

/** The line from the census matrix: null when no month on record has begun. */
export function permLineFrom(matrix: readonly CensusCell[], asOf: string): PermLine | null {
  const busy = [...tallyMonths(matrix).entries()]
    .filter(([, m]) => m.total >= LINE_MIN_CASES)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  let found: { month: string; m: MonthTally } | null = null;
  for (let i = 0; i < busy.length; i += 1) {
    const [month, m] = busy[i]!;
    if (m.dol < LINE_STARTED_MIN) continue;
    const before = i > 0 ? busy[i - 1]![1] : null;
    const workable = before ? before.total - before.held - before.withdrawn : 0;
    const beforeDone = !before || (workable > 0 && before.dol / workable >= LINE_PREVIOUS_DONE);
    if (beforeDone || m.dol >= LINE_STARTED_FIRMLY) found = { month, m };
  }
  if (!found) return null;
  return { month: found.month, total: found.m.total, decided: found.m.final, asOf };
}
