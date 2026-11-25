import { addDays, differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

/**
 * The 90 days to file the I-751 that removes the conditions on a two-year green card, read on Nov 25 2026 from:
 *
 *  - 8 CFR 216.4(a)(1) (eCFR, current to Nov 23 2026): the joint petition is filed "within the 90-day period
 *    immediately preceding the second anniversary of the date on which the alien obtained permanent residence", and
 *    216.4(a)(6): failing to file in it ends the status, unless USCIS accepts good cause for filing late.
 *  - USCIS, "When to File Your Petition to Remove Conditions": the second anniversary is the date under "Card expires",
 *    and its filing calculator gives April 1, 2023 for a card expiring June 30, 2023: the date less 90 days. So the
 *    90 days run from there to the day before the card's date, and the card's own date is past them.
 *  - 8 CFR 103.2(a)(7)(i): USCIS records a filing on the day it arrives, so the petition has to arrive inside them.
 *
 * Arithmetic only. A waiver of the joint filing can be asked for at any time before the status ends, and a child who
 * got status more than 90 days after the parent files alone; the page says so.
 */

export const I751_FILING_WINDOW_DAYS = 90;

export interface I751WindowInput {
  /** The date under "Card expires" on the conditional green card: the second anniversary. */
  cardExpires: string;
  today: string;
}

export interface I751WindowResult {
  /** The first day of the 90: the card's date less 90 days. */
  opens: string;
  /** The last of the 90: the day before the card's date. */
  lastDay: string;
  expires: string;
  /** Where today sits: before the window, in it, or past it. */
  stage: "early" | "open" | "late";
  /** Days until the window opens, while it hasn't. */
  daysToOpen: number | null;
  /** Days left in the window, today counted, while it's open. */
  daysLeft: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => format(d, "yyyy-MM-dd");

function day(name: string, v: string): Date {
  const d = parseISO(v);
  if (!DATE_RE.test(v) || !isValid(d) || iso(d) !== v) throw new Error(`${name}: expected a real date as YYYY-MM-DD, got ${JSON.stringify(v)}`);
  return d;
}

export function i751FilingWindow(input: I751WindowInput): I751WindowResult {
  const expires = day("cardExpires", input.cardExpires);
  const today = day("today", input.today);
  const opens = addDays(expires, -I751_FILING_WINDOW_DAYS);
  const lastDay = addDays(expires, -1);
  const stage = today < opens ? "early" : today > lastDay ? "late" : "open";
  return {
    opens: iso(opens),
    lastDay: iso(lastDay),
    expires: input.cardExpires,
    stage,
    daysToOpen: stage === "early" ? differenceInCalendarDays(opens, today) : null,
    daysLeft: stage === "open" ? differenceInCalendarDays(lastDay, today) + 1 : null,
  };
}
