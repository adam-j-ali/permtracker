/**
 * What this browser remembers about a case it has looked up: the day it asked for emails about the case, and the
 * days it came back to check it.
 *
 * WHY. Most visits to a case's page are someone checking the same case again, from a bookmark or a tab left
 * open. Two things followed from the page not knowing that. Someone who had already asked for
 * emails was shown the sign-up form on every visit, and someone on a fifth check was told nothing a first-time
 * visitor wasn't. The page now says "you asked for emails about this case on Nov 9" in place of the form, and
 * tells a returning checker how many days they've checked, beside the offer to check for them.
 *
 * WHERE IT LIVES. In this browser's own storage, under the case number. It's never sent anywhere and never read
 * by the server: nothing here is an account. Clearing the browser's site data clears it, and a private window
 * keeps it for the visit.
 *
 * NEVER PROOF OF A SUBSCRIPTION. The day is the day the form was sent from this browser. Whether the address was
 * confirmed is known only to the server, which tells nobody (convex/caseAlerts.ts), so the page's words say
 * "you asked", never "you're subscribed".
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const ASKED = "pt-watch:";
const CHECKS = "pt-checks:";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The check days kept for one case: enough for a wait of months, small enough to stay a few hundred bytes. */
export const CHECK_DAYS_KEPT = 120;

/** This page's storage, or null where the browser refuses it. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The day this browser asked for emails about the case, "YYYY-MM-DD", or null. */
export function readAsked(store: KeyValueStore | null, caseNumber: string): string | null {
  try {
    const day = store?.getItem(ASKED + caseNumber) ?? null;
    return day && ISO_DAY.test(day) ? day : null;
  } catch {
    return null;
  }
}

export function rememberAsked(store: KeyValueStore | null, caseNumber: string, day: string): void {
  if (!ISO_DAY.test(day)) return;
  try {
    store?.setItem(ASKED + caseNumber, day);
  } catch {
    // Storage full or refused: the form's own confirmation still shows for this visit.
  }
}

export function forgetAsked(store: KeyValueStore | null, caseNumber: string): void {
  try {
    store?.removeItem(ASKED + caseNumber);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

function readDays(store: KeyValueStore | null, caseNumber: string): string[] {
  try {
    const raw = store?.getItem(CHECKS + caseNumber);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string" && ISO_DAY.test(d)) : [];
  } catch {
    return [];
  }
}

/**
 * Note that the case was checked today, and say on how many different days this browser has checked it (today
 * included). A second look on the same day counts once. With no storage the answer is 1: this visit.
 */
export function noteCheck(store: KeyValueStore | null, caseNumber: string, today: string): number {
  if (!ISO_DAY.test(today)) return 1;
  const days = [...new Set([...readDays(store, caseNumber), today])].sort().slice(-CHECK_DAYS_KEPT);
  try {
    store?.setItem(CHECKS + caseNumber, JSON.stringify(days));
  } catch {
    // The count for this visit is still right.
  }
  return days.length;
}

/** The different days on record for the case, without adding one. */
export function checkDays(store: KeyValueStore | null, caseNumber: string): number {
  return readDays(store, caseNumber).length;
}

const CHANGED = "pt:case-watch";

/** Tell this page's readers that what's remembered changed (a sign-up, a check noted, "ask again"). */
export function announceWatchChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/** Subscribe to those changes, and to another tab's (`storage`). For useSyncExternalStore. */
export function subscribeWatch(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}
