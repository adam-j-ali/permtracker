import "server-only";

import { cache } from "react";

import { NEWER_FROM_FY } from "../employerPrograms";
import type { LcaOlderRow } from "../lcaProfile";
import { one } from "./client";
import { employerMatch } from "./employerSlugs";
import { beforeFirstLoad } from "./firstLoad";

/**
 * What DOL's older yearly files hold for one employer: its PERM decisions FY2008 to FY2023 and its LCAs FY2008 to
 * FY2019, with what those LCAs were for.
 *
 * The older files sit in tables of their own (`perm_cases_history`, `lca_cases_history`) that change only when one
 * of them loads, and a page must never scan them, so their share is counted at the load into two small tables in the
 * main database: `perm_employer_years` (scripts/ingest_perm_history.py; the years before NEWER_FROM_FY.perm, since
 * FY2024 on is counted from `perm_cases` itself) and `history_lca_spellings` (scripts/lca_history_totals.py; without
 * the cases `lca_cases` also holds, so nothing is counted twice). One statement reads both, over the spellings the
 * rest of the page reads (`employerMatch`), on each table's own key: the employer page's program ledger and its LCA
 * panel share this one read through React's `cache`.
 *
 * Null when the page has no spellings or the tables aren't built yet; any other failure throws, so a page never
 * prints the newer files alone as every year.
 */

export interface OlderFiles {
  /** PERM decisions in DOL's FY2008 to FY2023 files: certified, denied and withdrawn. */
  perm: number;
  /** LCAs in DOL's FY2008 to FY2019 files that the newer files don't also hold, every visa. */
  lca: number;
  /** What those LCAs were for, as the LCA panel's row names it; null when there are none. */
  lcaRow: LcaOlderRow | null;
}

type Row = LcaOlderRow & { perm_n: number | string | null };

/**
 * The read, over one employer's spellings (`where`, a condition on `employer_slug`). `perm_employer_years` names a
 * spelling `slug`, so the same condition is written on that column. Its arguments: the spellings', the first newer
 * PERM year, the spellings' again.
 */
export function olderFilesSql(where: string): string {
  const permWhere = where.replace(/\bemployer_slug\b/g, "slug");
  return (
    "SELECT (SELECT SUM(certified + denied + withdrawn) FROM perm_employer_years " +
    `WHERE ${permWhere} AND fy < ?) AS perm_n, ` +
    "SUM(n) AS filings, MIN(fy_from) AS fy_from, SUM(certified) AS certified, " +
    "SUM(detail_rows) AS detail_rows, SUM(positions) AS positions, " +
    "SUM(new_employment) AS new_employment, SUM(change_employer) AS change_employer, " +
    "SUM(continued_employment) AS continued_employment, " +
    "SUM(change_previous_employment) AS change_previous_employment, " +
    "SUM(new_concurrent_employment) AS new_concurrent_employment, SUM(amended_petition) AS amended_petition, " +
    "SUM(level_1) AS level_1, SUM(level_2) AS level_2, SUM(level_3) AS level_3, SUM(level_4) AS level_4, " +
    "SUM(level_rows) AS level_rows, " +
    "SUM(dependent_rows) AS dependent_rows, SUM(dependent_yes) AS dependent_yes, " +
    "SUM(violator_rows) AS violator_rows, SUM(violator_yes) AS violator_yes, " +
    "SUM(visa_h1b) AS visa_h1b, SUM(visa_e3) AS visa_e3, " +
    "SUM(visa_h1b1_chile) AS visa_h1b1_chile, SUM(visa_h1b1_singapore) AS visa_h1b1_singapore " +
    `FROM history_lca_spellings WHERE ${where}`
  );
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const employerOlderFiles = cache(async (slug: string): Promise<OlderFiles | null> => {
  const match = await employerMatch(slug);
  if (!match) return null;
  const row = await one<Row>(olderFilesSql(match.where), [...match.args, NEWER_FROM_FY.perm, ...match.args]).catch(
    (e: unknown) => {
      // A table built before the profile's columns is as good as not built for this read; the next history build
      // adds them. Anything else throws (beforeFirstLoad).
      if (/no such column/i.test(String((e as Error | undefined)?.message ?? e))) return undefined;
      return beforeFirstLoad(undefined)(e);
    },
  );
  if (row === undefined) return null;
  const lca = num(row?.filings);
  if (!row) return { perm: 0, lca: 0, lcaRow: null };
  const { perm_n, ...lcaRow } = row;
  return { perm: num(perm_n), lca, lcaRow: lca > 0 ? lcaRow : null };
});
