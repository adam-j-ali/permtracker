/**
 * A day on the reader's own calendar, as an ISO day, for code that counts from the reader's own dates in the browser.
 * `toISOString()` is UTC, which after about 8 PM Eastern is already tomorrow. Server pages count DOL's dates in UTC
 * days on purpose (CaseStatusPage's todayUtc); this is for the browser. Nine calculators and the case import typed it
 * each until Nov 25 2026; src/lib/__tests__/one-home-per-rule.test.ts keeps it here.
 */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today on the reader's own calendar. */
export function readerToday(now: Date = new Date()): string {
  return localDay(now);
}
