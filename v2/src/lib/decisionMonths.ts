/**
 * PERM decisions by month, each against the same days a year earlier.
 *
 * TWO RECORDS HOLD THE DAYS. DOL's published file (`daily_decisions`, `dol-disclosure`) reaches its last quarter; our
 * own daily check (`sweep-observed`) reaches yesterday and began on the day it began. A month is counted from
 * whichever holds all of it, and the row says which. A month neither holds is NOT COUNTED YET, and a month our check
 * joined part way is a PART MONTH: neither is compared, because a missing day is not a day DOL decided nothing.
 *
 * THE YARDSTICK IS DECISIONS PER WORKING DAY. A month to date, a month with a holiday in it and a 23-day month
 * against a 20-day one all differ in total for reasons that aren't DOL's pace. Working days are Monday to Friday
 * less federal holidays, less the days DOL was shut (Oct 1 to Nov 2, 2025: src/lib/permShutdown2025.ts). A year-ago
 * span with no working day in it IS the shutdown: the row names it and gives no percent.
 *
 * Plain module, so the unit project tests it.
 */
import type { ActivityDay } from "@/lib/activityStats";
import { SHUTDOWN_WINDOW_END, inShutdownWindow } from "@/lib/permShutdown2025";
import { isDolWorkday } from "@/lib/pulseStats";
import { MS_PER_DAY } from "@/lib/time";

export interface MonthCount {
  total: number;
  /** Working days in the span: weekdays less federal holidays and the shutdown's days. */
  workdays: number;
  /** First and last day counted (ISO). */
  from: string;
  to: string;
  /** DOL's published file, or our own daily check of DOL's case status. */
  source: "file" | "checks";
}

export interface MonthAgainst {
  /** "YYYY-MM". */
  month: string;
  /** The month still running, counted through yesterday. */
  toDate: boolean;
  now: MonthCount | null;
  /** The same days a year earlier, from DOL's file. */
  then: MonthCount | null;
  /** Why the two aren't compared, when they aren't. */
  gap: "shutdown" | "not-counted" | "part-month" | null;
  /** The year-ago days fall in DOL's first month back after the shutdown, when it was working through what had piled up. */
  afterShutdown: boolean;
  /** Decisions per working day now against then, in whole percent; null with a gap. */
  perDayPct: number | null;
}

/** DOL's first weeks back: the year-ago figure is real, and the reader is told what it follows. */
const AFTER_SHUTDOWN_DAYS = 30;

const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The same day a year earlier; Feb 29 becomes Feb 28. */
function yearBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = at(from); t <= at(to); t += MS_PER_DAY) out.push(iso(t));
  return out;
}

const isWorkday = (day: string) => isDolWorkday(day) && !inShutdownWindow(day);

interface Rec {
  days: readonly ActivityDay[];
  min: string;
  max: string;
  source: MonthCount["source"];
}

function record(days: readonly ActivityDay[], source: MonthCount["source"], before: string): Rec | null {
  const kept = days.filter((d) => d.date < before).sort((a, b) => a.date.localeCompare(b.date));
  const first = kept[0];
  const last = kept[kept.length - 1];
  return first && last ? { days: kept, min: first.date, max: last.date, source } : null;
}

function count(rec: Rec, from: string, to: string): MonthCount {
  let total = 0;
  for (const d of rec.days) if (d.date >= from && d.date <= to) total += d.total;
  return { total, workdays: eachDay(from, to).filter(isWorkday).length, from, to, source: rec.source };
}

/**
 * The newest `months` months that hold a complete day, newest first. `today` is DOL's day now (Eastern); it and
 * anything after it are never counted.
 */
export function monthsAgainstLastYear(
  file: readonly ActivityDay[],
  checks: readonly ActivityDay[],
  today: string,
  months = 12,
): MonthAgainst[] {
  const fileRec = record(file, "file", today);
  const checkRec = record(checks, "checks", today);
  const yesterday = iso(at(today) - MS_PER_DAY);
  const out: MonthAgainst[] = [];
  let [y, m] = yesterday.split("-").map(Number) as [number, number];
  for (let i = 0; i < months; i++) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const start = `${month}-01`;
    const monthEnd = iso(Date.UTC(y, m, 0));
    const toDate = monthEnd > yesterday;
    const end = toDate ? yesterday : monthEnd;
    // The newest day a record must reach to hold the span: its last working day, since a closing weekend has no row.
    const lastWorked = [...eachDay(start, end)].reverse().find(isWorkday) ?? end;

    let now: MonthCount | null = null;
    let gap: MonthAgainst["gap"] = null;
    if (fileRec && fileRec.min <= start && fileRec.max >= lastWorked) now = count(fileRec, start, end);
    else if (checkRec && checkRec.min <= start && checkRec.max >= lastWorked) now = count(checkRec, start, end);
    else if (checkRec && checkRec.min > start && checkRec.min <= end && checkRec.max >= lastWorked) {
      now = count(checkRec, checkRec.min, end);
      gap = "part-month";
    } else if (fileRec && fileRec.min <= start && fileRec.max >= start && fileRec.max < lastWorked) {
      now = count(fileRec, start, fileRec.max);
      gap = "part-month";
    } else gap = "not-counted";

    let then: MonthCount | null = null;
    const thenFrom = yearBefore(now?.from ?? start);
    const thenTo = yearBefore(now?.to ?? end);
    if (fileRec && fileRec.min <= thenFrom && fileRec.max >= thenTo) then = count(fileRec, thenFrom, thenTo);
    else if (gap === null) gap = "not-counted";
    if (gap === null && then && then.workdays === 0) gap = "shutdown";

    const reopened = iso(at(SHUTDOWN_WINDOW_END) + MS_PER_DAY);
    const settled = iso(at(SHUTDOWN_WINDOW_END) + AFTER_SHUTDOWN_DAYS * MS_PER_DAY);
    const afterShutdown = gap !== "shutdown" && then !== null && then.from <= settled && then.to >= reopened;

    const comparable = gap === null && now !== null && then !== null && now.workdays > 0 && then.workdays > 0 && then.total > 0;
    const perDayPct = comparable ? Math.round((now!.total / now!.workdays / (then!.total / then!.workdays) - 1) * 100) : null;

    out.push({ month, toDate, now, then, gap, afterShutdown, perDayPct });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
