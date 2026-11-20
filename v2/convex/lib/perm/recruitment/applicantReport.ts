/**
 * The applicant log's outcomes and the recruitment report built from it.
 *
 * 20 CFR 656.17(g)(1) asks for a report, signed by the employer or its representative, "describing the recruitment
 * steps undertaken and the results achieved, the number of hires, and, if applicable, the number of U.S. workers
 * rejected, categorized by the lawful job related reasons for such rejections". This builds the draft of that report
 * from what the account typed: every reason is written by a person, and nothing here judges, screens or ranks an
 * applicant. (g)(2): a worker who could learn the job's skills in a reasonable period of on-the-job training is
 * qualified, so lacking those skills isn't a lawful reason; the form says so beside the reason.
 */
import { caseRecruitmentSteps, type CaseRecruitmentFields, type RecruitmentStep } from "./steps";

export const APPLICANT_OUTCOMES = [
  { key: "pending", label: "Still being considered" },
  { key: "not_qualified", label: "Didn't meet the job's stated requirements" },
  { key: "no_response", label: "Didn't respond when contacted" },
  { key: "declined", label: "Declined an interview or the offer" },
  { key: "not_available", label: "Not available for the job" },
  { key: "withdrew", label: "Withdrew" },
  { key: "hired", label: "Hired" },
  { key: "other", label: "Another lawful, job-related reason" },
] as const;

export type ApplicantOutcome = (typeof APPLICANT_OUTCOMES)[number]["key"];

export const CONTACT_METHODS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "letter", label: "Letter" },
  { key: "in_person", label: "In person" },
  { key: "other", label: "Another way" },
] as const;

export type ContactMethod = (typeof CONTACT_METHODS)[number]["key"];

/** The longest reference and reason the log keeps. */
export const APPLICANT_REF_MAX = 40;
export const APPLICANT_REASON_MAX = 600;
/** The most applicants one case's log holds: recruitment for one job, with room to spare. */
export const APPLICANTS_PER_CASE_MAX = 500;

export interface ApplicantEntry {
  ref: string;
  appliedOn?: string | null;
  /** The recruitment step the applicant answered (a key in steps.ts), when known. */
  source?: string | null;
  contactedOn?: string | null;
  contactMethod?: ContactMethod | null;
  outcome: ApplicantOutcome;
  reason?: string | null;
}

export interface OutcomeGroup {
  key: ApplicantOutcome;
  label: string;
  entries: ApplicantEntry[];
}

export interface RecruitmentReport {
  steps: RecruitmentStep[];
  total: number;
  hired: number;
  pending: number;
  /** Applicants not hired and no longer being considered, whatever the reason. */
  notHired: number;
  /** The not-hired applicants grouped by outcome, in the form's order, each group's entries by reference. */
  groups: OutcomeGroup[];
  /** Not hired with no reason written: the report can't be final until each has one. */
  withoutReason: ApplicantEntry[];
}

const LABEL: Record<ApplicantOutcome, string> = Object.fromEntries(APPLICANT_OUTCOMES.map((o) => [o.key, o.label])) as Record<
  ApplicantOutcome,
  string
>;

export function outcomeLabel(outcome: ApplicantOutcome): string {
  return LABEL[outcome];
}

/** The draft report: the case's steps from its own dates, and the log's results. */
export function recruitmentReport(c: CaseRecruitmentFields, applicants: readonly ApplicantEntry[]): RecruitmentReport {
  const notHiredKeys = APPLICANT_OUTCOMES.map((o) => o.key).filter((k) => k !== "hired" && k !== "pending");
  const groups: OutcomeGroup[] = notHiredKeys
    .map((key) => ({
      key,
      label: LABEL[key],
      entries: applicants.filter((a) => a.outcome === key).sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true })),
    }))
    .filter((g) => g.entries.length > 0);
  const notHired = groups.reduce((n, g) => n + g.entries.length, 0);
  return {
    steps: caseRecruitmentSteps(c),
    total: applicants.length,
    hired: applicants.filter((a) => a.outcome === "hired").length,
    pending: applicants.filter((a) => a.outcome === "pending").length,
    notHired,
    groups,
    withoutReason: groups.flatMap((g) => g.entries).filter((a) => !a.reason?.trim()),
  };
}
