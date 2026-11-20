/**
 * "Add to my cases" on a public case page: the case's DOL record carried to the new-case form in the address, so it
 * survives sign-in (src/lib/auth/returnTo.ts brings the page back) and fills the form for the person to check before
 * saving. Only the public record travels: DOL's number, the employer, the job title, the filed and decided days, the
 * outcome, and a wage request's level and wage. Nothing the person typed or holds privately is in it.
 *
 * The app tracks PERM cases, so the button is on a PERM case (G-100 to G-400) and a PERM wage request (P-100) page.
 */
import { calculatePWDExpiration } from "@/lib/perm";
import { WAGE_ISSUED_RE } from "@/lib/employerWageRequests";

export const DOL_CARRY_PARAM = "add";

export interface DolCarried {
  caseNumber: string;
  employer?: string;
  title?: string;
  /** DOL's filing day, YYYY-MM-DD. */
  filed?: string;
  /** DOL's decision day, YYYY-MM-DD. */
  decided?: string;
  /** DOL's status word as its record prints it ("CERTIFIED", "DETERMINATION ISSUED"). */
  outcome?: string;
  /** A wage request's level and yearly wage, from DOL's file. */
  level?: string;
  wage?: number;
}

const PERM_NUMBER = /^G-[1-4]00-\d{5}-\d+$/;
const PWD_NUMBER = /^P-100-\d{5}-\d+$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 200;

/** True for a number "Add to my cases" carries. */
export function carriesToMyCases(caseNumber: string): boolean {
  return PERM_NUMBER.test(caseNumber) || PWD_NUMBER.test(caseNumber);
}

/** The new-case form's address with the record in it; null for a number the app doesn't track. */
export function dolCarryHref(c: DolCarried): string | null {
  if (!carriesToMyCases(c.caseNumber)) return null;
  const q = new URLSearchParams({ [DOL_CARRY_PARAM]: c.caseNumber });
  if (c.employer) q.set("employer", c.employer.slice(0, TEXT_MAX));
  if (c.title) q.set("title", c.title.slice(0, TEXT_MAX));
  if (c.filed && ISO.test(c.filed)) q.set("filed", c.filed);
  if (c.decided && ISO.test(c.decided)) q.set("decided", c.decided);
  if (c.outcome) q.set("outcome", c.outcome.slice(0, 40));
  if (c.level && /^(I|II|III|IV)$/.test(c.level)) q.set("level", c.level);
  if (c.wage && Number.isFinite(c.wage) && c.wage > 0) q.set("wage", String(Math.round(c.wage)));
  return `/cases/new?${q.toString()}`;
}

/** The record from the address, checked field by field; null when there's no carried number the app tracks. */
export function readDolCarry(params: URLSearchParams): DolCarried | null {
  const caseNumber = (params.get(DOL_CARRY_PARAM) ?? "").trim().toUpperCase();
  if (!carriesToMyCases(caseNumber)) return null;
  const text = (k: string) => {
    const v = params.get(k)?.trim();
    return v ? v.slice(0, TEXT_MAX) : undefined;
  };
  const day = (k: string) => {
    const v = params.get(k)?.trim();
    return v && ISO.test(v) ? v : undefined;
  };
  const wage = Number(params.get("wage"));
  const level = params.get("level")?.trim();
  const out: DolCarried = { caseNumber };
  const employer = text("employer");
  const title = text("title");
  const filed = day("filed");
  const decided = day("decided");
  const outcome = text("outcome")?.toUpperCase();
  if (employer) out.employer = employer;
  if (title) out.title = title;
  if (filed) out.filed = filed;
  if (decided) out.decided = decided;
  if (outcome) out.outcome = outcome;
  if (level && /^(I|II|III|IV)$/.test(level)) out.level = level;
  if (Number.isFinite(wage) && wage > 0) out.wage = Math.round(wage);
  return out;
}

export interface DolCarriedFields {
  employerName?: string;
  positionTitle?: string;
  caseNumber?: string;
  eta9089CaseNumber?: string;
  eta9089FilingDate?: string;
  eta9089CertificationDate?: string;
  eta9089DenialDate?: string;
  pwdCaseNumber?: string;
  pwdFilingDate?: string;
  pwdDeterminationDate?: string;
  pwdExpirationDate?: string;
  pwdWageLevel?: string;
  pwdWageAmount?: number;
}

/**
 * The case fields a carried record fills. A PERM case's number is both the case's DOL number, which turns on its live
 * status, and its ETA 9089 number; a certification or denial day goes in its own field. A wage request issued gets its
 * determination day and the expiration from the central rule, never DOL's file's date, which runs a day early.
 */
export function dolCarriedFields(c: DolCarried): DolCarriedFields {
  const out: DolCarriedFields = {};
  if (c.employer) out.employerName = c.employer;
  if (c.title) out.positionTitle = c.title;
  const outcome = c.outcome ?? "";
  if (PERM_NUMBER.test(c.caseNumber)) {
    out.caseNumber = c.caseNumber;
    out.eta9089CaseNumber = c.caseNumber;
    if (c.filed) out.eta9089FilingDate = c.filed;
    if (c.decided && /CERTIFIED/.test(outcome) && !/WITHDRAWN|EXPIRED/.test(outcome)) out.eta9089CertificationDate = c.decided;
    if (c.decided && /DENIED/.test(outcome)) out.eta9089DenialDate = c.decided;
  } else if (PWD_NUMBER.test(c.caseNumber)) {
    out.pwdCaseNumber = c.caseNumber;
    if (c.filed) out.pwdFilingDate = c.filed;
    if (c.decided && WAGE_ISSUED_RE.test(outcome)) {
      out.pwdDeterminationDate = c.decided;
      out.pwdExpirationDate = calculatePWDExpiration(c.decided);
      if (c.level) out.pwdWageLevel = c.level;
      if (c.wage) out.pwdWageAmount = c.wage;
    }
  }
  return out;
}
