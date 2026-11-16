import "server-only";

import type { BacklogMonth } from "@/lib/backlogMonths";
import { HOLD_STATUS } from "@/lib/employerStages";
import { shiftDay } from "@/lib/filingsByDay";
import { estimateNextStart, findMonthStarts, liveMonthFrom, type MonthDay, type NextStart } from "@/lib/monthStart";
import { ANALYST_REVIEW } from "@/lib/searchStages";
import { shiftMonth } from "@convex/lib/months";
import { easternDay } from "@convex/lib/time";

import { getBacklogMatrix } from "./backlog";
import { rows } from "./client";

/**
 * Calendar days of the past-day census the start estimate reads: room for the
 * STARTS_USED newest starts (about a month apart) and the quiet days before
 * each, with a month to spare.
 */
export const START_RECORD_DAYS = 150;

/**
 * Filing months read: the ones DOL could start inside those days. A month more
 * than a year and a half old was started long before the record.
 */
const START_RECORD_MONTHS = 18;

const SQL =
  "SELECT day, month, SUM(n) AS total, " +
  "SUM(CASE WHEN is_final = 1 THEN n ELSE 0 END) AS decided, " +
  "SUM(CASE WHEN status = 'WITHDRAWN' THEN n ELSE 0 END) AS withdrawn, " +
  "SUM(CASE WHEN status = ? THEN n ELSE 0 END) AS held, " +
  "SUM(CASE WHEN status = ? THEN n ELSE 0 END) AS in_line " +
  "FROM perm_census_days WHERE day >= ? AND month >= ? GROUP BY day, month ORDER BY day, month";

/**
 * The past-day census, one row per day and filing month, for findMonthStarts.
 * A seek on the table's leading key (day), about 1,100 rows and 95 ms on the
 * server on Nov 16 2026. Empty before the table exists; any other failed read
 * throws, and the page's softFail keeps the rest of the page.
 */
export async function getStartRecord(today: string): Promise<MonthDay[]> {
  try {
    const got = await rows<Record<string, unknown>>(SQL, [
      HOLD_STATUS,
      ANALYST_REVIEW,
      shiftDay(today, -START_RECORD_DAYS),
      shiftMonth(today.slice(0, 7), -START_RECORD_MONTHS),
    ]);
    return got.map((r) => ({
      day: String(r.day),
      month: String(r.month),
      total: Number(r.total),
      decided: Number(r.decided),
      withdrawn: Number(r.withdrawn),
      held: Number(r.held),
      inLine: Number(r.in_line),
    }));
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
}

/**
 * When DOL will likely start the month after the one it began most recently,
 * with that month's live census for the picture. One composition for every
 * page that says it (the queue page's section, the next month's own page), so
 * they can't quote two dates. The census is React-cached, so a page that has
 * already read it reads it once. Null when the record holds no start or the
 * month has no live figures.
 */
export async function getNextStart(today = easternDay()): Promise<{ est: NextStart; current: BacklogMonth } | null> {
  const [record, months] = await Promise.all([getStartRecord(today), getBacklogMatrix()]);
  const starts = findMonthStarts(record);
  const current = months.find((m) => m.month === starts.at(-1)?.month) ?? null;
  if (!current) return null;
  const est = estimateNextStart({ series: record, starts, live: liveMonthFrom(current) });
  return est ? { est, current } : null;
}
