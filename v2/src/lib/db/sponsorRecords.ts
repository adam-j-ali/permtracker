import "server-only";

import { CURRENT_FIRST_FY } from "@/lib/permEras";
import { one } from "./client";
import { employerMatch } from "./employerSlugs";
import { beforeFirstLoad } from "./firstLoad";

/**
 * What DOL's own record shows for a company the Justice or Labor Department acted against: its decided PERM
 * filings in DOL's published files (every year, FY2008 on), its newest PERM filing anywhere in the record, the
 * PERM cases still waiting, and the H-1B LCAs it filed on or after a day (the day an action was announced). Each
 * read is one index search on the page's own slug (perm_entities, perm_employer_years_cover, idx_pc_emp_*,
 * perm_live_recent_emp, perm_entity_pending, and idx_pch_emp_dec_recv only for a company with no filing since
 * FY2023), so a page of 15 companies costs about 90 point reads. The LCAs are read through the
 * spellings the nightly map gives the employer's page (employerMatch), as the employer page reads them: DOL
 * prints each form's own spelling, and one company files LCAs under several (Nov 4 2026).
 *
 * A failed read throws: the page keeps its last good render rather than print a failed read as "none".
 */

export interface SponsorRecord {
  slug: string;
  /** The page's name, from whichever index holds it. */
  name: string;
  /**
   * Decided PERM filings in DOL's published files, every year FY2008 on, as the employer page's yearly chart counts
   * them. Null when it has no PERM page.
   */
  perm: number | null;
  /** The newest PERM filing day in the published files or the live record. */
  lastPerm: string | null;
  /** PERM cases still waiting at DOL. */
  waiting: number;
  /** H-1B LCAs filed on or after `since`. */
  lcaSince: number;
  since: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export async function getSponsorRecord(slug: string, since: string): Promise<SponsorRecord> {
  const match = (await employerMatch(slug)) ?? { where: "employer_slug = ?", args: [slug] };
  const [entity, years, liveOnly, other, published, live, pending, lca] = await Promise.all([
    one<{ total: unknown; name: unknown }>("SELECT total, name FROM perm_entities WHERE kind = 'employer' AND slug = ?", [slug]),
    // Every year DOL published, FY2008 on: the yearly table the employer page charts, read on its covering index.
    // perm_entities' total is the current files' alone (FY2024 on).
    one<{ n: unknown }>(
      "SELECT SUM(certified + denied + withdrawn) AS n FROM perm_employer_years WHERE slug = ?",
      [slug],
    ).catch(beforeFirstLoad(null)),
    one<{ name: unknown }>("SELECT name FROM perm_live_only_index WHERE slug = ?", [slug]),
    one<{ name: unknown }>("SELECT name FROM employer_other_index WHERE slug = ?", [slug]),
    one<{ d: unknown }>("SELECT MAX(received_date) AS d FROM perm_cases WHERE employer_slug = ?", [slug]),
    one<{ d: unknown }>("SELECT MAX(filing_date) AS d FROM perm_live_recent WHERE employer_slug = ?", [slug]),
    one<{ pending: unknown }>("SELECT pending FROM perm_entity_pending WHERE kind = 'employer' AND slug = ?", [slug]),
    one<{ n: unknown }>(
      `SELECT COUNT(*) AS n FROM lca_case_status WHERE ${match.where} AND filing_date >= ?`,
      [...match.args, since],
    ),
  ]);
  const days = [day(published?.d), day(live?.d)].filter((d): d is string => d !== null).sort();
  // The older table (FY2008 to FY2023) can hold the newest filing only for an employer with none filed since it
  // ends, so it's read only then: one index-only read of that employer's rows (idx_pch_emp_dec_recv).
  if (!days.some((d) => d >= `${CURRENT_FIRST_FY - 1}-09-30`)) {
    const older = await one<{ d: unknown }>(
      "SELECT MAX(received_date) AS d FROM perm_cases_history WHERE employer_slug = ?",
      [slug],
    ).catch(beforeFirstLoad(null));
    const d = day(older?.d);
    if (d) days.push(d);
    days.sort();
  }
  const name = [entity?.name, liveOnly?.name, other?.name].find((n): n is string => typeof n === "string" && n.trim() !== "");
  const allYears = years && years.n != null ? num(years.n) : 0;
  return {
    slug,
    name: name ?? slug,
    perm: allYears > 0 ? allYears : entity ? num(entity.total) : null,
    lastPerm: days.length ? days[days.length - 1]! : null,
    waiting: num(pending?.pending),
    lcaSince: num(lca?.n),
    since,
  };
}

/** One record per slug, the same day for each. */
export async function getSponsorRecords(slugs: readonly string[], since: (slug: string) => string): Promise<Map<string, SponsorRecord>> {
  const unique = [...new Set(slugs)];
  const records = await Promise.all(unique.map((s) => getSponsorRecord(s, since(s))));
  return new Map(records.map((r) => [r.slug, r]));
}
