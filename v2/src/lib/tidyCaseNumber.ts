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
 * - a label in front: "Case number:", "DOL case #", "PERM Case No.";
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
/**
 * A label pasted in front of the number: "Case number:", "DOL case #", "PERM Case No.". Whole words only, so a name that
 * starts with "Casey" keeps its letters (Batch 5, Nov 25 2026).
 */
const LABEL_WORD = /^(?:DOL|PERM|ETA|FLAG)\s+/;
const LABEL_CASE = /^CASE\b\s*(?:NUMBER|NO\.|NO|#)?\s*[:#.]?\s*/;
/** The label off the front, when there is one: any of the words above, then "CASE" and its "number". No pattern repeats
 * inside another, so none can backtrack; a paste whose words don't reach "CASE" keeps them. */
function stripLabel(s: string): string {
  let rest = s;
  while (LABEL_WORD.test(rest)) rest = rest.replace(LABEL_WORD, "");
  return LABEL_CASE.test(rest) ? rest.replace(LABEL_CASE, "") : s;
}
/** Quotes and brackets a number arrives inside, and the punctuation a sentence leaves after it. */
const LEADING = /^["'(\[‘“]+/;
const TRAILING = /["')\].,;:!?’”]+$/;
/**
 * Anything but letters, digits and spaces. A trimmed string with none of these and a space in it is groups of letters
 * and digits separated by spaces: a number typed with spaces for its dashes. Two flat tests, no nested quantifier.
 */
const NOT_GROUPS = /[^A-Z0-9\s]/;
/** The current form with every dash lost. */
const FOURTEEN = /^([A-Z])(\d{3})(\d{5})(\d{6})$/;

/**
 * The longest paste worth tidying. The longest number DOL issues is 21 characters (`JO-A-300-26271-264525`); a
 * `?case=` from a stranger can be any length, and the length check goes before any pattern that could backtrack.
 */
const TIDY_MAX = 64;

export function tidyCaseNumber(input: string): string {
  // Too long to be a case number with its sentence around it: upper-cased only, for the shape rules to refuse.
  if (input.length > TIDY_MAX) return input.toUpperCase();
  let s = input.toUpperCase().replace(INVISIBLE, "").replace(DASHES, "-").trim();
  s = stripLabel(s).replace(LEADING, "").replace(TRAILING, "").trim();
  const spacedGroups = /\s/.test(s) && !NOT_GROUPS.test(s);
  s = spacedGroups ? s.replace(/\s+/g, "-") : s.replace(/\s+/g, "");
  const bare = FOURTEEN.exec(s);
  if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}-${bare[4]}`;
  // One letter glued to digits whose own dashes are there: the letter's dash goes back.
  return s.replace(/^([A-Z])(?=\d+-\d)/, "$1-");
}
