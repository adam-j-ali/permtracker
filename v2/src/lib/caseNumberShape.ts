/**
 * What a PERM case number looks like, on the client side of the boundary.
 *
 * THREE MODULES CARRY A CASE-NUMBER RULE AND THAT IS DELIBERATE, because they
 * serve three audiences with genuinely different needs. They are cross-
 * asserted by `caseNumberShape.test.ts` so none can drift silently:
 *
 *   `src/lib/db/caseLookup.ts`      server, `server-only`, owns both rules
 *   `src/lib/caseStatusVocabulary.ts`  alerts, NARROW on purpose (G- only)
 *   this file                          the lookup form, WIDE (G- and A-)
 *
 * The narrow one is not a bug. An alert is only meaningful for a case that
 * can still change, and every A- case in the corpus is decided and years old,
 * so subscribing to one would promise mail that can never arrive.
 *
 * THE WIDE ONE EXISTS BECAUSE THE NARROW ONE WAS REJECTING REAL CASES.
 * Measured on the full tables: `perm_cases` holds 281,691 four-segment
 * `G-100-26125-868956` numbers and **92,248** three-segment `A-23043-00641`
 * ones, peaking at 32,289 in 2022 and 59,106 in 2023. Someone who filed then
 * and typed their real number was told it was malformed.
 *
 * SHAPE ONLY. `parseCaseNumber` in permCaseNumber.ts is stricter because it
 * is decoding a date and a wrong date is worse than a refusal. This is
 * deciding whether a string is worth a database round trip, and a hint that
 * says "not a case number" about a number the server would happily find is
 * the worse failure here.
 */

import { tidyCaseNumber } from "./tidyCaseNumber";

/** The current four-segment form: `G-100-26125-868956`, or an H-2A job order's `JO-A-300-26271-264525`. */
const CURRENT = /^(?:[A-Z]|JO-A)-\d{3}-\d{5}-\d+$/;

/** The legacy three-segment form: `A-23043-00641`. Five digits, then five. */
const LEGACY = /^[A-Z]-\d{5}-\d{5}$/;

/**
 * DOL's FY2008 LCA form, `I-07135-3458699`: an I, five digits, then seven. It's only in DOL's older files
 * (lca_cases_history), where the case page finds it; the box refused it as "not the shape of a case number" until
 * Nov 25 2026. Not the legacy PERM form: nothing date-decodes it.
 */
export const OLD_LCA = /^I-\d{5}-\d{7}$/;

/** Tidied the way a paste needs (`tidyCaseNumber`), or null when it is none of the shapes. */
export function normaliseCaseNumber(input: string): string | null {
  const raw = tidyCaseNumber(input);
  return CURRENT.test(raw) || LEGACY.test(raw) || OLD_LCA.test(raw) ? raw : null;
}

/**
 * Whether a number is the legacy form, which must never be date-decoded.
 *
 * Reading the legacy middle block as YYDDD lands exactly 13.4% of the time
 * and within two days 22.3%, measured over 12,000 of them, against a
 * current-format control at 90.5% and 100% on the same query. Whatever that
 * block is, it is not reliably the filing date.
 */
export function isLegacyCaseNumber(input: string): boolean {
  return LEGACY.test(tidyCaseNumber(input));
}
