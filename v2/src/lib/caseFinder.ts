/**
 * Finding a case without its number: the cases one employer filed on one day, picked out of that
 * day's list (/api/filed-on). Plain module, so every place that asks for a case number or a
 * filing date matches a typed name the same way.
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

export interface DayNumbers {
  filed: number;
  decided: number;
  waiting: number;
}

export interface CloseName {
  employer: string;
  /** Cases that employer filed on the day. */
  cases: number;
}

export interface FinderAnswer {
  /** The day's cases whose employer the typed name fits (and whose job fits, when one is typed), by employer then case number. */
  matches: DayCase[];
  /** How many the employer's name fits, before any job title narrows them. */
  ofEmployer: number;
  /** With no match: the employers on the day spelled closest to it, busiest first among equals. */
  close: CloseName[];
  /** The whole day, whatever was typed. */
  day: DayNumbers;
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
 * The employers on a day, each once however DOL printed it ("Amazon Web Services, Inc." and
 * "AMAZON WEB SERVICES, INC." are one), under its commonest spelling with its cases together,
 * busiest first: the ranker keeps that order among names it scores the same. Between spellings
 * equally common, the one with fewer capitals reads better than the one typed in all caps.
 */
function employersOn(cases: readonly DayCase[]): CloseName[] {
  const groups = new Map<string, Map<string, number>>();
  for (const c of cases) {
    if (!c.employer) continue;
    const key = programKey(c.employer);
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(c.employer, (spellings.get(c.employer) ?? 0) + 1);
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

/** One day's cases read for one typed employer, narrowed by a job title when one is typed. */
export function findOnDay(cases: readonly DayCase[], typed: string, job = ""): FinderAnswer {
  const decided = cases.filter((c) => c.final).length;
  const day = { filed: cases.length, decided, waiting: cases.length - decided };
  if (!enoughTyped(typed)) return { matches: [], ofEmployer: 0, close: [], day };
  const ofEmployer = cases
    .filter((c) => nameFits(typed, c.employer))
    // By the employer's key, so one company's spellings stay together, then by number.
    .sort((a, b) => programKey(a.employer).localeCompare(programKey(b.employer)) || a.caseNumber.localeCompare(b.caseNumber));
  if (ofEmployer.length > 0) {
    return { matches: ofEmployer.filter((c) => jobFits(job, c.jobTitle)), ofEmployer: ofEmployer.length, close: [], day };
  }
  return { matches: [], ofEmployer: 0, close: rankFuzzy(typed, employersOn(cases), (n) => n.employer, { limit: CLOSE_NAMES }).map((r) => r.item), day };
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
