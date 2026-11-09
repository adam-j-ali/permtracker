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

/**
 * A wage determination's last day on a decided case's record: the rule's day, read against the
 * expiration DOL's wage disclosure file lists for it.
 *
 * THE FILE LISTS EACH EXPIRATION ONE DAY BEFORE THE DETERMINATION'S OWN (June 29 for June 30, +89
 * days for +90). Checked on November 9, 2026 against the dates employers typed from their own
 * determinations on the old ETA-9089: of 30,185 determinations in both sources, the file was
 * exactly one day earlier on 30,116. So a file date that is the rule's day or the day before it is
 * the rule's day. NEVER move `calculatePWDExpiration` to match the file.
 *
 * Any other file date is kept as DOL lists it and marked `asListed`, so the page can say whose
 * date it is: the file may know something the determination date alone doesn't.
 */
export function pwdExpirationOnRecord(
  determinationDate: string,
  listed: string | null | undefined,
): { date: string; asListed: boolean } {
  const rule = calculatePWDExpiration(determinationDate);
  if (!listed) return { date: rule, asListed: false };
  const [y, m, d] = rule.split('-').map(Number) as [number, number, number];
  const dayBefore = formatUTC(addDaysUTC(new Date(Date.UTC(y, m - 1, d)), -1));
  return listed === rule || listed === dayBefore ? { date: rule, asListed: false } : { date: listed, asListed: true };
}
