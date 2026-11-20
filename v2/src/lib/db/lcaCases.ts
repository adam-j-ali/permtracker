import "server-only";
import { wageRequestNumber } from "@/lib/caseLinks";
import { one } from "./client";
import { makeFlagProgram } from "./flagCases";

/**
 * Labor condition applications (ETA-9035), the H-1B, H-1B1 and E-3 wage
 * attestation. FLAG numbers them by visa: `I-200-` H-1B, `I-201-` H-1B1
 * Chile, `I-202-` H-1B1 Singapore, `I-203-` E-3 Australian (the visa class
 * DOL's own disclosure file prints for each prefix). DOL's
 * stated target is a decision within seven business days, so the pending
 * set is small and the interesting half is the record itself: who filed,
 * for what title, when. Same factory as the PWD program.
 */

/** Must stay identical to PROGRAMS["lca"]["final"] in scripts/ingest_pwd_status_direct.py. */
export const LCA_FINAL_STATUSES: ReadonlySet<string> = new Set([
  "CERTIFIED",
  "CERTIFIED - WITHDRAWN",
  "CERTIFIED-WITHDRAWN",
  "DENIED",
  "WITHDRAWN",
]);

export const lca = makeFlagProgram({
  key: "lca",
  table: "lca_case_status",
  numberRe: /^I-\d{3}-\d{5}-\d+$/,
  finalStatuses: LCA_FINAL_STATUSES,
  docKey: "lca_live_summary",
  discoverySource: "flag.dol.gov/recaptcha/caseStatus (DOL, via lookup)",
  budgetPrefix: "lca_discovery_budget_",
  // DOL's quarterly LCA file: the decided record with the OFFERED wage.
  disclosureTable: "lca_cases",
  // DOL's FY2008 to FY2019 files (scripts/ingest_flag_disclosure.py HISTORY_TABLES).
  disclosureHistoryTable: "lca_cases_history",
  disclosureDocKey: "flag_disclosure_summary_lca",
  // A broad name ("Am": 168,861 LCAs) is read newest-first (BROAD_NAME_ROWS).
  disclosureByDateIndex: "lca_cases_recv",
  // A name with a job title tests the title on the index ("EMC" and one title: 15 s became 0.03 s).
  disclosureByTitleIndex: "lca_cases_emp_title",
  // The older files with a job title ("Deloitte" and one title walked 97,155 old LCAs: Sentry 61, Nov 19 2026).
  disclosureHistoryByTitleIndex: "lca_cases_history_emp_title",
});

export const normaliseLcaCaseNumber = lca.normalise;
export const lookupLcaCase = lca.lookup;
export const lookupLcaCaseOutcome = lca.lookupOutcome;
export const searchLcaCases = lca.search;
export const listLcaCases = lca.list;
export const getLcaSummary = lca.getSummary;
export const lookupLcaDisclosed = lca.lookupDisclosed;
export const searchLcaDisclosed = lca.searchDisclosed;
export const getLcaDisclosureSummary = lca.getDisclosureSummary;

/**
 * What DOL's quarterly file prints about a decided LCA's job beyond the shared columns: the prevailing wage, its level
 * and where it came from, the worksite city and county, the workers, the kind of petition, the job's dates, the law
 * firm, the industry, the employer's H-1B-dependent and willful-violator answers, and the wage request it cites (a
 * few rows do). The current files' table first, then the FY2008 to FY2019 one (`lca_cases_history`, the same
 * columns), so an older LCA keeps every field. Null when neither holds the LCA; a missing older table is "none
 * there", and any other failed read throws, so the page can say so.
 */
export interface LcaRecordDetail {
  wageRequest: string | null;
  level: string | null;
  prevailingWage: number | null;
  prevailingUnit: string | null;
  /** "OFLC wage data, 7/1/2019 - 6/30/2020", or the other survey the employer named. */
  prevailingSource: string | null;
  worksiteCity: string | null;
  worksiteCounty: string | null;
  workers: number | null;
  /** The form's kinds of petition with a worker in them, in the form's order. */
  kinds: string[];
  begins: string | null;
  ends: string | null;
  attorneyName: string | null;
  attorneySlug: string | null;
  naics: string | null;
  h1bDependent: boolean | null;
  willfulViolator: boolean | null;
}

/** The LCA form's kinds of petition (section B), each a count of workers in DOL's file. */
const PETITION_KINDS: readonly [string, string][] = [
  ["new_employment", "New employment"],
  ["continued_employment", "Continuing the same job with the same employer"],
  ["change_previous_employment", "A change to the same job"],
  ["new_concurrent_employment", "New concurrent employment"],
  ["change_employer", "A change of employer"],
  ["amended_petition", "An amended petition"],
];

const cell = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const count = (v: unknown) => (cell(v) === null || !Number.isFinite(Number(v)) ? null : Number(v));
const yes = (v: unknown) => (cell(v) === null ? null : /^(y|yes|true|1)$/i.test(String(v).trim()));

export async function lookupLcaRecord(input: string): Promise<LcaRecordDetail | null> {
  const caseNumber = lca.normalise(input);
  if (!caseNumber) return null;
  const cols = `pw_case, wage_level, pw_wage, pw_unit, pw_oes_year, pw_other_source, pw_other_year, pw_survey_publisher,
            pw_survey_name, worksite_city, worksite_county, workers, ${PETITION_KINDS.map(([c]) => c).join(", ")},
            begin_date, end_date, attorney_name, attorney_slug, naics, h1b_dependent, willful_violator`;
  const r =
    (await one<Record<string, unknown>>(`SELECT ${cols} FROM lca_cases WHERE case_number = ? LIMIT 1`, [caseNumber])) ??
    (await one<Record<string, unknown>>(`SELECT ${cols} FROM lca_cases_history WHERE case_number = ? LIMIT 1`, [caseNumber]).catch(
      (err: unknown) => {
        if (/no such table/i.test(err instanceof Error ? err.message : String(err))) return null;
        throw err;
      },
    ));
  if (!r) return null;
  const other = [cell(r.pw_other_source), cell(r.pw_survey_publisher), cell(r.pw_survey_name)].filter(Boolean).join(", ");
  const otherYear = cell(r.pw_other_year);
  return {
    wageRequest: wageRequestNumber(cell(r.pw_case)),
    level: cell(r.wage_level),
    prevailingWage: count(r.pw_wage),
    prevailingUnit: cell(r.pw_unit),
    prevailingSource: cell(r.pw_oes_year) ? `OFLC wage data, ${cell(r.pw_oes_year)}` : other ? `${other}${otherYear ? ` (${otherYear})` : ""}` : null,
    worksiteCity: cell(r.worksite_city),
    worksiteCounty: cell(r.worksite_county),
    workers: count(r.workers),
    kinds: PETITION_KINDS.filter(([c]) => (count(r[c]) ?? 0) > 0).map(([, label]) => label),
    begins: cell(r.begin_date)?.slice(0, 10) ?? null,
    ends: cell(r.end_date)?.slice(0, 10) ?? null,
    attorneyName: cell(r.attorney_name),
    attorneySlug: cell(r.attorney_slug),
    naics: cell(r.naics),
    h1bDependent: yes(r.h1b_dependent),
    willfulViolator: yes(r.willful_violator),
  };
}
