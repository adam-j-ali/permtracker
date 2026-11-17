/**
 * How long PERM cases wait at one review stage, from our own record of DOL's statuses.
 *
 * Two dates can start a wait, and they're kept apart:
 *   - "seen": the DOL day our daily check first saw the case arrive at the stage. Only an arrival seen after the
 *     record's catch-up counts (`HISTORY_FROM`): the first sweeps say where every case stood, never when it moved.
 *   - "denied": for an appeal stage, DOL's own denial date from its quarterly file, when our record didn't see the
 *     case arrive. A motion to reconsider is due within 30 days of the denial (20 CFR 656.24(g)), so the wait since
 *     the denial runs at most about a month longer than the wait at the stage itself.
 * Anything else has no start on record, and is counted as that rather than guessed.
 *
 * Plain module: the stage page, its feed and their tests read it.
 */

import { dolDayOf } from "@/lib/dolDay";
import { HISTORY_FROM } from "@/lib/statusHistory";
import { moveTone, type MoveTone } from "@/lib/stageMoves";

export type StartSource = "seen" | "denied" | "unknown";

export interface StageStart {
  /** "YYYY-MM-DD", or null when the record holds no start. */
  on: string | null;
  source: StartSource;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Whole days from one ISO day to another (UTC midnights, so a clock change never shifts it). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Where a case's wait at a stage starts: our seen arrival first, then (appeal stages) DOL's denial date. */
export function startFor(arrivalAt: number | null, deniedOn: string | null, appeal: boolean): StageStart {
  if (arrivalAt !== null && Number.isFinite(arrivalAt)) {
    const day = dolDayOf(arrivalAt);
    if (day > HISTORY_FROM) return { on: day, source: "seen" };
  }
  const denied = deniedOn ? deniedOn.slice(0, 10) : null;
  if (appeal && denied && ISO_DAY.test(denied)) return { on: denied, source: "denied" };
  return { on: null, source: "unknown" };
}

export interface Arrival {
  caseNumber: string;
  /** When our check saw the case arrive at the stage, epoch ms. */
  at: number;
}

/** Each case's latest arrival at the stage. */
export function lastArrivals(arrivals: readonly Arrival[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of arrivals) {
    const prev = out.get(a.caseNumber);
    if (prev === undefined || a.at > prev) out.set(a.caseNumber, a.at);
  }
  return out;
}

export interface WaitBucket {
  key: string;
  label: string;
  /** Cases our check saw arrive. */
  seen: number;
  /** Cases timed from DOL's denial date. */
  denied: number;
}

const BANDS: ReadonlyArray<{ key: string; label: string; lo: number; hi: number }> = [
  { key: "lt30", label: "Under 30 days", lo: 0, hi: 30 },
  { key: "30-59", label: "30 to 59 days", lo: 30, hi: 60 },
  { key: "60-89", label: "60 to 89 days", lo: 60, hi: 90 },
  { key: "90-179", label: "90 to 179 days", lo: 90, hi: 180 },
  { key: "180-364", label: "180 days to a year", lo: 180, hi: 365 },
  { key: "365+", label: "A year or more", lo: 365, hi: Number.POSITIVE_INFINITY },
];

/** The waiting cases by how long they've waited so far, with the ones that have no start on record counted apart. */
export function waitBuckets(
  starts: readonly StageStart[],
  today: string,
): { buckets: WaitBucket[]; known: number; unknown: number } {
  const buckets: WaitBucket[] = BANDS.map((b) => ({ key: b.key, label: b.label, seen: 0, denied: 0 }));
  let known = 0;
  let unknown = 0;
  for (const s of starts) {
    if (!s.on || s.source === "unknown") {
      unknown += 1;
      continue;
    }
    const d = Math.max(0, daysBetween(s.on, today));
    const i = BANDS.findIndex((b) => d >= b.lo && d < b.hi);
    const bucket = buckets[i < 0 ? BANDS.length - 1 : i]!;
    if (s.source === "seen") bucket.seen += 1;
    else bucket.denied += 1;
    known += 1;
  }
  return { buckets, known, unknown };
}

/** The typical (median) and longest wait so far among the cases whose start is on record. */
export function knownWaitSummary(
  starts: readonly StageStart[],
  today: string,
): { known: number; unknown: number; median: number | null; longest: number | null } {
  const days = starts
    .filter((s) => s.on && s.source !== "unknown")
    .map((s) => Math.max(0, daysBetween(s.on!, today)))
    .sort((a, b) => a - b);
  const unknown = starts.length - days.length;
  if (days.length === 0) return { known: 0, unknown, median: null, longest: null };
  return { known: days.length, unknown, median: days[Math.floor((days.length - 1) / 2)]!, longest: days[days.length - 1]! };
}

/** One move out of the stage as the event log and the case tables hold it. */
export interface StageExitRaw {
  caseNumber: string;
  /** When our check saw the case leave, epoch ms. */
  at: number;
  /** DOL's status it moved to. */
  to: string;
  filingDate: string | null;
  employer: string | null;
  employerSlug: string | null;
  jobTitle: string | null;
  /** DOL's status for the case today. */
  nowStatus: string | null;
  /** DOL's denial date from its quarterly file, when the file holds the case as denied. */
  deniedOn: string | null;
}

/** One answered case, ready to print. */
export interface StageExit {
  caseNumber: string;
  /** The DOL day it left the stage. */
  leftOn: string;
  to: string;
  startOn: string | null;
  startSource: StartSource;
  /** Days from the start to the day it left, or null with no start on record. */
  days: number | null;
  filingDate: string | null;
  employer: string | null;
  employerSlug: string | null;
  jobTitle: string | null;
  nowStatus: string | null;
}

/**
 * The cases that left the stage since our record began, newest first, each timed from the arrival our check saw
 * before it left (a case can return to a stage; a later return isn't this stay's start).
 */
export function joinExits(exits: readonly StageExitRaw[], arrivals: readonly Arrival[], appeal: boolean): StageExit[] {
  const byCase = new Map<string, number[]>();
  for (const a of arrivals) {
    const list = byCase.get(a.caseNumber);
    if (list) list.push(a.at);
    else byCase.set(a.caseNumber, [a.at]);
  }
  const out: StageExit[] = [];
  for (const e of exits) {
    const leftOn = dolDayOf(e.at);
    if (leftOn <= HISTORY_FROM) continue;
    const before = (byCase.get(e.caseNumber) ?? []).filter((t) => t < e.at);
    const arrival = before.length > 0 ? Math.max(...before) : null;
    const start = startFor(arrival, e.deniedOn, appeal);
    out.push({
      caseNumber: e.caseNumber,
      leftOn,
      to: e.to,
      startOn: start.on,
      startSource: start.source,
      days: start.on ? Math.max(0, daysBetween(start.on, leftOn)) : null,
      filingDate: e.filingDate,
      employer: e.employer,
      employerSlug: e.employerSlug,
      jobTitle: e.jobTitle,
      nowStatus: e.nowStatus,
    });
  }
  return out.sort((a, b) => (a.leftOn === b.leftOn ? a.caseNumber.localeCompare(b.caseNumber) : a.leftOn < b.leftOn ? 1 : -1));
}

export interface WeekExits {
  /** The week's Monday, "YYYY-MM-DD". */
  weekStart: string;
  tones: Record<MoveTone, number>;
  total: number;
  /** The current week, still running. */
  partial: boolean;
}

const TONES: readonly MoveTone[] = ["good", "line", "bad", "withdrawn", "aside", "other"];

/** The Monday of an ISO day's week. */
export function mondayOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 Sunday .. 6 Saturday
  const back = (dow + 6) % 7;
  return new Date(t - back * DAY_MS).toISOString().slice(0, 10);
}

/** The first whole week our record can date a move in: the Monday after the catch-up. */
export const FIRST_WEEK = mondayOf(new Date(Date.parse(`${HISTORY_FROM}T00:00:00Z`) + 7 * DAY_MS).toISOString().slice(0, 10));

/** Answered cases by week and by what the answer was, oldest week first, ending with this (partial) week. */
export function weeklyExits(
  rows: ReadonlyArray<{ leftOn: string; to: string }>,
  today: string,
  weeks = 12,
): WeekExits[] {
  const thisWeek = mondayOf(today);
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const w = new Date(Date.parse(`${thisWeek}T00:00:00Z`) - i * 7 * DAY_MS).toISOString().slice(0, 10);
    if (w >= FIRST_WEEK) starts.push(w);
  }
  const out = new Map<string, WeekExits>(
    starts.map((w) => [
      w,
      { weekStart: w, tones: Object.fromEntries(TONES.map((t) => [t, 0])) as Record<MoveTone, number>, total: 0, partial: w === thisWeek },
    ]),
  );
  for (const r of rows) {
    const wk = out.get(mondayOf(r.leftOn));
    if (!wk) continue;
    wk.tones[moveTone(r.to)] += 1;
    wk.total += 1;
  }
  return starts.map((w) => out.get(w)!);
}
