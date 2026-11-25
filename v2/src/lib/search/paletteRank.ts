/**
 * The search palette's order: each row's score for what was typed, and the groups in the order of their best rows.
 *
 * WHY IT'S WORKED OUT HERE AND NOT BY CMDK (D14). cmdk 1.1.1 sorts groups by looking each one up with
 * `encodeURIComponent(value)` against the value it wrote raw, so a group whose name has a space never moved, and a
 * page named exactly as typed could sit sixth. The palette now hands cmdk rows already in order (shouldFilter off).
 *
 * A SCORE IS A BAND PLUS A CLOSENESS. The whole number is the kind of match and the fraction is how close it is within
 * that kind, so a better kind always wins:
 *
 * - 5, the exact name;
 * - 4, the typed words, in order, at the start of the name or at a word's start inside it;
 * - 3, every typed word at the start of a word of the name, in any order (a plural counts as the word);
 * - 2, every typed word inside a word of the name;
 * - 1, every typed word somewhere in the name, the questions it answers or its keywords;
 * - 0.6 to 0.99, the site's fuzzy matcher over the name and keywords, so a swapped letter still finds the page (a
 *   long list asks its letter-triplet index instead, and only when nothing in it matched better).
 *
 * A page's questions (scripts/data/question_map.json) count as its name. Between two groups whose best rows are in the
 * same band, the group's priority decides: the site's own pages before a list of names. Plain arithmetic, no React.
 */

import { FuzzyIndex, normalizeText, scoreNormalized } from "@/lib/fuzzy";

/**
 * The lowest fuzzy score the palette shows, as its own filter had it: the site's matcher in place of cmdk's, so a
 * swapped or missing letter ("proecssing", "visa buletin") still finds the page.
 */
const FUZZY_MIN = 0.6;

/** The kinds of match, best first: the whole number of a score. */
export const MATCH = { exact: 5, phrase: 4, words: 3, inside: 2, keywords: 1 } as const;

/** A row the palette can rank. */
export interface Rankable {
  /** What the row is called: the exact and word matches read this. */
  name: string;
  /** The questions the page answers, read like its name. */
  aliases?: readonly string[];
  /** The words people type for it that its name doesn't carry. */
  keywords?: string;
  /**
   * A row that says a query back ("Every employer matching ..."): never counted toward its group's place, and shown
   * only in a group given as the answer to what's typed (a stale one would name the last query).
   */
  unranked?: boolean;
}

interface Text {
  text: string;
  words: string[];
}

interface Prepared {
  names: Text[];
  /** Every word of the name, the questions and the keywords. */
  allWords: string[];
  /** The name and keywords as one text, for the fuzzy matcher (what the palette's filter read before). */
  fuzzy: string;
}

/** Normalised once per row object and kept: the palette scores the same rows on every key. */
const PREPARED = new WeakMap<Rankable, Prepared>();

function text(s: string): Text {
  const t = normalizeText(s);
  return { text: t, words: t ? t.split(" ") : [] };
}

function prepare(row: Rankable): Prepared {
  const hit = PREPARED.get(row);
  if (hit) return hit;
  const names = [row.name, ...(row.aliases ?? [])].map(text);
  const keywords = text(row.keywords ?? "");
  const p: Prepared = {
    names,
    allWords: [...names.flatMap((n) => n.words), ...keywords.words],
    fuzzy: [names[0]!.text, keywords.text].filter(Boolean).join(" "),
  };
  PREPARED.set(row, p);
  return p;
}

/** "block" and "blocks", "box" and "boxes": one word for the palette. */
function samePlural(a: string, b: string): boolean {
  return a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
}

/** A word's start that counts as the word: 0.85, and 0.5 for one letter, which opens too many words to mean much. */
const START = 0.85;
const ONE_LETTER = 0.5;
/** A typed word inside a longer word. */
const INSIDE = 0.3;

/** How well one typed word fits one word of the name, 0 to 1. */
function wordFit(q: string, w: string): number {
  if (q === w) return 1;
  if (samePlural(q, w)) return 0.95;
  if (w.startsWith(q)) return q.length >= 2 ? START : ONE_LETTER;
  if (q.length >= 3 && w.includes(q)) return INSIDE;
  return 0;
}

/** Each typed word's best fit among some words. */
function fits(qWords: readonly string[], words: readonly string[]): number[] {
  return qWords.map((q) => {
    let best = 0;
    for (const w of words) {
      const f = wordFit(q, w);
      if (f > best) best = f;
      if (best === 1) break;
    }
    return best;
  });
}

/**
 * Where the typed letters, spaces taken out, open a run of the name's words also read without spaces: whether that
 * run starts the name, and whether it ends where a word ends. Null when no run of words starts with them.
 */
function joinedRun(letters: string, words: readonly string[]): { first: boolean; whole: boolean } | null {
  if (letters.length < 2) return null;
  for (let k = 0; k < words.length; k++) {
    let joined = "";
    for (let m = k; m < words.length && joined.length < letters.length; m++) joined += words[m];
    if (joined.startsWith(letters)) return { first: k === 0, whole: joined.length === letters.length };
  }
  return null;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** The score of the typed text against one name (or one question): its band and closeness, 0 when it isn't there. */
function nameScore(nq: string, qWords: readonly string[], name: Text): number {
  const t = name.text;
  if (!t) return 0;
  if (t === nq) return MATCH.exact;
  // The typed words in order, at the start or at a word's start.
  const at = t.startsWith(nq) ? 0 : t.includes(` ${nq}`) ? t.indexOf(` ${nq}`) + 1 : -1;
  if (at >= 0) {
    const whole = /^(?:es|s)?(?: |$)/.test(t.slice(at + nq.length));
    return MATCH.phrase + (at === 0 ? 0.5 : 0) + (whole ? 0.25 : 0) + 0.24 * (nq.length / t.length);
  }
  // The same, read without spaces, so "i140" and "h1b" find "I-140" and "H-1B".
  const letters = qWords.join("");
  const run = joinedRun(letters, name.words);
  if (run) {
    return MATCH.phrase + (run.first ? 0.5 : 0) + (run.whole ? 0.25 : 0) + 0.24 * (letters.length / t.replace(/ /g, "").length);
  }
  const f = fits(qWords, name.words);
  // How much of the name the typed letters cover: of two names the words open, the shorter is the closer.
  const cover = Math.min(1, qWords.join("").length / Math.max(1, t.replace(/ /g, "").length));
  if (f.every((x) => x >= ONE_LETTER)) return MATCH.words + 0.9 * mean(f) + 0.09 * cover;
  if (f.every((x) => x > 0) || t.includes(nq)) return MATCH.inside + 0.9 * mean(f) + 0.09 * cover;
  return 0;
}

/**
 * How well a row matches what was typed: a band (MATCH) plus a closeness under 1, or a fuzzy score under 1, or 0
 * for no match.
 */
export function matchScore(query: string, row: Rankable): number {
  const nq = normalizeText(query);
  return nq ? scoreRow(nq, nq.split(" "), row, true) : 0;
}

/**
 * matchScore for a query already normalised, so ranking thousands of rows normalises it once. Without `near`, a row
 * the words don't reach scores 0 rather than trying the fuzzy matcher (a long list asks its own index instead).
 */
function scoreRow(nq: string, qWords: readonly string[], row: Rankable, near: boolean): number {
  const p = prepare(row);
  let best = 0;
  for (const n of p.names) best = Math.max(best, nameScore(nq, qWords, n));
  if (best >= MATCH.inside) return best;
  // Every typed word somewhere: the name, a question or the keywords. Words found in the name count for more.
  const all = fits(qWords, p.allWords);
  if (all.every((x) => x > 0)) {
    const inName = fits(qWords, p.names[0]!.words).filter((x) => x >= ONE_LETTER).length / qWords.length;
    best = Math.max(best, MATCH.keywords + 0.5 * inName + 0.49 * mean(all));
  }
  if (best > 0 || !near) return best;
  return nearScore(scoreNormalized(nq, p.fuzzy));
}

/** A fuzzy score as the palette ranks it: under every exact kind of match, and nothing below the floor. */
const nearScore = (fuzzy: number) => (fuzzy >= FUZZY_MIN ? 0.99 * fuzzy : 0);

/**
 * Each long list's letter-triplet index (the site's FuzzyIndex), built the first time the list has no exact match and
 * kept with the list: scoring thousands of names one by one for a near spelling took 20 to 50 ms a key.
 */
const NEAR_INDEX = new WeakMap<readonly Rankable[], FuzzyIndex<number>>();

function nearIndex(rows: readonly Rankable[]): FuzzyIndex<number> {
  let index = NEAR_INDEX.get(rows);
  if (!index) {
    index = new FuzzyIndex(
      rows.map((_, j) => j),
      (j) => rows[j]!.name,
    );
    NEAR_INDEX.set(rows, index);
  }
  return index;
}

/** One group of the palette, before it's ranked. */
export interface RankGroup<T extends Rankable> {
  heading: string;
  rows: readonly T[];
  /** Breaks a tie between groups whose best rows are in the same band: higher first. */
  priority: number;
  /** The most rows shown; every match when absent. */
  limit?: number;
  /**
   * A long list of names (thousands of job titles, cities). Its near spellings come from a letter-triplet index of
   * the names, and only when nothing in it matches better: such a list has a near neighbour for most words ("Nampa,
   * ID" for "tampa"), which would only crowd the real match out of its rows.
   */
  longList?: boolean;
  /**
   * Rows chosen elsewhere (the server's name lookup, its "did you mean"): kept in the order they came, each shown
   * whether or not it scores here. The best of them places the group, and counts at least as a match inside a name:
   * the server found them by name, which beats a page that only mentions the words or spells them nearly.
   */
  given?: boolean;
}

export interface RankedGroup<T extends Rankable> {
  heading: string;
  rows: T[];
  /** The best row's score, what placed the group. */
  best: number;
}

/**
 * The groups with rows that match, best group first, each group's rows best first (ties keep their input order),
 * cut to each group's limit. Empty for an empty query.
 */
export function rankGroups<T extends Rankable>(query: string, groups: readonly RankGroup<T>[]): RankedGroup<T>[] {
  const nq = normalizeText(query);
  if (!nq) return [];
  const qWords = nq.split(" ");
  const out: (RankedGroup<T> & { priority: number; i: number })[] = [];
  groups.forEach((g, i) => {
    const long = g.longList === true && !g.given;
    let scored = g.rows.map((row, j) => ({ row, j, score: scoreRow(nq, qWords, row, !long) }));
    if (long && !scored.some((s) => s.score > 0)) {
      scored = nearIndex(g.rows)
        .search(nq, { limit: g.limit ?? g.rows.length, min: FUZZY_MIN })
        .map((h) => ({ row: g.rows[h.item]!, j: h.item, score: nearScore(h.score) }));
    }
    let best = 0;
    for (const s of scored) if (!s.row.unranked && s.score > best) best = s.score;
    if (g.given) best = Math.max(best, MATCH.inside);
    const kept = g.given ? scored : scored.filter((s) => s.score > 0 && !s.row.unranked).sort((a, b) => b.score - a.score || a.j - b.j);
    const rows = kept.slice(0, g.limit ?? kept.length).map((s) => s.row);
    if (rows.length > 0) out.push({ heading: g.heading, rows, best, priority: g.priority, i });
  });
  out.sort((a, b) => Math.floor(b.best) - Math.floor(a.best) || b.priority - a.priority || b.best - a.best || a.i - b.i);
  return out.map(({ heading, rows, best }) => ({ heading, rows, best }));
}
