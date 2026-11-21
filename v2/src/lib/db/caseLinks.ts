import "server-only";

import { rows } from "./client";

/** Numbers one statement asks about: well under SQLite's bound-parameter limit. */
const CHUNK = 500;

/**
 * How many decided PERM cases DOL's published file names each wage request on, by the request's
 * number, on `idx_pc_pwd_number`. A request no decided case names is left out of the answer, so
 * a missing number means "none decided yet", and a failed read throws rather than answering none.
 */
export async function permsNaming(numbers: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const asked = [...new Set(numbers)];
  for (let i = 0; i < asked.length; i += CHUNK) {
    const chunk = asked.slice(i, i + CHUNK);
    const got = await rows<{ pwd_number: string; n: number | string }>(
      `SELECT pwd_number, COUNT(*) AS n FROM perm_cases WHERE pwd_number IN (${chunk.map(() => "?").join(",")}) GROUP BY pwd_number`,
      chunk,
    );
    // libSQL returns integers as strings.
    for (const r of got) out.set(String(r.pwd_number), Number(r.n));
  }
  return out;
}

/** How many of each kind the wage request's page lists: the newest, with the rest a search away. */
export const CITING_LIMIT = 5;

/** An LCA or a seasonal job order that cites a wage request in DOL's files. */
export interface CaseCitingPwd {
  caseNumber: string;
  kind: "lca" | "seasonal";
  /** The visa the LCA or job order is for, as DOL's file prints it. */
  program: string | null;
  employerName: string | null;
  status: string | null;
  /** The LCA's decision day, or the day DOL accepted the job order. */
  day: string | null;
}

const text = (v: unknown) => (v == null || v === "" ? null : String(v));

/**
 * The LCAs and seasonal job orders that cite this wage request, newest first, CITING_LIMIT of each: one keyed read
 * of each table on its partial index (idx_lca_cases_pw_case, idx_seasonal_postings_pwd, built Nov 21 2026; rows
 * citing nothing are NULL, so `= ?` meets the index's IS NOT NULL). A read that fails throws, so a page can't take
 * it for none.
 */
export async function casesCitingPwd(pwdNumber: string): Promise<CaseCitingPwd[]> {
  if (!/^P-\d{3}-/.test(pwdNumber)) return [];
  const [lcas, seasonal] = await Promise.all([
    rows<Record<string, unknown>>(
      `SELECT case_number, employer_name, case_status, decision_date, visa_class FROM lca_cases
        WHERE pw_case = ? ORDER BY decision_date DESC LIMIT ${CITING_LIMIT}`,
      [pwdNumber],
    ),
    rows<Record<string, unknown>>(
      `SELECT case_number, employer_name, accepted_date, visa FROM seasonal_postings
        WHERE pwd_number = ? ORDER BY accepted_date DESC LIMIT ${CITING_LIMIT}`,
      [pwdNumber],
    ),
  ]);
  const out: CaseCitingPwd[] = [];
  for (const r of lcas) {
    const caseNumber = text(r.case_number);
    if (caseNumber) {
      out.push({ caseNumber, kind: "lca", program: text(r.visa_class), employerName: text(r.employer_name), status: text(r.case_status), day: text(r.decision_date)?.slice(0, 10) ?? null });
    }
  }
  for (const r of seasonal) {
    const caseNumber = text(r.case_number);
    if (caseNumber) {
      out.push({ caseNumber, kind: "seasonal", program: text(r.visa), employerName: text(r.employer_name), status: null, day: text(r.accepted_date)?.slice(0, 10) ?? null });
    }
  }
  return out;
}
