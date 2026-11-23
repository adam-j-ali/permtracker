/**
 * The visitor's recent searches: what they searched for in a box on this site, so every box can offer it again.
 *
 * WHERE IT LIVES. In this browser's own storage, under one key, as a short list of `{ label, href, at }`: the words
 * as a person reads them, the page that answers them, and when. It's never sent anywhere and never read by the
 * server. "Clear" under any box empties it, signing out empties it (`AuthContext.beginSignOut`), and clearing the
 * site's data in the browser does too.
 *
 * WHAT IT KEEPS. Only what was searched for: a DOL case number in its own shape, or a name, a few words, a code. Never
 * a USCIS receipt number (the USCIS page keeps those only when someone saves one, `SavedReceipts`), and never text
 * shaped like an email address, a phone number or a Social Security number, which no search box asks for. The rule
 * is applied when a search is kept and again when the list is read, so an entry kept under an older rule goes.
 *
 * GUARDED. A private window, blocked site data or a full quota makes storage throw; every read and write here is
 * caught, and the boxes work the same with no list.
 */

import { browserStore, type KeyValueStore } from "@/lib/caseWatchMemory";
import { normaliseCaseNumber } from "@/lib/caseNumberShape";
import { looksLikeReceipt } from "@/lib/uscis/receipt";
import { isSignedInPath } from "@/lib/auth/signedInSections";

export interface RecentSearch {
  /** What was searched for, as it's shown. */
  label: string;
  /** The page on this site that answers it. */
  href: string;
  /** When, in milliseconds since 1970. */
  at: number;
}

export const RECENT_SEARCHES_KEY = "pt:recent-searches";
/** The searches kept, newest first. */
export const RECENT_SEARCHES_KEPT = 8;
/** The longest label kept: an employer's full legal name fits. */
export const RECENT_LABEL_MAX = 100;
/** A search that grows the newest one, on the same page within this long, replaces it ("acm", then "acme"). */
export const REFINE_WITHIN_MS = 2 * 60 * 1000;
/** The longest address kept. A search's page with its filters is a few hundred characters at most. */
const HREF_MAX = 1000;

/** The shortest search worth keeping. */
const LABEL_MIN = 2;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** Seven digits in a row: a phone number, an A-Number or an SSN typed without its dashes. */
const DIGIT_RUN = /\d{7}/;
const PHONE = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
/** Begins the way a DOL case number does, with enough digits to be one: kept only when it is one. */
const CASE_NUMBER_TRY = /^[A-Z]-\d{3}/i;
const CASE_NUMBER_TRY_DIGITS = 8;

/**
 * What a search box keeps of what was typed or picked, or null for nothing. A case number in its own shape; any other
 * search with its spaces tidied and cut to `RECENT_LABEL_MAX`.
 */
export function recentSearchLabel(typed: string): string | null {
  const text = typed.replace(/\s+/g, " ").trim();
  if (text.length < LABEL_MIN) return null;
  const caseNumber = normaliseCaseNumber(text);
  if (caseNumber) return caseNumber;
  if (looksLikeReceipt(text)) return null;
  if (EMAIL.test(text) || DIGIT_RUN.test(text) || PHONE.test(text) || SSN.test(text)) return null;
  if (CASE_NUMBER_TRY.test(text) && (text.match(/\d/g) ?? []).length >= CASE_NUMBER_TRY_DIGITS) return null;
  return text.slice(0, RECENT_LABEL_MAX).trim();
}

/** The address, when it's a page on this site: a path from the root, never another host or a script. */
export function safeSearchHref(href: string): string | null {
  if (href.length === 0 || href.length > HREF_MAX) return null;
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return null;
  // Spaces and control characters never appear in an address a page builds.
  if (/[\s\u0000-\u001f\u007f]/.test(href)) return null;
  return href;
}

/** The page part of an address, without its query or fragment. */
export function pathOf(href: string): string {
  return href.split(/[?#]/, 1)[0] ?? href;
}

/**
 * The address that reopens a box's search on the page it was made on: the same page and its other filters, the box's
 * own field set to the search, and the page count dropped so the answer opens at its start.
 */
export function hrefWithSearch(currentHref: string, field: string, search: string): string {
  const url = new URL(currentHref);
  url.searchParams.set(field, search);
  url.searchParams.delete("page");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A recent search's entry as kept, or null when the rule refuses it. */
function entry(label: unknown, href: unknown, at: unknown): RecentSearch | null {
  if (typeof label !== "string" || typeof href !== "string" || typeof at !== "number" || !Number.isFinite(at)) return null;
  const kept = recentSearchLabel(label);
  const safe = safeSearchHref(href);
  return kept && safe ? { label: kept, href: safe, at } : null;
}

const sameWords = (a: RecentSearch, b: RecentSearch) => a.label.toLowerCase() === b.label.toLowerCase();
const samePage = (a: RecentSearch, b: RecentSearch) => a.href.toLowerCase() === b.href.toLowerCase();

/** The list with one search added at the top: once only, a refinement in place of what it grew from, capped. */
function withSearch(list: readonly RecentSearch[], next: RecentSearch): RecentSearch[] {
  const newest = list[0];
  const refines =
    newest !== undefined &&
    pathOf(newest.href) === pathOf(next.href) &&
    next.at - newest.at <= REFINE_WITHIN_MS &&
    next.label.toLowerCase().startsWith(newest.label.toLowerCase());
  const rest = list.filter((s, i) => !(i === 0 && refines) && !sameWords(s, next) && !samePage(s, next));
  return [next, ...rest].slice(0, RECENT_SEARCHES_KEPT);
}

/** The list as stored, read past anything malformed: newest first, each search once, capped. */
export function parseRecentSearches(raw: string | null): RecentSearch[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries = parsed
    .map((p) => (p && typeof p === "object" ? entry((p as RecentSearch).label, (p as RecentSearch).href, (p as RecentSearch).at) : null))
    .filter((s): s is RecentSearch => s !== null)
    .sort((a, b) => b.at - a.at);
  const out: RecentSearch[] = [];
  for (const s of entries) {
    if (out.length === RECENT_SEARCHES_KEPT) break;
    if (!out.some((o) => sameWords(o, s) || samePage(o, s))) out.push(s);
  }
  return out;
}

/** The stored text as it is, or null. One string, so a React snapshot of it stays equal while nothing changes. */
export function readRecentSearchesRaw(store: KeyValueStore | null = browserStore()): string | null {
  try {
    return store?.getItem(RECENT_SEARCHES_KEY) ?? null;
  } catch {
    return null;
  }
}

export function readRecentSearches(store: KeyValueStore | null = browserStore()): RecentSearch[] {
  return parseRecentSearches(readRecentSearchesRaw(store));
}

const CHANGED = "pt:recent-searches";

function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/**
 * Keep a search at the top of the list. Returns the entry kept, or null when the rule refuses it or storage won't
 * take it: the search itself goes ahead either way.
 */
export function recordSearch(
  search: { label: string; href: string },
  store: KeyValueStore | null = browserStore(),
  now: number = Date.now(),
): RecentSearch | null {
  const next = entry(search.label, search.href, now);
  if (!next || !store) return null;
  try {
    store.setItem(RECENT_SEARCHES_KEY, JSON.stringify(withSearch(readRecentSearches(store), next)));
  } catch {
    // Storage full or refused: the search goes ahead, kept nowhere.
    return null;
  }
  announce();
  return next;
}

export function clearRecentSearches(store: KeyValueStore | null = browserStore()): void {
  try {
    store?.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Nothing could be kept, so nothing is left to clear.
  }
  announce();
}

/** The searches a box on a public page offers: none that opens a page of the signed-in app. */
export function publicSearches(list: readonly RecentSearch[]): RecentSearch[] {
  return list.filter((s) => !isSignedInPath(pathOf(s.href)));
}

/**
 * Subscribe to changes made on this page and in another tab (the browser's `storage` event, which arrives with no
 * key when a tab clears the site's whole storage). For useSyncExternalStore.
 */
export function subscribeRecentSearches(onChange: () => void): () => void {
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key === RECENT_SEARCHES_KEY || e.key === null) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", fromOtherTab);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", fromOtherTab);
  };
}
