import "server-only";

import { weekStart } from "@/lib/activityStats";
import { countWageDeterminations, type WageDeterminations } from "@/lib/dailyUpdate";
import { dolDayBounds } from "@/lib/dolDay";
import { pwdOwnSql } from "@/lib/wageRequestRanges";

import { rows } from "./client";

/**
 * The wage determinations DOL issued on one DOL day and in its week so far, for the line under /perm-updates' PERM
 * figures ("DOL also issued 185 wage determinations on Sunday, and 4,196 in the week from Monday, November 16").
 *
 * One statement: the week's wage request moves (`pwd_case_events`), one row per read and status, from 7 AM Eastern
 * on the Monday to 7 AM after the day (src/lib/dolDay.ts). It rides `pwd_events_recent`, the index the board reads
 * the same table by, and groups about a week of rows. `own` keeps the count to P-100 and P-200 to P-203, the ETA-9141
 * requests; the stamp's whole size stays in `n` for the catch-up rule (src/lib/dailyUpdate.ts).
 *
 * A failed read throws: the caller decides what the page shows without it, and it's never a count of 0. Null only for
 * a day that isn't one.
 */
export async function getWageDeterminations(day: string): Promise<WageDeterminations | null> {
  const to = dolDayBounds(day);
  if (!to) return null;
  const from = dolDayBounds(weekStart(day));
  if (!from) return null;
  const got = await rows<Record<string, unknown>>(
    `SELECT e.changed_at AS t, e.to_status AS status, COUNT(*) AS n,
            SUM(CASE WHEN ${pwdOwnSql("e.")} THEN 1 ELSE 0 END) AS own
       FROM pwd_case_events e INDEXED BY pwd_events_recent
      WHERE e.changed_at >= ? AND e.changed_at < ?
      GROUP BY e.changed_at, e.to_status`,
    [from.lo, to.hi],
  );
  // libSQL returns integers as strings.
  return countWageDeterminations(
    got.map((r) => ({ t: Number(r.t), status: String(r.status ?? ""), n: Number(r.n) || 0, own: Number(r.own) || 0 })),
    day,
  );
}
