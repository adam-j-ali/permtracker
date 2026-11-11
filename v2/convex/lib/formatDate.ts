/**
 * Date formatting utilities for notification emails and logs.
 */

/**
 * Format a date for notification display, as the Eastern day it falls on.
 *
 * @example formatDateForNotification(Date.now()) // "February 5, 2026"
 * @example formatDateForNotification(Date.now(), true) // "Thursday, February 5, 2026"
 */
export function formatDateForNotification(
  timestamp: number | Date,
  includeWeekday = false,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  // Eastern, as every other dated email: the server's own zone is UTC, which
  // is already tomorrow from about 7 PM Eastern.
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(includeWeekday ? { weekday: "long" as const } : {}),
  };
  return date.toLocaleDateString("en-US", options);
}
