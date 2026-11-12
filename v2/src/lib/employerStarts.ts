import { longDate } from "@convex/lib/months";

/**
 * One employer's wage requests beside its PERM applications, by the calendar year it filed each.
 *
 * A green card through work starts with a wage request to DOL, and the PERM application follows months later.
 * Read side by side, the two say whether an employer is starting green cards and whether it's following through:
 * some ask for thousands of wages a year and file almost nothing, and some stop both. The reads are in
 * `db/employerStarts.ts`; everything here is plain arithmetic on what they return.
 */

export interface StartYear {
  year: number;
  /** Wage requests of the green card kind filed that year, each case once across DOL's files and its live record. */
  wageRequests: number;
  /** PERM applications filed that year. */
  permFiled: number;
  /** Of the wage requests whose job DOL's file names, those for a Schedule A job (nurses, physical therapists). */
  scheduleA: number;
  /** The wage requests whose job DOL's file names. The live record names none. */
  jobKnown: number;
}

export interface EmployerStarts {
  /** Every year from `STARTS_FROM` to this one, oldest first. */
  years: StartYear[];
  /** The day its newest wage request went in, or null with none in the window. */
  newestWageRequest: string | null;
  /** The day its newest PERM application went in, or null with none in the window. */
  newestPerm: string | null;
}

/**
 * The first year of the window, and the first both steps are held whole: DOL's wage file holds the requests it
 * decided from October 1 2022, and its PERM files every case decided since October 1 2007 (read Nov 12 2026).
 */
export const STARTS_FROM = 2023;

/** Under this many filings in the window, the ledger's totals already say everything the table would. */
export const MIN_STARTS = 10;

/** Fewer named jobs than this can't say what an employer mostly files for. */
const MIN_JOBS_KNOWN = 5;

const EMPTY = (year: number): StartYear => ({ year, wageRequests: 0, permFiled: 0, scheduleA: 0, jobKnown: 0 });

/** Every year from the first to `thisYear`, a year with nothing as zeros, and nothing outside the window. */
export function fillStartYears(got: readonly StartYear[], thisYear: number): StartYear[] {
  const byYear = new Map(got.map((r) => [r.year, r]));
  const out: StartYear[] = [];
  for (let year = STARTS_FROM; year <= thisYear; year++) out.push(byYear.get(year) ?? EMPTY(year));
  return out;
}

/** Whether the window holds enough to compare. */
export function worthShowing(starts: EmployerStarts | null): starts is EmployerStarts {
  if (!starts) return false;
  const total = starts.years.reduce((a, r) => a + r.wageRequests + r.permFiled, 0);
  return total >= MIN_STARTS;
}

/** The largest figure in either column: both columns draw on it, so a bar's length compares across them. */
export function startsScale(years: readonly StartYear[]): number {
  return Math.max(0, ...years.map((r) => Math.max(r.wageRequests, r.permFiled)));
}

/**
 * Most of the wage requests whose job is named are for a Schedule A job. Those cases go straight to USCIS and
 * skip the PERM application (20 CFR 656.15), so "no PERM applications" beside them is the rule, never a pause.
 */
export function mostlyScheduleA(years: readonly StartYear[]): boolean {
  const known = years.reduce((a, r) => a + r.jobKnown, 0);
  const scheduleA = years.reduce((a, r) => a + r.scheduleA, 0);
  return known >= MIN_JOBS_KNOWN && scheduleA * 2 > known;
}

/** The newest of each, dated. Null when the window holds neither. */
export function startsSentence(starts: EmployerStarts): string | null {
  const wage = longDate(starts.newestWageRequest);
  const perm = longDate(starts.newestPerm);
  if (wage && perm) return `Its newest wage request went in on ${wage}, and its newest PERM application on ${perm}.`;
  if (wage) return `Its newest wage request went in on ${wage}. It has filed no PERM application since the start of ${STARTS_FROM}.`;
  if (perm) return `Its newest PERM application went in on ${perm}. It has made no wage request since the start of ${STARTS_FROM}.`;
  return null;
}
