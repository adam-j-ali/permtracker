import { addDaysUTC, formatUTC, validateISODate } from '../dates';

/**
 * Calculate PWD expiration date based on determination date.
 *
 * Rules (20 CFR 656.40(c)):
 * - Case 1: April 2 - June 30 -> determination + 90 days
 * - Case 2: July 1 - December 31 -> June 30 of following year
 * - Case 3: January 1 - April 1 -> June 30 of same year
 *
 * @param determinationDate - The PWD determination date (ISO string YYYY-MM-DD)
 * @returns The PWD expiration date (ISO string YYYY-MM-DD)
 *
 * @example
 * calculatePWDExpiration('2024-05-15') // '2024-08-13' (Case 1: +90 days)
 * calculatePWDExpiration('2024-09-10') // '2025-06-30' (Case 2: next June 30)
 * calculatePWDExpiration('2024-02-05') // '2024-06-30' (Case 3: same June 30)
 */
export function calculatePWDExpiration(determinationDate: string): string {
  validateISODate(determinationDate, 'determinationDate');
  // Read the calendar date from the string itself. validateISODate returns local midnight, and its UTC fields
  // are the day before anywhere east of UTC: a July 1 determination read in India became June 30 (+90 days).
  const [year, monthOneBased, day] = determinationDate.split('-').map(Number) as [number, number, number];
  const month = monthOneBased - 1; // 0-indexed (0 = Jan, 11 = Dec)
  const date = new Date(Date.UTC(year, month, day));

  // Case 1: April 2 - June 30 (90 days)
  const isApril2OrLater = month === 3 && day >= 2;
  const isMayOrJune = month === 4 || month === 5;
  if (isApril2OrLater || isMayOrJune) {
    return formatUTC(addDaysUTC(date, 90));
  }

  // Case 2: July 1 - December 31 (June 30 of following year)
  if (month >= 6) {
    return `${year + 1}-06-30`;
  }

  // Case 3: January 1 - April 1 (June 30 of same year)
  return `${year}-06-30`;
}
