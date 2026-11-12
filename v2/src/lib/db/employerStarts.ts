import "server-only";

import { cache } from "react";

import { rows } from "./client";
import { employerMatch, slugListMatch, type EmployerMatch } from "./employerSlugs";
import { PWD_VISA_CLASS } from "@/lib/changeProgram";
import { STARTS_FROM, fillStartYears, type EmployerStarts, type StartYear } from "@/lib/employerStarts";
import { SOC_GROUP_SQL, isScheduleA } from "@/lib/socCode";
import { easternDay } from "@convex/lib/time";

/**
 * One employer's wage requests and PERM applications by the calendar year it filed them, from `STARTS_FROM` on.
 *
 * Two reads, each bounded by the employer's own spellings, and each part answered from an index that carries every
 * column it needs (the kind of request, the filing day, the case number and, for the wage file, the job code), so
 * no row of a table is opened. Without them the wage read opened every one of the employer's requests: 0.7 s for
 * Google and 2.0 s for Deloitte & Touche; with them Intel's 19,000 requests are counted in tens of milliseconds.
 * The scripts that build each table create its index, and each is named here (`INDEXED BY`), so a table rebuilt
 * without one fails this read by name, never by turning slow.
 *
 * EACH CASE ONCE. A wage request DOL has decided is in its quarterly file (`pwd_cases`) and can also be in its live
 * record (`pwd_case_status`); a PERM case can be in a file and in the live list. Both reads group by case number
 * before they count, so a case in two tables is one filing, dated by its earliest day on record.
 *
 * THE GREEN CARD KIND ONLY. DOL's wage file also holds H-1B, H-2B and CW-1 requests (`PWD_VISA_CLASS`).
 *
 * THE JOB COMES FROM THE FILE. Only `pwd_cases` names a job code, so the Schedule A count is over the requests DOL
 * has decided and published. The rule itself is `isScheduleA`, applied here to each job group the read returns.
 *
 * A failed read throws: the page keeps its last good render, or names the part it couldn't read.
 */

/** The spellings the page reads, with the page's own slug among them: the live PERM list files every matched case under it. */
function withPageSlug(match: EmployerMatch, slug: string): EmployerMatch {
  if (match.basis === "prefix") return match;
  return slugListMatch([...new Set([...match.args, slug])], match.basis);
}

const num = (v: number | string | null | undefined): number => Number(v) || 0;

interface WageRow {
  y: string | null;
  g: string | null;
  n: number | string;
  newest: string | null;
}

interface PermRow {
  y: string | null;
  n: number | string;
  newest: string | null;
}

export const getEmployerStarts = cache(async (slug: string): Promise<EmployerStarts | null> => {
  const match = await employerMatch(slug);
  if (!match) return null;
  const perm = withPageSlug(match, slug);
  const from = `${STARTS_FROM}-01-01`;
  const thisYear = Number(easternDay().slice(0, 4));

  const [wageRows, permRows] = await Promise.all([
    rows<WageRow>(
      `SELECT substr(d, 1, 4) AS y, g, COUNT(*) AS n, MAX(d) AS newest FROM (` +
        `SELECT case_number, MIN(d) AS d, MAX(g) AS g FROM (` +
        `SELECT case_number, received_date AS d, COALESCE(${SOC_GROUP_SQL}, '') AS g ` +
        `FROM pwd_cases INDEXED BY pwd_cases_emp_kind WHERE ${match.where} AND received_date >= ? AND visa_class = ? ` +
        `UNION ALL ` +
        `SELECT case_number, filing_date AS d, '' AS g ` +
        `FROM pwd_case_status INDEXED BY pwd_case_status_emp_kind WHERE ${match.where} AND filing_date >= ? AND visa_type = ?` +
        `) GROUP BY case_number` +
        `) GROUP BY y, g ORDER BY y`,
      [...match.args, from, PWD_VISA_CLASS, ...match.args, from, PWD_VISA_CLASS],
    ),
    rows<PermRow>(
      `SELECT substr(d, 1, 4) AS y, COUNT(*) AS n, MAX(d) AS newest FROM (` +
        `SELECT case_number, MIN(d) AS d FROM (` +
        `SELECT case_number, received_date AS d FROM perm_cases INDEXED BY idx_pc_emp_dec_recv ` +
        `WHERE ${perm.where} AND decision_date >= ? AND received_date >= ? ` +
        `UNION ALL ` +
        `SELECT case_number, received_date AS d FROM perm_cases_history INDEXED BY idx_pch_emp_dec_recv ` +
        `WHERE ${perm.where} AND decision_date >= ? AND received_date >= ? ` +
        `UNION ALL ` +
        `SELECT case_number, filing_date AS d FROM perm_live_recent INDEXED BY perm_live_recent_emp_case ` +
        `WHERE ${perm.where} AND filing_date >= ?` +
        `) GROUP BY case_number` +
        `) GROUP BY y ORDER BY y`,
      [...perm.args, from, from, ...perm.args, from, from, ...perm.args, from],
    ),
  ]);

  const byYear = new Map<number, StartYear>();
  const at = (year: number): StartYear => {
    let row = byYear.get(year);
    if (!row) {
      row = { year, wageRequests: 0, permFiled: 0, scheduleA: 0, jobKnown: 0 };
      byYear.set(year, row);
    }
    return row;
  };
  // A year past this one is a mistyped date: it gets no row, and it can't be the newest filing either.
  const inWindow = (year: number) => year >= STARTS_FROM && year <= thisYear;
  const newer = (a: string | null, b: string | null) => (b && (!a || b > a) ? b : a);

  let newestWageRequest: string | null = null;
  for (const r of wageRows) {
    const year = Number(r.y);
    if (!inWindow(year)) continue;
    const n = num(r.n);
    const row = at(year);
    row.wageRequests += n;
    if (r.g) {
      row.jobKnown += n;
      if (isScheduleA(r.g)) row.scheduleA += n;
    }
    newestWageRequest = newer(newestWageRequest, r.newest);
  }
  let newestPerm: string | null = null;
  for (const r of permRows) {
    const year = Number(r.y);
    if (!inWindow(year)) continue;
    at(year).permFiled += num(r.n);
    newestPerm = newer(newestPerm, r.newest);
  }

  return {
    years: fillStartYears([...byYear.values()], thisYear),
    newestWageRequest,
    newestPerm,
  };
});
