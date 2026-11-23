/**
 * Units of time and the Eastern calendar day, shared by Convex and the site.
 * Pure: no Convex imports, so a page, a component and a Convex function all
 * count a day the same way.
 *
 * src/ imports these through `@/lib/time`; anything Convex bundles (Convex
 * functions, src/emails and the src/lib modules they import) imports this
 * file by relative path.
 */

export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 365.25 / 12 = 30.4375: the mean calendar month, for turning days into months. */
export const DAYS_PER_MONTH = 365.25 / 12;

/**
 * The mean month rounded to two places. Kept apart from DAYS_PER_MONTH
 * because the figures that use it were published with it, and the exact
 * value can move a rounded month count or a projected day by one.
 */
export const DAYS_PER_MONTH_2DP = 30.44;

/**
 * The zone DOL, USCIS and this site's readers count days in. After 8 PM
 * Eastern a UTC date is already tomorrow, so anything that says "today" or
 * names a day is computed in this zone.
 */
export const EASTERN_TIMEZONE = "America/New_York";

const ISO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: EASTERN_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TIMEZONE, hour: "numeric", minute: "2-digit" });
const SHORT_DAY = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TIMEZONE, month: "short", day: "numeric" });

/** The Eastern calendar day of an instant, "YYYY-MM-DD". */
export function easternDay(at: Date | number = new Date()): string {
  return ISO_DAY.format(at);
}

/**
 * The calendar day of an instant in a person's own time zone, "YYYY-MM-DD".
 * Falls back to Eastern when the zone is missing or not one Intl knows.
 */
export function dayInZone(timeZone: string | undefined, at: Date | number = new Date()): string {
  if (!timeZone) return easternDay(at);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return easternDay(at);
  }
}

const LONG_DAY = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_TIMEZONE, month: "long", day: "numeric", year: "numeric" });

/**
 * "October 11, 2026, 9:20 AM ET": when something happened, in an email. Convex
 * runs on UTC, so a bare toLocaleDateString printed UTC hours with no zone
 * (a 9:20 AM change read "01:20 PM") until Oct 11 2026.
 */
export function emailStamp(at: Date | number = new Date()): string {
  return `${LONG_DAY.format(at)}, ${CLOCK.format(at)} ET`;
}

/** "5:25 AM ET": a time of day in Eastern, for a sentence that already names the day. */
export function clockLabel(ms: number): string {
  return `${CLOCK.format(ms)} ET`;
}

/** "5:25 AM ET, Oct 1": when something was checked, as a reader can check it. */
export function checkedLabel(ms: number): string {
  return `${CLOCK.format(ms)} ET, ${SHORT_DAY.format(ms)}`;
}

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * UTC midnight of a real calendar day, "YYYY-MM-DD", or NaN. Date.parse alone
 * rolls February 30 into March and reads "2026-09" as September 1, so the shape
 * is checked first and a day that comes back as a different day of the month
 * isn't one.
 */
function dayStart(day: string): number {
  if (!DAY_SHAPE.test(day)) return Number.NaN;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return new Date(ms).getUTCDate() === Number(day.slice(8, 10)) ? ms : Number.NaN;
}

/**
 * Calendar days from `from` to `to`, both "YYYY-MM-DD", counted at UTC
 * midnight so daylight saving never shifts it. Negative when `to` is earlier;
 * NaN when either isn't a real day (February 30, a month, a timestamp).
 *
 * The one day difference for the site and Convex: the data scripts' half is
 * scripts/lib_days.py, and both are held to scripts/data/day_cases.json.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayStart(to) - dayStart(from)) / MS_PER_DAY);
}

/**
 * A day as a whole number of days since 1970-01-01, for placing days on an
 * axis or carrying them through arithmetic: two days subtract to the days
 * between them. NaN when it isn't a real "YYYY-MM-DD" day.
 */
export function dayNumber(day: string): number {
  return Math.round(dayStart(day) / MS_PER_DAY);
}

/** The "YYYY-MM-DD" day a `dayNumber` names, rounded to the nearest whole day. Throws on NaN, as a bad Date does. */
export function dayFromNumber(n: number): string {
  return new Date(Math.round(n) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `daysBetween`, or null when either day is missing or isn't a real day: "we don't know" never reads as 0. */
export function daysBetweenOrNull(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const days = daysBetween(from, to);
  return Number.isNaN(days) ? null : days;
}
