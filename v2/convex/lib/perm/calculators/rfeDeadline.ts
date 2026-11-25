import { addDays, format, getDay, isValid, parseISO } from "date-fns";

import { onOrNextBusinessDay } from "../dates/businessDays";
import { federalHolidayName } from "../dates/holidays";

/**
 * The day USCIS must receive the answer to a request for evidence (RFE) or a notice of intent to deny (NOID), as the
 * USCIS Policy Manual states the rule (1 USCIS-PM E.6(F), "Timeframe for Response", current as of Nov 20 2026), each
 * part from its regulation (eCFR, current to Nov 23 2026):
 *
 *  - The notice states the deadline. The period it gives is at most twelve weeks (84 days) for an RFE and 30 days for a
 *    NOID, and no more time may be granted (8 CFR 103.2(b)(8)(iv)). USCIS gives 30 days for the I-539, the I-601A and
 *    the N-400, and 84 for every other form, by the Policy Manual's tables.
 *  - Served by mail, 3 days are added, and service is complete on mailing (8 CFR 103.8(b)): "a maximum of 87 days
 *    after USCIS mailed the RFE." Served to the online account or in person, nothing is added.
 *  - A last day on a Saturday, Sunday or federal holiday runs to the end of the next day that is none of them
 *    (8 CFR 1.2, "Day"), which USCIS applies to a mailed response.
 *  - The response must arrive by then; one sent through the online account counts the day it's submitted.
 *
 * Arithmetic only: the date printed on the notice is the one USCIS holds the response to.
 */

export const USCIS_MAIL_DAYS = 3;
export const RFE_MAX_RESPONSE_DAYS = 84;
export const NOID_MAX_RESPONSE_DAYS = 30;

export interface RfeDeadlineInput {
  /** The date on the notice: the day USCIS mailed it or posted it to the account. */
  noticeDate: string;
  /** The response period the notice gives, in calendar days. */
  responseDays: number;
  /** USCIS mailed the notice (3 days added), rather than posting it to the online account. */
  mailed: boolean;
}

export interface RfeDeadlineResult {
  /** The notice date plus the period and any mailing days. */
  counted: string;
  /** The day the response must arrive: `counted`, or the next business day after it. */
  due: string;
  /** Why the counted day moved: "Saturday", "Sunday" or the holiday's name; null when it didn't. */
  movedBecause: string | null;
  mailDays: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function rfeResponseDeadline(input: RfeDeadlineInput): RfeDeadlineResult {
  const notice = parseISO(input.noticeDate);
  if (!DATE_RE.test(input.noticeDate) || !isValid(notice) || iso(notice) !== input.noticeDate) {
    throw new Error(`noticeDate: expected a real date as YYYY-MM-DD, got ${JSON.stringify(input.noticeDate)}`);
  }
  const days = input.responseDays;
  if (!Number.isInteger(days) || days < 1 || days > RFE_MAX_RESPONSE_DAYS) {
    throw new RangeError(`responseDays: expected whole days from 1 to ${RFE_MAX_RESPONSE_DAYS}, got ${days}`);
  }
  const mailDays = input.mailed ? USCIS_MAIL_DAYS : 0;
  const countedDay = addDays(notice, days + mailDays);
  const counted = iso(countedDay);
  const due = onOrNextBusinessDay(counted);
  const weekday = getDay(countedDay);
  const movedBecause = due === counted ? null : weekday === 6 ? "Saturday" : weekday === 0 ? "Sunday" : federalHolidayName(counted);
  return { counted, due, movedBecause, mailDays };
}
