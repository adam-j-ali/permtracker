/**
 * A pasted list of DOL case numbers, read.
 *
 * Someone who keeps track of many cases has them in a spreadsheet or an email, not one at a time. This reads
 * whatever they paste: one number per line, numbers separated by commas or spaces, or whole spreadsheet rows
 * with other columns beside the number. The form uses it to say how many numbers it read before anything is
 * sent, and the server uses the same function on what arrives, so the two can't disagree about what a number is.
 *
 * What counts as a case number is `normaliseFlagCaseNumber` and nothing else: this file splits text into
 * candidates and asks that one rule about each.
 */
import { normaliseFlagCaseNumber } from "./flagCaseNumber";

/**
 * How many cases one email address may watch, and so how many one list may hold. The server's ceiling
 * (`MAX_CASES_PER_ADDRESS` in convex/caseAlerts.ts) is this same constant.
 */
export const CASES_PER_ADDRESS = 100;

/**
 * How many entries of a list request the server looks at. The form sends case numbers only, each once, so this
 * is generous; it bounds what a hand-written request can make the server read.
 */
export const LIST_ENTRIES_MAX = 400;

/** A paste longer than this is cut before it's read: 100 spreadsheet rows fit many times over. */
export const LIST_TEXT_MAX = 40_000;

/** No case number is longer than this; a longer candidate isn't asked about. */
const CANDIDATE_MAX = 64;

/** What separates one candidate from the next inside a line. */
const SEPARATORS = /[\s,;|"'()[\]<>]+/;

export interface CaseListRead {
  /** Each case number once, normalised, in the order first seen. Not capped: the caller says what's over. */
  numbers: string[];
  /** Lines with something on them and no case number, trimmed and cut to 40 characters, in order. */
  unread: string[];
  /** How many times a number already read turned up again. */
  repeats: number;
}

/** One candidate, with the punctuation a sentence or a cell leaves around it taken off. */
function bare(candidate: string): string {
  return candidate.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

/** The case number in one candidate, or null. */
function numberIn(candidate: string): string | null {
  const text = bare(candidate);
  if (text.length === 0 || text.length > CANDIDATE_MAX) return null;
  return normaliseFlagCaseNumber(text)?.caseNumber ?? null;
}

/** Candidates to case numbers: each once, normalised, in the order first seen. */
export function uniqueCaseNumbers(candidates: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const number = numberIn(candidate);
    if (number) seen.add(number);
  }
  return [...seen];
}

/** Read a pasted block of text. */
export function readCaseList(text: string): CaseListRead {
  const seen = new Set<string>();
  const unread: string[] = [];
  let repeats = 0;
  for (const line of text.slice(0, LIST_TEXT_MAX).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let found = 0;
    for (const candidate of trimmed.split(SEPARATORS)) {
      const number = numberIn(candidate);
      if (!number) continue;
      found += 1;
      if (seen.has(number)) repeats += 1;
      else seen.add(number);
    }
    if (found === 0) unread.push(trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed);
  }
  return { numbers: [...seen], unread, repeats };
}
