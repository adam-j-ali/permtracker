/**
 * One employer's PERM cases, case by case: which of them changed status, and the sentence for each kind of change.
 *
 * The follow on every employer page has two sizes. "Group moves" tells a follower when DOL acts on the employer's
 * cases in bulk (src/lib/employerStages.ts). "Every case" tells them about each status change of each case, which is
 * what someone who manages those cases needs: a certification starts the 180 days to file the I-140, and a request
 * for information starts a deadline. This is the pure half of "every case": which rows of the event log are real
 * moves, how they group into sentences, and which of them a follower hasn't heard. The read is in
 * convex/employerAlerts.ts.
 *
 * THE SAME TWO FILTERS AS THE CHANGE FEED (src/lib/db/changes.ts), for the same reasons. A certification lapsing
 * after 180 days is a clock running out, not DOL acting. And a timestamp carrying thousands of rows is a sweep
 * catching up on months of changes at once, not a day's work. The constants are copies only because that module is
 * server-only; employerCaseMoves.test.ts holds them to its text.
 *
 * WHO ACTED IS PART OF EVERY SENTENCE, as in employerStages.ts: DOL certifies, denies, holds and asks; the employer
 * withdraws and appeals. Where DOL publishes no meaning for a status (NORD), the sentence quotes the status and
 * adds nothing.
 *
 * Relative imports only: Convex's bundler loads this file, and it knows no "@/".
 */

import { formatInt } from "../../convex/lib/format";
import { MONTH_ABBR } from "../../convex/lib/months";
import { MS_PER_DAY } from "../../convex/lib/time";
import { dolDayOf } from "./dolDay";
import { HOLD_STATUS, QUEUE_STATUS, decisionSentence, holdSentence } from "./employerStages";
import { prettyStatus } from "./statusTone";

/** What a follower asked to hear: bulk moves only, or every case. A row with no scope is a group follow. */
export type FollowScope = "group" | "each";

export function followScope(v: unknown): FollowScope {
  return v === "each" ? "each" : "group";
}

/**
 * An employer with this many pending cases or more has a case decided most weeks, so "every case" there is a
 * frequent email: its follow box opens with "every case" unticked. Below it, a group move can hardly happen (it
 * needs five cases moving in a day), so the box opens with it ticked. The tick box is always there.
 */
export const EVERY_CASE_DEFAULT_BELOW = 50;

/** The size a follow box opens on. `pending` is null when the census can't say (unread, or stale). */
export function defaultFollowScope(pending: number | null): FollowScope {
  return pending !== null && pending < EVERY_CASE_DEFAULT_BELOW ? "each" : "group";
}

/**
 * The follow box's one choice, as a tick box under what the box already says about group moves. "Every case"
 * carries the group moves too (a hold of two hundred cases is two hundred case changes, sent as one line), so
 * ticking it adds and never takes away.
 */
export const EVERY_CASE_LABEL = "Every case too: an email each time one of its cases changes status, once a day at most.";

/**
 * What each size of follow sends, as one promise. Every page and email that describes a follow says it with these
 * words, so the form, the confirmation and the footer can't drift apart.
 */
export function followPromise(scope: FollowScope): string {
  return scope === "each"
    ? "We'll email you each time the status of one of its PERM cases changes: a certification, a denial, a request for information, a hold, a withdrawal or an appeal. That's one email a day at most, on days something changed."
    : "We'll email you when DOL moves five or more of its PERM cases on or off hold in a day, or decides a batch of them well above its usual pace. Employer updates come at most once a day.";
}

/** Why the reader got an alert, by the size of follow they chose: the email's footer. */
export function followFooter(employerName: string, scope: FollowScope): string {
  return scope === "each"
    ? `You follow ${employerName} on PERM Tracker, case by case. We write each time the status of one of its PERM cases changes, at most once a day.`
    : `You follow ${employerName} on PERM Tracker. We write when DOL moves five or more of its cases on or off hold in a day, or decides a batch of them well above its usual pace.`;
}

/** An alert's closing lines: what the statuses are, and what they don't say. `asOf` is the census day, in words. */
export function closingLine(scope: FollowScope, asOf: string, hasMix: boolean): string {
  if (scope === "each") {
    return `These are DOL's own case statuses, read from its case system${hasMix ? `; the pending cases were counted on ${asOf}` : ""}. DOL gives no reason for any of them, and neither do we. One case's result doesn't predict another's.`;
  }
  return `These are DOL's own case statuses, read from its case system and counted on ${asOf}. DOL gives no reason for a hold or a batch, and neither do we. None of it predicts any one case.`;
}

/** Byte-identical to the three constants in src/lib/db/changes.ts. */
export const EXPIRY_FROM = "CERTIFIED";
export const EXPIRY_TO = "CERTIFIED - EXPIRED";
export const BULK_WRITE_ROWS = 5000;

/** Only DOL's own answers count as moves (`SOURCE` in scripts/ingest_case_status_direct.py). */
export const DIRECT_SOURCE = "flag.dol.gov/recaptcha/caseStatus (DOL, direct)";

/** A change older than this many days is history, not news (the same window as the group moves). */
export const CASE_MOVE_FRESH_DAYS = 7;
/** How far back the read reaches: the freshness window and a day of slack for the 7 AM day boundary. */
export const CASE_MOVE_READ_DAYS = CASE_MOVE_FRESH_DAYS + 1;
/** Case rows one email lists; the rest are a count and a link to the employer's page. */
export const CASE_ROWS_SHOWN = 30;

/** One row of the event log, joined to the case and its employer's page. */
export interface CaseMoveRow {
  slug: string;
  caseNumber: string;
  /** When our check first saw the new status, in milliseconds. */
  at: number;
  from: string;
  to: string;
  /** The case's filing date, "YYYY-MM-DD", when DOL's record carries one. */
  filed: string | null;
  jobTitle: string | null;
}

export interface CaseMove extends CaseMoveRow {
  /** The day DOL worked (src/lib/dolDay.ts): the date a reader is shown. */
  worked: string;
}

/**
 * The rows that are DOL or the employer acting on a case, newest first.
 *
 * Dropped: a first sighting (no status before it), a status that didn't change, a lapsed certification, and every
 * row under a timestamp in `bulkStamps` (the timestamps holding more than `BULK_WRITE_ROWS` rows).
 */
export function realCaseMoves(rows: readonly CaseMoveRow[], bulkStamps: ReadonlySet<number>): CaseMove[] {
  return rows
    .filter(
      (r) =>
        r.slug !== "" &&
        r.caseNumber !== "" &&
        r.from !== "" &&
        r.to !== "" &&
        r.from !== r.to &&
        !(r.from === EXPIRY_FROM && r.to === EXPIRY_TO) &&
        !bulkStamps.has(r.at),
    )
    .map((r) => ({ ...r, worked: dolDayOf(r.at) }))
    .sort((a, b) => b.at - a.at || a.caseNumber.localeCompare(b.caseNumber));
}

/**
 * Which of an employer's moves a follower hasn't heard: seen after their watermark, and inside the freshness window.
 * A follow with no watermark yet has heard nothing and is owed nothing older than its own start.
 */
export function unheardCaseMoves(
  moves: readonly CaseMove[] | undefined,
  toldThrough: number | undefined,
  followedAt: number,
  now: number,
): CaseMove[] {
  const floor = Math.max(toldThrough ?? followedAt, now - CASE_MOVE_FRESH_DAYS * MS_PER_DAY);
  return (moves ?? []).filter((m) => m.at > floor);
}

const APPEALS = new Set(["RECONSIDERATION APPEALS", "BALCA APPEALS", "REQUEST FOR REVIEW"]);

/**
 * "DOL certified 3 of its cases": one kind of change, counted, naming who acted.
 *
 * Built on the group sentences where the shape is the same (a decision, a move on or off hold), so one employer's
 * mail reads alike whichever size of follow sent it.
 */
export function caseMoveSentence(from: string, to: string, n: number): string {
  const cases = `${formatInt(n)} of its cases`;
  if (to === HOLD_STATUS) return holdSentence({ dir: "on", to, n });
  if (from === HOLD_STATUS) return holdSentence({ dir: "off", to, n });
  switch (to) {
    case "CERTIFIED":
      if (from === "RECONSIDERATION APPEALS") return `DOL certified ${cases} on reconsideration`;
      if (from === "DENIED") return `DOL certified ${cases} that it had denied`;
      if (from === "BALCA APPEALS" || from === "REQUEST FOR REVIEW") return `DOL certified ${cases} after an appeal`;
      return decisionSentence({ to, n });
    case "DENIED":
      if (APPEALS.has(from)) return `${cases} went from appeal back to denied`;
      return decisionSentence({ to, n });
    case "WITHDRAWN":
      return decisionSentence({ to, n });
    case "RFI ISSUED":
      return `DOL sent a request for information on ${cases}`;
    case "PENDING AUDIT RESPONSE":
      return `DOL selected ${cases} for audit`;
    case "SUPERVISED RECRUITMENT":
      return `DOL put ${cases} into supervised recruitment`;
    case QUEUE_STATUS:
      if (from === "RFI ISSUED") return `${cases} went back to analyst review after a request for information`;
      return `${cases} went back to analyst review`;
    case "RECONSIDERATION APPEALS":
      return `The employer asked DOL to reconsider ${cases}`;
    case "REQUEST FOR REVIEW":
      return `The employer asked the appeals board (BALCA) to review ${cases}`;
    case "BALCA APPEALS":
      return `${cases} went to the appeals board (BALCA)`;
    case "DENIED - BALCA AFFIRMED":
      return `The appeals board (BALCA) affirmed the denial of ${cases}`;
    default:
      // DOL publishes no meaning for the rest (NORD among them), so the status is quoted and nothing is added.
      return `${cases} moved to "${prettyStatus(to)}", DOL's own name for the status`;
  }
}

export type MoveTone = "good" | "bad" | "neutral";

function toneOf(from: string, to: string): MoveTone {
  if (to === "CERTIFIED") return "good";
  if (to === HOLD_STATUS || to.startsWith("DENIED")) return "bad";
  return "neutral";
}

/** Decisions first, then what needs an answer, then the rest. */
function rankOf(to: string): number {
  if (to === "CERTIFIED") return 0;
  if (to.startsWith("DENIED")) return 1;
  if (to === "WITHDRAWN") return 2;
  if (to === "RFI ISSUED" || to === "PENDING AUDIT RESPONSE" || to === "SUPERVISED RECRUITMENT") return 3;
  if (to === HOLD_STATUS) return 4;
  if (APPEALS.has(to)) return 5;
  return 6;
}

/** One day, one kind of change: the sentence, and the cases under it. */
export interface CaseMoveGroup {
  /** `<worked>|<from>|<to>`: stable for a set of moves, for React keys and tests. */
  key: string;
  worked: string;
  from: string;
  to: string;
  sentence: string;
  tone: MoveTone;
  n: number;
  /** Oldest filing first, the order DOL works in. */
  cases: CaseMove[];
}

/**
 * Moves grouped by the day DOL worked and the kind of change, newest day first, decisions before the rest.
 * A case that moved twice appears under both changes: both happened.
 */
export function groupCaseMoves(moves: readonly CaseMove[]): CaseMoveGroup[] {
  const groups = new Map<string, CaseMove[]>();
  for (const m of moves) {
    const key = `${m.worked}|${m.from}|${m.to}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  return [...groups]
    .map(([key, list]) => {
      const first = list[0]!;
      const cases = [...list].sort(
        (a, b) => (a.filed ?? "9999").localeCompare(b.filed ?? "9999") || a.caseNumber.localeCompare(b.caseNumber),
      );
      return {
        key,
        worked: first.worked,
        from: first.from,
        to: first.to,
        sentence: caseMoveSentence(first.from, first.to, list.length),
        tone: toneOf(first.from, first.to),
        n: list.length,
        cases,
      };
    })
    .sort(
      (a, b) =>
        b.worked.localeCompare(a.worked) || rankOf(a.to) - rankOf(b.to) || b.n - a.n || a.key.localeCompare(b.key),
    );
}

/**
 * How many case rows each group prints when the email lists `limit` in all: groups in order, each taking what is
 * left. A group that can't print all of its cases prints the oldest filings and counts the rest.
 */
export function rowsShown(groups: readonly CaseMoveGroup[], limit = CASE_ROWS_SHOWN): number[] {
  let left = limit;
  return groups.map((g) => {
    const take = Math.max(0, Math.min(g.n, left));
    left -= take;
    return take;
  });
}

/** "filed Mar 2025" from a filing date, or "" when DOL's record has none. */
export function filedLabel(filed: string | null): string {
  const m = filed ? /^(\d{4})-(\d{2})/.exec(filed) : null;
  if (!m) return "";
  const month = MONTH_ABBR[Number(m[2]) - 1];
  return month ? `filed ${month} ${m[1]}` : "";
}

/** The newest instant among moves: the follower's next watermark. */
export function newestAt(moves: readonly CaseMove[]): number {
  return moves.reduce((a, m) => Math.max(a, m.at), 0);
}
