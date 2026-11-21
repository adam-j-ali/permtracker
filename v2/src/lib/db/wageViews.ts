import "server-only";

import { cache } from "react";

import { one, rows } from "./client";
import { beforeFirstLoad } from "./firstLoad";
import { socGroup } from "@/lib/socCode";

/**
 * Precomputed wage selections, one row per filter combination big enough to
 * be slow.
 *
 * The PERM salary explorer and the LCA wage explorer compute percentiles, a
 * histogram and a per-state table over the reader's filters with window
 * functions. On a big selection that is millions of rows read per page
 * rebuild and, on the LCA side, deadline failures of /api/lca-wages.
 * `scripts/build_wage_views.py`
 * computes every combination of status x occupation group x state x fiscal
 * year holding at least 5,000 filings, in the same arithmetic as the SQL,
 * after each disclosure load, into `wage_views`.
 *
 * A lookup is one primary-key read. A miss means the selection is small (or
 * the table isn't there yet on a fresh database) and the caller runs its live
 * query, which an index keeps fast at that size.
 */

export type WageProgram = "perm" | "lca";

export interface WageViewStats {
  n: number;
  avg: number | null;
  p5: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

export interface WageView {
  stats: WageViewStats;
  /** The width the histogram was binned at: binWidth(p5, p95). */
  binWidth: number;
  /** [from, count], every occupied bin, lowest first. */
  histogram: [number, number][];
  /** The per-state floor the by-state table was cut at (MIN_FOR_MEDIAN). */
  minCases: number;
  /** Only on a key with no state filter. */
  byState: Array<WageViewStats & { state: string }> | null;
}

export interface WageViewFilters {
  status?: string | null;
  socCode?: string | null;
  state?: string | null;
  fiscalYear?: string | number | null;
}

/**
 * `program|status|soc|state|fy`, empty for an unset filter. MUST MATCH key()
 * in scripts/build_wage_views.py, which test_wage_views.py checks against
 * this function's template. Each part is normalised exactly as the live query
 * normalises its argument, so a key names the same rows the query would read.
 */
export function wageViewKey(program: WageProgram, f: WageViewFilters): string {
  const status = f.status || "certified";
  const soc = socGroup(f.socCode) ?? "";
  const state = f.state ? (program === "lca" ? f.state.toUpperCase() : f.state) : "";
  const fy = f.fiscalYear ? String(f.fiscalYear) : "";
  return `${program}|${status}|${soc}|${state}|${fy}`;
}

const readView = cache(async (key: string): Promise<WageView | null> => {
  try {
    const r = await one<{ json: string }>("SELECT json FROM wage_views WHERE key = ?", [key]);
    return r ? (JSON.parse(r.json) as WageView) : null;
  } catch {
    // A missing table (a fresh database) or a transient failure: the caller's
    // live query answers instead, degraded to slow rather than to empty.
    return null;
  }
});

/** The precomputed view for this selection, or null to run the live query. */
export function wageView(program: WageProgram, f: WageViewFilters): Promise<WageView | null> {
  return readView(wageViewKey(program, f));
}

/**
 * The `program` of the views the history load writes for DOL's older PERM files (FY2008 to FY2023,
 * `perm_cases_history`): HISTORY_PROGRAM in scripts/build_wage_views.py, which its test holds to this.
 */
export const PERM_HISTORY_PROGRAM = "perm_history";

export interface PermYearView {
  view: WageView | null;
  /** The year is one of the older files', whose every selection holding a case is precomputed. */
  history: boolean;
}

/**
 * A PERM selection that names a fiscal year, and whether that year is one of the older files'.
 *
 * The live query reads `perm_cases`, which holds FY2024 on, and a page never scans the older table. So the history
 * load precomputes every selection of an older year that holds a case (thin ones too), under these keys, and for
 * such a year a missing key is a selection with no cases. One statement reads the selection's key and its year's
 * root key (every outcome, every job, every state), whose `program` says which table the year comes from.
 *
 * A failed read throws: answered as none, an older year would read as one with no cases. Only a database with no
 * views table yet falls through to the live query, as the other selections do.
 */
const readPermYear = cache(async (key: string, root: string): Promise<PermYearView> => {
  const got = await rows<{ key: string; program: string; json: string }>(
    "SELECT key, program, json FROM wage_views WHERE key IN (?, ?)",
    [key, root],
  ).catch(beforeFirstLoad([] as { key: string; program: string; json: string }[]));
  const hit = got.find((r) => r.key === key);
  return {
    view: hit ? (JSON.parse(hit.json) as WageView) : null,
    history: got.some((r) => r.key === root && r.program === PERM_HISTORY_PROGRAM),
  };
});

const yearRoot = (fy: string | number) => wageViewKey("perm", { status: "all", fiscalYear: fy });

/** A PERM selection with a fiscal year: its view, and whether the year is one of the older files'. */
export function permYearView(f: WageViewFilters & { fiscalYear: string | number }): Promise<PermYearView> {
  return readPermYear(wageViewKey("perm", f), yearRoot(f.fiscalYear));
}

/** Whether a fiscal year is one of DOL's older PERM files', answered from its precomputed views. */
export async function permHistoryYear(fy: string | number): Promise<boolean> {
  const root = yearRoot(fy);
  return (await readPermYear(root, root)).history;
}
