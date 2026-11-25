import { parseISO, format, addDays, subDays } from 'date-fns';
import { isBusinessDay } from './holidays';

/**
 * Add N business days to a date, skipping weekends and federal holidays.
 *
 * @param startDate - ISO date string (YYYY-MM-DD)
 * @param days - Number of business days to add
 * @returns ISO date string after adding N business days
 *
 * @example
 * addBusinessDays('2025-01-15', 10) // '2025-01-29' (skips weekends and MLK Day)
 */
export function addBusinessDays(startDate: string, days: number): string {
  let date = parseISO(startDate);
  let added = 0;

  while (added < days) {
    date = addDays(date, 1);
    const dateStr = format(date, 'yyyy-MM-dd');
    if (isBusinessDay(dateStr)) {
      added++;
    }
  }

  return format(date, 'yyyy-MM-dd');
}

/**
 * Subtract N business days from a date, walking backward and skipping weekends and federal holidays.
 *
 * @param startDate - ISO date string (YYYY-MM-DD)
 * @param days - Number of business days to subtract
 * @returns ISO date string after subtracting N business days
 *
 * @example
 * subtractBusinessDays('2025-01-30', 10) // '2025-01-15' (skips weekends and MLK Day)
 */
export function subtractBusinessDays(startDate: string, days: number): string {
  let date = parseISO(startDate);
  let subtracted = 0;

  while (subtracted < days) {
    date = subDays(date, 1);
    const dateStr = format(date, 'yyyy-MM-dd');
    if (isBusinessDay(dateStr)) {
      subtracted++;
    }
  }

  return format(date, 'yyyy-MM-dd');
}

/**
 * The day itself when it's a business day, or the next one that is. The rule for a period's last day in USCIS's
 * chapter of the regulations (8 CFR 1.2, "Day"): when it "falls on a Saturday, Sunday, or a legal holiday, the period
 * shall run until the end of the next day which is not a Saturday, Sunday, or a legal holiday."
 *
 * @example
 * onOrNextBusinessDay('2024-03-16') // '2024-03-18' (Saturday to Monday)
 */
export function onOrNextBusinessDay(date: string): string {
  let day = parseISO(date);
  while (!isBusinessDay(format(day, 'yyyy-MM-dd'))) day = addDays(day, 1);
  return format(day, 'yyyy-MM-dd');
}

/**
 * Count business days between two dates (inclusive), skipping weekends and federal holidays.
 *
 * @param startDate - ISO date string (YYYY-MM-DD)
 * @param endDate - ISO date string (YYYY-MM-DD)
 * @returns Number of business days between dates (inclusive)
 *
 * @example
 * countBusinessDays('2025-01-01', '2025-01-10') // 7 (skips New Year and weekends)
 */
export function countBusinessDays(startDate: string, endDate: string): number {
  let count = 0;
  let current = parseISO(startDate);
  const end = parseISO(endDate);

  // Return 0 if end is before start
  if (end < current) {
    return 0;
  }

  while (current <= end) {
    const dateStr = format(current, 'yyyy-MM-dd');
    if (isBusinessDay(dateStr)) {
      count++;
    }
    current = addDays(current, 1);
  }

  return count;
}
