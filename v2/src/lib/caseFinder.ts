/**
 * Finding a case without its number, from what a person knows about it: the employer's name, the job title, the
 * law firm, and the day or the days it was filed. Plain module, so every place that asks matches what was typed
 * the same way: the site's finder, the API, the MCP tool and the chat. The read itself is the server's
 * (src/lib/findCase.ts); these are its rules.
 */
import { programKey } from "@/lib/entitySlug";
import type { DayCase } from "@/lib/filingDay";
import { rankFuzzy } from "@/lib/fuzzy";

/** Letters or digits a name needs before it's matched: one letter matches half the day. */
export const FINDER_MIN_LETTERS = 2;
/** Cases the finder lists before "Show all". */
export const FINDER_SHOWN = 6;
/** Close names offered when nothing on the day matches. */
const CLOSE_NAMES = 5;
/** Days either side of the filing day the nearby search covers. */
export const NEARBY_DAYS = 7;

export interface CloseName {
  employer: string;
  /** Cases that employer filed in the days read. */
  cases: number;
}

/** Whether enough was typed to match on. */
export function enoughTyped(typed: string): boolean {
  return (typed.match(/[a-z0-9]/gi) ?? []).length >= FINDER_MIN_LETTERS;
}

/**
 * Whether a typed name fits an employer's printed one. Both go through the site's employer key
 * first, so "Inc", "LLC", punctuation and a trade name after "d/b/a" never decide it. Every typed
 * word must begin a word of the name ("micro" fits Microsoft), or the typed words run together must
 * begin the name run together from one of its words ("wal mart" fits Walmart, "jpmorgan" fits JP
 * Morgan Chase). The middle of a word never fits: "soft" isn't Microsoft.
 */
export function nameFits(typed: string, employer: string): boolean {
  const want = programKey(typed).split(" ").filter(Boolean);
  if (want.length === 0) return false;
  const have = programKey(employer).split(" ").filter(Boolean);
  if (want.every((w) => have.some((h) => h.startsWith(w)))) return true;
  const glued = want.join("");
  return glued.length >= 3 && have.some((_, i) => have.slice(i).join("").startsWith(glued));
}

/**
 * Printed employer names, each company once however DOL printed it ("Amazon Web Services, Inc." and
 * "AMAZON WEB SERVICES, INC." are one), under its commonest spelling with its cases together,
 * busiest first: the ranker keeps that order among names it scores the same. Between spellings
 * equally common, the one with fewer capitals reads better than the one typed in all caps.
 */
function groupEmployers(names: Iterable<CloseName>): CloseName[] {
  const groups = new Map<string, Map<string, number>>();
  for (const n of names) {
    if (!n.employer) continue;
    const key = programKey(n.employer);
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(n.employer, (spellings.get(n.employer) ?? 0) + n.cases);
    groups.set(key, spellings);
  }
  return [...groups.values()]
    .map((spellings) => {
      const capitals = (name: string) => (name.match(/[A-Z]/g) ?? []).length;
      const byCount = [...spellings].sort((a, b) => b[1] - a[1] || capitals(a[0]) - capitals(b[0]) || (a[0] < b[0] ? -1 : 1));
      return { employer: byCount[0]![0], cases: byCount.reduce((sum, [, n]) => sum + n, 0) };
    })
    .sort((a, b) => b.cases - a.cases || (a.employer < b.employer ? -1 : 1));
}

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Whether a job title holds every typed word, whatever the case and punctuation. No words fit every job. */
export function jobFits(typed: string, jobTitle: string): boolean {
  const have = fold(jobTitle);
  return fold(typed).split(" ").filter(Boolean).every((w) => have.includes(w));
}

export interface NearbyDay {
  day: string;
  cases: number;
}

/** A search's rows folded to the days they were filed on, nearest the asked day first, that day left out. */
export function nearbyDays(rows: readonly { filedOn: string | null }[], asked: string): NearbyDay[] {
  const tally = new Map<string, number>();
  for (const r of rows) if (r.filedOn && r.filedOn !== asked) tally.set(r.filedOn, (tally.get(r.filedOn) ?? 0) + 1);
  const gap = (d: string) => Math.abs(Date.parse(`${d}T12:00:00Z`) - Date.parse(`${asked}T12:00:00Z`));
  return [...tally].map(([day, cases]) => ({ day, cases })).sort((a, b) => gap(a.day) - gap(b.day) || a.day.localeCompare(b.day));
}

/* ------------------------------------------------------------------ */
/* A window of filing days, and any of three things known about a case  */
/* ------------------------------------------------------------------ */

/**
 * The longest filing window read whole, a quarter. Set from measurements on the server (Nov 10 2026): a job-title
 * search over 92 days of the busiest program, 129,000 H-1B LCAs, answered in 0.36 s cold and 0.15 s warm. A year
 * of it took up to 1.7 s, and a run of such scans slowed the site's own reads, so a longer window isn't read whole:
 * with an employer or a law firm typed, the site's index for that name answers over any dates instead.
 */
export const WINDOW_MAX_DAYS = 92;
/** Cases one answer carries. */
export const FOUND_MAX = 200;
/** A window this short also gets the close spellings when no employer's name fits. */
export const CLOSE_NAMES_MAX_DAYS = 31;

/** What a person may know about a case with no number: each part optional, at least one given. */
export interface FinderAsk {
  employer: string;
  /** Words of the job title. */
  title: string;
  /** Words of the law firm's or agent's name. DOL names it only once a case is decided. */
  firm: string;
  /** `YYYY-MM-DD` or empty. One date alone is that one day. */
  from: string;
  to: string;
}

/** A case in a window's answer: the day's row, the day it was filed, and the firm where DOL's file names one. */
export interface FoundCase extends DayCase {
  filedOn: string;
  firm?: string | null;
}

export type FinderWindow =
  | { ok: true; from: string; to: string; /** No date was given, so the newest quarter is read. */ assumed: boolean }
  | { ok: false; why: "bad-date" | "too-early" | "not-yet" }
  /** Real days, further apart than one read covers. */
  | { ok: false; why: "too-long"; from: string; to: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d: string) => DAY.test(d) && new Date(Date.parse(`${d}T12:00:00Z`)).toISOString().slice(0, 10) === d;
const moved = (d: string, days: number) => new Date(Date.parse(`${d}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Days from `from` to `to`, both counted. */
export const windowDays = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

/**
 * The filing days an ask names. Two dates are a window, in either order; one date is that one day. With no date
 * the newest quarter is assumed, for a search that has only a job title to go on. A window is cut to the days the
 * lists hold (`earliest` to today). One longer than WINDOW_MAX_DAYS is "too-long": the caller reads it through an
 * index when a name was typed, and asks for closer dates when none was.
 */
export function finderWindow(ask: Pick<FinderAsk, "from" | "to">, today: string, earliest: string): FinderWindow {
  const a = ask.from.trim();
  const b = ask.to.trim();
  if ((a && !realDay(a)) || (b && !realDay(b))) return { ok: false, why: "bad-date" };
  if (!a && !b) {
    const start = moved(today, -(WINDOW_MAX_DAYS - 1));
    return { ok: true, from: start < earliest ? earliest : start, to: today, assumed: true };
  }
  let from = a || b;
  let to = b || a;
  if (from > to) [from, to] = [to, from];
  if (to < earliest) return { ok: false, why: "too-early" };
  if (from > today) return { ok: false, why: "not-yet" };
  if (from < earliest) from = earliest;
  if (to > today) to = today;
  if (windowDays(from, to) > WINDOW_MAX_DAYS) return { ok: false, why: "too-long", from, to };
  return { ok: true, from, to, assumed: false };
}

/** The words of a typed job title or firm name: letters and digits, lower case. */
export function typedWords(typed: string): string[] {
  return fold(typed).split(" ").filter(Boolean);
}

/** Whether a typed box counts as filled: two letters or digits, as for an employer's name. */
export const boxFilled = enoughTyped;

/** Whether an ask names anything at all: a filled box or a date. */
export function askedAnything(ask: FinderAsk): boolean {
  return boxFilled(ask.employer) || boxFilled(ask.title) || boxFilled(ask.firm) || ask.from.trim() !== "" || ask.to.trim() !== "";
}

/** Whether a firm's printed name holds every typed word, whatever the case and punctuation. */
export function firmFits(typed: string, firm: string | null | undefined): boolean {
  const have = fold(firm ?? "");
  return typedWords(typed).every((w) => have.includes(w));
}

/**
 * The letters a typed employer name must share with a printed one for `nameFits` to hold: the start of its first
 * key word, three letters at most. The database narrows a window by it before the exact match runs here, so a
 * year of filings is never carried whole. Empty when nothing usable was typed.
 */
export function employerStem(typed: string): string {
  const first = programKey(typed).split(" ").filter(Boolean)[0] ?? "";
  return first.replace(/[^a-z0-9]/g, "").slice(0, 3);
}

/** The rows of a window that fit every filled box, one company's spellings together, the newest filing first. */
export function matchFound(rows: readonly FoundCase[], ask: Pick<FinderAsk, "employer" | "title" | "firm">): FoundCase[] {
  const byName = boxFilled(ask.employer);
  const byFirm = boxFilled(ask.firm);
  const kept = rows.filter(
    (c) => (!byName || nameFits(ask.employer, c.employer)) && jobFits(ask.title, c.jobTitle) && (!byFirm || firmFits(ask.firm, c.firm)),
  );
  const newest = (a: FoundCase, b: FoundCase) => b.filedOn.localeCompare(a.filedOn) || a.caseNumber.localeCompare(b.caseNumber);
  return byName
    ? kept.sort((a, b) => programKey(a.employer).localeCompare(programKey(b.employer)) || newest(a, b))
    : kept.sort((a, b) => newest(a, b) || a.employer.localeCompare(b.employer));
}

/** Of the employers that filed in a window, the ones spelled closest to a typed name that fits none of them. */
export function closeNamesAmong(names: readonly CloseName[], typed: string): CloseName[] {
  return rankFuzzy(typed, groupEmployers(names), (n) => n.employer, { limit: CLOSE_NAMES }).map((r) => r.item);
}
