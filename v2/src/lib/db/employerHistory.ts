import "server-only";

import { mergeSocSpellings } from "@/lib/facetClean";
import { neutralPageEntry, shownLabel } from "@/lib/privacy/withheld";

import { rows } from "./client";
import type { EntityFacets, FacetKind } from "./entityDetail";
import { beforeFirstLoad } from "./firstLoad";

/**
 * An employer's PERM record year by year, FY2008 onward, and its decided
 * cases from DOL's older files (FY2008 to FY2023).
 *
 * Both tables are written by `scripts/ingest_perm_history.py`:
 * `perm_employer_years` from DOL's closed-year files (and FY2024 onward from
 * `perm_cases` after every load), `perm_cases_history` for FY2008 to FY2023.
 * A name that no longer matches today's page (a company renamed, a spelling
 * the merge does not join) is simply not in the series, which is why the
 * chart says "matched to this page" rather than "every filing".
 */

export interface EmployerYear {
  fy: number;
  certified: number;
  denied: number;
  withdrawn: number;
}

export interface HistoryCase {
  caseNumber: string;
  status: string;
  decisionDate: string | null;
  jobTitle: string | null;
  state: string | null;
  wage: number | null;
}

/**
 * Every year this employer has, oldest first. Empty when the table is absent. Like the two reads below, a failed
 * read throws: an employer's page is kept for up to 30 days, and must never store "no history" for an employer that
 * has one.
 */
export async function employerYears(slug: string): Promise<EmployerYear[]> {
  const got = await rows<{ fy: number; certified: number; denied: number; withdrawn: number }>(
    "SELECT fy, certified, denied, withdrawn FROM perm_employer_years WHERE slug = ? ORDER BY fy",
    [slug],
  ).catch(beforeFirstLoad([]));
  return got.map((r) => ({
    fy: Number(r.fy),
    certified: Number(r.certified),
    denied: Number(r.denied),
    withdrawn: Number(r.withdrawn),
  }));
}

/** The newest decided cases from DOL's older files (FY2008 to FY2023), off (employer_slug, decision_date). */
export async function employerHistoryCases(slug: string, limit = 25): Promise<HistoryCase[]> {
  const got = await rows<{
    case_number: string;
    status: string;
    decision_date: string | null;
    job_title: string | null;
    state: string | null;
    wage: number | null;
  }>(
    "SELECT case_number, status, decision_date, job_title, state, wage FROM perm_cases_history "
      + "WHERE employer_slug = ? ORDER BY decision_date DESC LIMIT ?",
    [slug, limit],
  ).catch(beforeFirstLoad([]));
  return got.map((r) => ({
    caseNumber: r.case_number,
    status: r.status,
    decisionDate: r.decision_date,
    jobTitle: r.job_title,
    state: r.state,
    wage: r.wage == null ? null : Number(r.wage),
  }));
}

export type WorkerFacet = "citizenship" | "education" | "visa_class" | "institution" | "major";

export interface WorkerFacetRow {
  key: string;
  label: string;
  n: number;
}

/**
 * The worker's side of an employer's or occupation's FY2016 to FY2023 cases:
 * top countries of citizenship, education, visa at filing, schools and fields
 * of study. From `perm_history_facets` (ingest_perm_history.py), written only
 * for entities with 10 or more history cases. DOL publishes these fields on
 * its old form only, so nothing here describes a case filed on the new one.
 */
export async function workerFacets(
  kind: "employer" | "occupation",
  slug: string,
): Promise<Partial<Record<WorkerFacet, WorkerFacetRow[]>>> {
  const got = await rows<{ facet: string; key: string; label: string; n: number }>(
    "SELECT facet, key, label, n FROM perm_history_facets WHERE kind = ? AND slug = ? ORDER BY facet, pos",
    [kind, slug],
  ).catch(beforeFirstLoad([]));
  const out: Partial<Record<WorkerFacet, WorkerFacetRow[]>> = {};
  for (const r of got) {
    const f = r.facet as WorkerFacet;
    (out[f] ??= []).push({ key: r.key, label: r.label, n: Number(r.n) });
  }
  return out;
}

export interface HistoryMakeup {
  /** The entity's older cases these rows were counted over: the denominator of every share. */
  total: number;
  /** Its first and last fiscal year among them, for the label. */
  fyFrom: number;
  fyTo: number;
  facets: EntityFacets;
}

/**
 * What an employer's, a law firm's or an occupation's older cases (FY2008 to FY2023, `perm_cases_history`) were made
 * of: an employer's jobs, states, firms, cities and industries; a firm's clients, jobs and states; an occupation's
 * sponsors, firms, states and cities; with the entity's own total and years. From `perm_history_entity_facets`
 * (ingest_perm_history.py, rebuilt with each history load), written for entities with three or more older cases;
 * null for the rest. The current figures (`entityFacets`) count FY2024 on, so the two never share a denominator.
 * One read, keyed on the table's primary key.
 *
 * A firm or an employer withheld at its owner's request comes back from `rows()` with its neutral slug; its label is
 * then the neutral one too, whatever spelling DOL's older file printed, so no name sits beside the neutral link.
 */
export async function historyMakeup(
  kind: "employer" | "attorney" | "occupation",
  slug: string,
): Promise<HistoryMakeup | null> {
  const got = await rows<{
    facet: string;
    key: string | null;
    label: string;
    code: string | null;
    n: number | string;
    certified: number | string;
    denied: number | string;
    total: number | string;
    fy_from: number | string;
    fy_to: number | string;
  }>(
    "SELECT facet, key, label, code, n, certified, denied, total, fy_from, fy_to "
      + "FROM perm_history_entity_facets WHERE kind = ? AND slug = ? ORDER BY facet, pos",
    [kind, slug],
  ).catch(beforeFirstLoad([]));
  const first = got[0];
  if (!first) return null;
  const facets: EntityFacets = {};
  for (const r of got) {
    const withheld = (r.facet === "attorney" || r.facet === "employer") && r.key ? neutralPageEntry(r.facet, r.key) : null;
    (facets[r.facet as FacetKind] ??= []).push({
      key: r.key,
      label: withheld ? shownLabel(withheld) : r.label,
      code: r.code,
      n: Number(r.n),
      certified: Number(r.certified),
      denied: Number(r.denied),
    });
  }
  if (facets.occupation) facets.occupation = mergeSocSpellings(facets.occupation);
  return { total: Number(first.total), fyFrom: Number(first.fy_from), fyTo: Number(first.fy_to), facets };
}
