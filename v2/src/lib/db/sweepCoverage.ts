import "server-only";

import { cache } from "react";
import { MS_PER_DAY } from "@/lib/time";
import { one } from "./client";
import { softFail } from "@/lib/softRead";
import { checkTimes, type CheckTimes } from "@/lib/checkTimes";

/**
 * When our DOL sweep last finished, and how much of the corpus it answered.
 *
 * WHY THIS EXISTS. `perm_case_status.last_checked_at` is not a check date:
 * the PERM sweep never writes that column, which holds a retired mirror's
 * stale stamps or nothing. Printed as "status seen", it would tell a
 * beneficiary whose case the sweep verified that morning that it has not
 * been looked at in weeks. The sweep's own record is the honest check date,
 * and it is one point read.
 *
 * Eight-day cutoff, like every other precomputed doc: a stale sweep must read
 * as "not checked recently", never as fresh.
 */
export interface SweepCoverage {
  /** ISO date the sweep finished, in the sweep's own clock (UTC date). */
  finishedOn: string;
  mode: string;
  asked: number;
  answered: number;
  /** When the sweep wrote this record, epoch ms: the time a page can print as "checked". */
  checkedAt: number;
}

const MAX_AGE_MS = 8 * MS_PER_DAY;

export const getSweepCoverage = cache(async (): Promise<SweepCoverage | null> => {
  const r = await one<{ json: string; computed_at: number | string }>(
    "SELECT json, computed_at FROM perm_docs WHERE key = ?",
    ["sweep_coverage"],
  ).catch(softFail("sweepCoverage.one", null));
  if (!r) return null;
  const computedAt = Number(r.computed_at);
  if (!Number.isFinite(computedAt) || Date.now() - computedAt > MAX_AGE_MS) return null;
  try {
    const d = JSON.parse(String(r.json)) as Record<string, unknown>;
    const finishedOn = typeof d.finishedOn === "string" ? d.finishedOn.slice(0, 10) : null;
    if (!finishedOn || !/^\d{4}-\d{2}-\d{2}$/.test(finishedOn)) return null;
    return {
      finishedOn,
      mode: typeof d.mode === "string" ? d.mode : "",
      asked: Number(d.asked) || 0,
      answered: Number(d.answered) || 0,
      checkedAt: computedAt,
    };
  } catch {
    return null;
  }
});

/**
 * When any pass last finished asking DOL, epoch ms: perm_docs['latest_check'], stamped by every pass that checked
 * cases, the 15-minute daytime pass included. The same eight-day cutoff as the complete read's record.
 */
export const getLatestCheck = cache(async (): Promise<number | null> => {
  const r = await one<{ computed_at: number | string }>(
    "SELECT computed_at FROM perm_docs WHERE key = ?",
    ["latest_check"],
  ).catch(softFail("sweepCoverage.getLatestCheck", null));
  if (!r) return null;
  const at = Number(r.computed_at);
  return Number.isFinite(at) && Date.now() - at <= MAX_AGE_MS ? at : null;
});

/** The times a page prints for DOL's PERM record: the newest check, and the last complete read beside it. */
export const getCheckTimes = cache(async (): Promise<CheckTimes | null> => {
  const [coverage, latest] = await Promise.all([
    getSweepCoverage().catch(softFail("sweepCoverage.getCheckTimes.coverage", null)),
    getLatestCheck(),
  ]);
  return checkTimes(latest, coverage?.checkedAt ?? null);
});

/** The later of two ISO timestamps/dates, comparing their date part. */
export function laterDate(a: string | null | undefined, b: string | null | undefined): string | null {
  const da = a ? a.slice(0, 10) : null;
  const db = b ? b.slice(0, 10) : null;
  if (!da) return db;
  if (!db) return da;
  return db > da ? db : da;
}
