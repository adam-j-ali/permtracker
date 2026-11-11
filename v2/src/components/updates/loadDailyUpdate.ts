import "server-only";

import type { DailyUpdateViewProps } from "@/components/updates/DailyUpdateView";
import { dayCases, daysBefore, summariseDay } from "@/lib/dailyUpdate";
import { getActivitySeries } from "@/lib/db/activity";
import { getChangeCalendar, getChangeDay } from "@/lib/db/changes";
import { getSweepCoverage } from "@/lib/db/sweepCoverage";
import { dolDayOf } from "@/lib/dolDay";
import { federalHolidayName } from "@/lib/perm";
import { isDolWorkday, usualFor } from "@/lib/pulseStats";
import { softFail } from "@/lib/softRead";

/**
 * Everything the daily page shows for one DOL day, read once on the server.
 *
 * WHICH DAY THE INDEX LEADS WITH. DOL's last working day our record holds a PERM move for. A weekend or a federal
 * holiday after it is named above the figures and linked, never led with: on Veterans Day 2026 the newest day on
 * record held 25 withdrawals and no decision by DOL, and a page that opened on it would have read as "DOL
 * certified nothing".
 *
 * WHAT A FAILED READ DOES. The calendar and the day's list throw, so the page keeps its last good render. The
 * daily series and the check's stamp are read softly: without them the page loses the comparison with a usual
 * day, the earlier days and the "last check" line, and says nothing false.
 */

export type DailyLoad =
  | { kind: "day"; props: DailyUpdateViewProps }
  /** Before the first day our own record covers. */
  | { kind: "outside"; since: string | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (v: string) => ISO_DAY.test(v) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const nextOf = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export async function loadDailyUpdate(asked: string | null): Promise<DailyLoad | null> {
  const now = Date.now();
  const today = dolDayOf(now);
  const [calendar, seriesAll, coverage] = await Promise.all([
    getChangeCalendar(),
    getActivitySeries().catch(softFail("perm-updates.series", [])),
    getSweepCoverage(),
  ]);
  const withPerm = calendar.days.filter((d) => d.byProgram.perm > 0).map((d) => d.date).sort((a, b) => b.localeCompare(a));
  const since = calendar.observedSince;

  let day: string;
  const closedAfter: { date: string; name: string }[] = [];
  if (asked === null) {
    const lead = withPerm.find((d) => isDolWorkday(d)) ?? withPerm[0];
    if (!lead) return null;
    day = lead;
    // Every closed day between the lead and today, today included: a holiday is said even before a check has run.
    for (let d = nextOf(lead); d <= today; d = nextOf(d)) {
      const name = federalHolidayName(d);
      if (name) closedAfter.push({ date: d, name });
    }
  } else {
    // A day that hasn't come is no page; a day before our record is one that says where the record starts.
    if (!realDay(asked) || asked > today) return null;
    if (since !== null && asked < since) return { kind: "outside", since };
    day = asked;
  }

  const feed = await getChangeDay(day);
  const changes = feed?.changes ?? [];
  const perm = summariseDay(day, changes, "perm");
  const wage = summariseDay(day, changes, "pwd");
  const series = seriesAll.find((s) => s.source === "sweep-observed")?.days ?? [];
  const final = day < today;
  const usual = (key: "certified" | "denied" | "withdrawn") => (final ? (usualFor(series, day, key)?.usual ?? null) : null);

  return {
    kind: "day",
    props: {
      day,
      perm,
      wage,
      cases: dayCases(changes, "perm"),
      final,
      checkedAt: coverage?.checkedAt ?? null,
      now,
      usual: { certified: usual("certified"), denied: usual("denied"), withdrawn: usual("withdrawn") },
      earlier: daysBefore(series, day, 10),
      nextDay: [...withPerm].reverse().find((d) => d > day) ?? null,
      closedAfter,
      // The feed lists PERM first, so its rows are whole unless the day's PERM and wage moves pass the feed's cap.
      capped: feed !== null && (feed.byProgram.perm > perm.total || feed.byProgram.pwd > wage.total),
    },
  };
}
