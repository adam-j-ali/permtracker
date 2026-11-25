import { PREMIUM_I140_BUSINESS_DAYS, PREMIUM_I140_E13_E21_BUSINESS_DAYS } from '../constants';
import { addBusinessDays } from '../dates/businessDays';
import { validateISODate } from '../dates';

/**
 * The day USCIS must act on a premium I-140 by. USCIS, "How Do I Request Premium Processing?" (last reviewed Nov 10
 * 2026): the period begins when USCIS receives a properly completed I-907 at the correct address, and within it USCIS
 * approves, denies, sends a request for evidence or a notice of intent to deny, or opens a fraud investigation, or it
 * refunds the premium fee. A request for evidence or a notice of intent to deny stops the period, and a new one begins
 * when USCIS receives the response, so the same count runs from that day.
 *
 * 8 CFR 106.4 (eCFR, read Nov 25 2026): 15 business days for most I-140 classes, 45 for EB-1C and a national interest
 * waiver ((e)(17), (e)(18)). The 15-day count starts when USCIS receives the form and fee ((f)(2)(i)); the 45-day count
 * starts when it has received "all prerequisites for adjudication", the form and the fee ((f)(2)(ii)), which is
 * usually the same day for an I-140 filed whole. A business day is one federal offices are open ((e)(22)).
 *
 * Business days leave out weekends and federal holidays (addBusinessDays). A day federal offices close for weather
 * doesn't count either, and no calculator can know one in advance: the page says so.
 */
export const I140_PREMIUM_BUSINESS_DAYS = {
  standard: PREMIUM_I140_BUSINESS_DAYS,
  e13OrNiw: PREMIUM_I140_E13_E21_BUSINESS_DAYS,
} as const;

export type I140PremiumClass = keyof typeof I140_PREMIUM_BUSINESS_DAYS;

/** The last business day of the period that began on `receivedOn` (the I-907, or the answer to an RFE or NOID). */
export function premiumActionDeadline(receivedOn: string, cls: I140PremiumClass): string {
  validateISODate(receivedOn, 'receivedOn');
  return addBusinessDays(receivedOn, I140_PREMIUM_BUSINESS_DAYS[cls]);
}
