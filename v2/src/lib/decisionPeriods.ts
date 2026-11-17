/**
 * PERM decisions by day, week, month or year, each against a year earlier: the one rule behind the decisions chart's
 * switch and the month table (src/lib/decisionMonths.ts is this rule's month view).
 *
 * TWO RECORDS HOLD THE DAYS. DOL's published file (`dol-disclosure`) reaches its last quarter; our own daily check
 * (`sweep-observed`) reaches yesterday and began on the day it began. A day counts from the file where the file holds
 * it, else from our check; a day neither holds is MISSING, never zero, and its working days are named. A record holds
 * the days from its first row to its last, and the non-working days straight after its last (a closing weekend has
 * no row).
 *
 * THE YARDSTICK. A week, month or year is compared with the same days a year earlier in decisions per working day
 * (Monday to Friday less federal holidays and the days DOL was shut, Oct 1 to Nov 2, 2025), so a holiday, a month to
 * date or a hole in the record doesn't read as DOL slowing down. A day is compared with the same weekday 52 weeks
 * earlier by its total, and only when both are working days. A week and a day step back 364 days so the weekdays line
 * up; a month and a year step back to the same calendar dates.
 *
 * A PERIOD WITH A HOLE is compared only when it still holds PART_COMPARE_WORKDAYS working days (a year with a
 * missing summer, yes; a month our check joined three days before its end, no), and then over the same days a year
 * earlier, so the hole is left out of both sides.
 *
 * Plain module, so the unit project tests it.
 */
import { type ActivityDay, type WeekdayProfile, fillZeros, weekdayIndex, weekdayProfile } from "@/lib/activityStats";
import { isFederalHoliday } from "@/lib/perm";
import { SHUTDOWN_WINDOW_END, inShutdownWindow } from "@/lib/permShutdown2025";
import { isDolWorkday, recentWeekdays } from "@/lib/pulseStats";
import { MS_PER_DAY } from "@/lib/time";

export const PERIOD_UNITS = ["day", "week", "month", "year"] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];

/** How many periods each view shows, newest first. A year view runs back to the oldest year on record. */
export const PERIOD_SPANS: Record<PeriodUnit, number> = { day: 30, week: 26, month: 12, year: 40 };

/** A period with a hole in the record is compared only when it still holds this many working days. */
export const PART_COMPARE_WORKDAYS = 20;

/** DOL's first weeks back after the shutdown: a year-ago figure from then is real, and the reader is told what it follows. */
const AFTER_SHUTDOWN_DAYS = 30;

export interface PeriodCount {
  total: number;
  certified: number;
  denied: number;
  withdrawn: number;
  /** Working days among the days counted. */
  workdays: number;
  /** First and last day counted (ISO). */
  from: string;
  to: string;
  /** DOL's published file, our own daily check of DOL's case status, or the file then our check. */
  source: "file" | "checks" | "both";
}

export interface PeriodAgainst {
  unit: PeriodUnit;
  /** "2026-11-16" for a day, the Monday for a week, "2026-11" for a month, "2026" for a year. */
  key: string;
  /** The period's own first and last day. */
  start: string;
  end: string;
  /** The period still running, counted through yesterday. */
  toDate: boolean;
  now: PeriodCount | null;
  /** The same days a year earlier. */
  then: PeriodCount | null;
  /** Working days in the period, through yesterday, that neither record holds. */
  missingWorkdays: number;
  /** Why the two aren't compared, when they aren't. */
  gap: "shutdown" | "holiday" | "weekend" | "not-counted" | "part" | null;
  /** The year-ago days fall in DOL's first month back after the shutdown, when it was working through what had piled up. */
  afterShutdown: boolean;
  /** Now against then in whole percent: per working day, or a day's total. Null with a gap. */
  pct: number | null;
}

const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(at(day) + n * MS_PER_DAY);

/** The same day a year earlier; Feb 29 becomes Feb 28. */
export function yearBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** A day DOL decides cases: Monday to Friday, not a federal holiday, not a day of the 2025 shutdown. */
export const isWorkday = (day: string) => isDolWorkday(day) && !inShutdownWindow(day);

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = at(from); t <= at(to); t += MS_PER_DAY) out.push(iso(t));
  return out;
}

interface Rec {
  byDay: Map<string, ActivityDay>;
  min: string;
  /** The last day the record holds: its last row and the non-working days straight after it. */
  reach: string;
  source: "file" | "checks";
}

function record(days: readonly ActivityDay[], source: Rec["source"], before: string): Rec | null {
  const kept = days.filter((d) => d.date < before).sort((a, b) => a.date.localeCompare(b.date));
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (!first || !last) return null;
  let reach = last.date;
  while (addDays(reach, 1) < before && !isWorkday(addDays(reach, 1))) reach = addDays(reach, 1);
  return { byDay: new Map(kept.map((d) => [d.date, d])), min: first.date, reach, source };
}

const holds = (rec: Rec | null, day: string): rec is Rec => rec !== null && day >= rec.min && day <= rec.reach;

/** Which record a day counts from: the file where it holds the day, else our check. */
function recFor(file: Rec | null, checks: Rec | null, day: string): Rec | null {
  if (holds(file, day)) return file;
  if (holds(checks, day)) return checks;
  return null;
}

function tally(days: readonly string[], file: Rec | null, checks: Rec | null): PeriodCount | null {
  if (days.length === 0) return null;
  const sum = { total: 0, certified: 0, denied: 0, withdrawn: 0 };
  const used = new Set<Rec["source"]>();
  let workdays = 0;
  for (const day of days) {
    const rec = recFor(file, checks, day)!;
    used.add(rec.source);
    const row = rec.byDay.get(day);
    if (row) {
      sum.total += row.total;
      sum.certified += row.certified;
      sum.denied += row.denied;
      sum.withdrawn += row.withdrawn;
    }
    if (isWorkday(day)) workdays += 1;
  }
  const source = used.size === 2 ? "both" : used.has("file") ? "file" : "checks";
  return { ...sum, workdays, from: days[0]!, to: days[days.length - 1]!, source };
}

/** The period holding `day`. */
function periodOf(unit: PeriodUnit, day: string): { key: string; start: string; end: string } {
  const [y, m] = day.split("-").map(Number) as [number, number];
  if (unit === "day") return { key: day, start: day, end: day };
  if (unit === "week") {
    const start = addDays(day, -weekdayIndex(day));
    return { key: start, start, end: addDays(start, 6) };
  }
  if (unit === "month") {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    return { key, start: `${key}-01`, end: iso(Date.UTC(y, m, 0)) };
  }
  return { key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
}

/** The same day a year earlier, as this unit lines them up. */
const shiftBack = (unit: PeriodUnit, day: string) => (unit === "day" || unit === "week" ? addDays(day, -364) : yearBefore(day));

/**
 * The newest `n` periods that hold a complete day, newest first, back to the oldest one a record reaches. `today` is
 * DOL's day now (Eastern); it and anything after it are never counted.
 */
export function periodsAgainstLastYear(
  fileDays: readonly ActivityDay[],
  checkDays: readonly ActivityDay[],
  today: string,
  unit: PeriodUnit,
  n: number = PERIOD_SPANS[unit],
): PeriodAgainst[] {
  const file = record(fileDays, "file", today);
  const checks = record(checkDays, "checks", today);
  const oldest = [file?.min, checks?.min].filter((x): x is string => !!x).sort()[0];
  if (!oldest) return [];
  const yesterday = addDays(today, -1);
  const reopened = addDays(SHUTDOWN_WINDOW_END, 1);
  const settled = addDays(SHUTDOWN_WINDOW_END, AFTER_SHUTDOWN_DAYS);

  const out: PeriodAgainst[] = [];
  let cursor = yesterday;
  while (out.length < n) {
    const { key, start, end } = periodOf(unit, cursor);
    if (end < oldest) break;
    const toDate = end > yesterday;
    const span = eachDay(start, toDate ? yesterday : end);

    const covered = span.filter((day) => recFor(file, checks, day) !== null);
    const missingWorkdays = span.filter((day) => recFor(file, checks, day) === null && isWorkday(day)).length;
    const now = tally(covered, file, checks);

    // The same days a year earlier: every one must be on record, or there's nothing fair to compare with.
    const back = [...new Set(covered.map((day) => shiftBack(unit, day)))].sort();
    const then = back.length > 0 && back.every((day) => recFor(file, checks, day) !== null) ? tally(back, file, checks) : null;

    let gap: PeriodAgainst["gap"] = null;
    if (!now) gap = "not-counted";
    else if (missingWorkdays > 0 && now.workdays < PART_COMPARE_WORKDAYS) gap = "part";
    else if (!then) gap = "not-counted";
    else if (unit === "day") {
      const thenDay = back[0]!;
      if (inShutdownWindow(thenDay)) gap = "shutdown";
      else if (isFederalHoliday(key) || isFederalHoliday(thenDay)) gap = "holiday";
      else if (!isWorkday(key) || !isWorkday(thenDay)) gap = "weekend";
    } else if (then.workdays === 0) gap = "shutdown";

    const afterShutdown = gap !== "shutdown" && then !== null && then.from <= settled && then.to >= reopened;
    let pct: number | null = null;
    if (gap === null && now && then && then.total > 0) {
      if (unit === "day") pct = Math.round((now.total / then.total - 1) * 100);
      else if (now.workdays > 0 && then.workdays > 0) pct = Math.round((now.total / now.workdays / (then.total / then.workdays) - 1) * 100);
    }

    out.push({ unit, key, start, end, toDate, now, then, missingWorkdays, gap, afterShutdown, pct });
    cursor = addDays(start, -1);
  }
  return out;
}

export interface MonthShape {
  /** 1 = January. */
  month: number;
  /** Decisions per working day in this calendar month over the years counted, or null with no working day. */
  perWorkday: number | null;
}

/**
 * What a year usually looks like: decisions per working day in each calendar month, over the newest `years` complete
 * calendar years DOL's file holds whole. Per working day, so a month's holidays and the shutdown's days don't read as
 * a slow month.
 */
export function typicalYear(
  fileDays: readonly ActivityDay[],
  today: string,
  years = 5,
): { years: { from: number; to: number } | null; months: MonthShape[] } {
  const file = record(fileDays, "file", today);
  if (!file) return { years: null, months: [] };
  const whole: number[] = [];
  for (let y = Number(today.slice(0, 4)) - 1; y >= Number(file.min.slice(0, 4)) && whole.length < years; y -= 1) {
    if (holds(file, `${y}-01-01`) && holds(file, `${y}-12-31`)) whole.push(y);
  }
  if (whole.length === 0) return { years: null, months: [] };
  const totals = new Array<number>(12).fill(0);
  const workdays = new Array<number>(12).fill(0);
  for (const y of whole) {
    for (const day of eachDay(`${y}-01-01`, `${y}-12-31`)) {
      const m = Number(day.slice(5, 7)) - 1;
      totals[m]! += file.byDay.get(day)?.total ?? 0;
      if (isWorkday(day)) workdays[m]! += 1;
    }
  }
  return {
    years: { from: Math.min(...whole), to: Math.max(...whole) },
    months: totals.map((t, i) => ({ month: i + 1, perWorkday: workdays[i]! > 0 ? Math.round(t / workdays[i]!) : null })),
  };
}

export interface DecisionViews {
  /** Each view's periods, newest first. */
  periods: Record<PeriodUnit, PeriodAgainst[]>;
  /** Beside the day view: the average day of the week over the last four weeks of our check. */
  weekRecent: WeekdayProfile[];
  /** Beside the week view: the average day of the week over the weeks it shows. */
  weekSpan: WeekdayProfile[];
  /** Beside the month and year views: decisions per working day by calendar month. */
  year: ReturnType<typeof typicalYear>;
  /** The first day our daily check holds (ISO), for the note on where each count comes from. */
  checksFrom: string | null;
  /** The last day DOL's file holds (ISO). */
  fileTo: string | null;
}

/**
 * Every view of the decisions chart from the two records, in one place, so the homepage and the decisions page draw
 * the same numbers. `fileDays` is DOL's file (`dol-disclosure`), `checkDays` our daily check (`sweep-observed`).
 */
export function decisionViews(fileDays: readonly ActivityDay[], checkDays: readonly ActivityDay[], today: string): DecisionViews {
  // DOL's file is a grouping by decision date, so a day with no row is a day DOL decided nothing.
  const file = fillZeros([...fileDays].sort((a, b) => a.date.localeCompare(b.date)));
  const checks = [...checkDays].filter((d) => d.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const periods = Object.fromEntries(
    PERIOD_UNITS.map((u) => [u, periodsAgainstLastYear(file, checks, today, u)]),
  ) as Record<PeriodUnit, PeriodAgainst[]>;

  const weeks = periods.week;
  const spanFrom = weeks[weeks.length - 1]?.start ?? today;
  const byDay = new Map<string, ActivityDay>();
  for (const d of checks) if (d.date >= spanFrom) byDay.set(d.date, d);
  // The file wins where both hold a day, as in every count above.
  const fileTo = file[file.length - 1]?.date ?? null;
  for (const d of file) if (d.date >= spanFrom) byDay.set(d.date, d);
  const usual = (d: ActivityDay) => !isFederalHoliday(d.date) && !inShutdownWindow(d.date);

  return {
    periods,
    weekRecent: recentWeekdays(checks, 4),
    weekSpan: weekdayProfile([...byDay.values()].filter(usual)),
    year: typicalYear(file, today),
    checksFrom: checks[0]?.date ?? null,
    fileTo,
  };
}
