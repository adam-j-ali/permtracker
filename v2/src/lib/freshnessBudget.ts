/**
 * How old a dataset's figures may get before the page says they may be out of date. Plain module: the freshness
 * reader (src/lib/db/publicData.ts) and its test read it.
 */

/**
 * The budget of any dataset built from a DOL quarterly file: scripts/lib_db.py QUARTERLY_FILE_MAX_AGE_DAYS, where
 * the measurement is (DOL posts a quarter 62 to 125 days after it ends). A row stamped with less by an older script
 * (entities and daily-decisions carried 135 until Nov 17 2026) would warn on every page that reads it for weeks
 * before DOL's next file could exist; the larger budget holds. `freshnessBudget.test.ts` reads the Python constant.
 */
export const QUARTERLY_FILE_MAX_AGE_DAYS = 220;

/** The budget a row is judged by: its own, never less than the quarterly file's for a quarterly dataset. */
export function budgetFor(cadence: string, maxAgeDays: number | null): number | null {
  if (maxAgeDays === null) return null;
  return /quarterly/i.test(cadence) ? Math.max(maxAgeDays, QUARTERLY_FILE_MAX_AGE_DAYS) : maxAgeDays;
}
