/**
 * A DOL case number as it was pasted, tidied for the shape rules to judge. It never judges: what comes back is
 * upper-cased text, and each module's own rule decides whether it's a case number.
 *
 * ONE TIDY FOR EVERY RULE. The lookup box (`caseNumberShape.ts`), the alerts (`caseStatusVocabulary.ts`), the server
 * (`db/caseLookup.ts`), the program tables (`db/flagCases.ts`) and the program test (`flagCaseNumber.ts`) all read a
 * number through this. A number tidied one way by the box and another by the server would be one the box accepts and
 * the server can't find; `caseNumberShape.test.ts` holds every module to it.
 *
 * WHAT A PASTE BRINGS, and what each step answers (the box refused every one of these until Nov 23 2026):
 * - a typographic dash for the plain one, from a PDF or a word processor: U+2010 to U+2015, the minus sign, and the
 *   small and full-width hyphens;
 * - spaces where the dashes were ("G 100 26125 868956"), read as dashes only when the number has no dash at all, so a
 *   space inside a dashed number is removed, as it always was;
 * - the sentence around it: a full stop, a comma or a bracket on the end, quotes or a bracket in front;
 * - no dashes at all: one letter and 14 digits is the current form, `G-100-26125-868956`;
 * - a lost dash after the letter when the rest has its dashes (`G100-26125-868956`);
 * - characters nobody sees: a zero-width space, a byte-order mark, a soft hyphen.
 *
 * Plain module with no imports, so Convex, the browser and the server can all load it.
 */

/** Dashes a paste turns the plain hyphen into. */
const DASHES = /[‐-―−﹘﹣－]/g;
/** Characters with no width that a PDF or a web page copies along. */
const INVISIBLE = /[­​-‍⁠﻿]/g;
/** Quotes and brackets a number arrives inside, and the punctuation a sentence leaves after it. */
const LEADING = /^["'(\[‘“]+/;
const TRAILING = /["')\].,;:!?’”]+$/;
/** Groups of letters and digits separated by spaces and nothing else: a number typed with spaces for its dashes. */
const SPACED_GROUPS = /^[A-Z0-9]+(?:\s+[A-Z0-9]+)+$/;
/** The current form with every dash lost. */
const FOURTEEN = /^([A-Z])(\d{3})(\d{5})(\d{6})$/;

export function tidyCaseNumber(input: string): string {
  let s = input.toUpperCase().replace(INVISIBLE, "").replace(DASHES, "-").trim();
  s = s.replace(LEADING, "").replace(TRAILING, "").trim();
  s = SPACED_GROUPS.test(s) ? s.replace(/\s+/g, "-") : s.replace(/\s+/g, "");
  const bare = FOURTEEN.exec(s);
  if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}-${bare[4]}`;
  // One letter glued to digits whose own dashes are there: the letter's dash goes back.
  return s.replace(/^([A-Z])(?=\d+-\d)/, "$1-");
}
