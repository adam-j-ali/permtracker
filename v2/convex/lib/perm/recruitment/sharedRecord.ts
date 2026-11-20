/**
 * The recruitment record a client sees through a share link (convex/recruitmentShares.ts): the employer, the job
 * title, each recruitment step with its dates, the filing window and the applicant log. Built field by field from the
 * case, never by copying it, so nothing else a case holds can reach the link: no beneficiary identifier, case number,
 * wage, notes, documents, newspaper or outlet names, and no note kept on an applicant who was hired or is still being
 * considered (the log's form labels that field "Notes"; for everyone else it's the lawful, job-related reason).
 *
 * Pure, so the projection is tested on its own and the query only reads rows.
 */
import { isISODateString } from "../types";
import type { ApplicantEntry, ApplicantOutcome, ContactMethod } from "./applicantReport";
import { RECRUITMENT_STEPS, recruitmentStep, type CaseRecruitmentFields, type RecruitmentStepKey } from "./steps";

/** One date, or a run of dates, a step took place on. */
export interface SharedDates {
  start: string;
  end: string | null;
}

export interface SharedStep {
  key: RecruitmentStepKey;
  label: string;
  /** Earliest first; empty until the step's date is entered. */
  dates: SharedDates[];
}

export interface SharedApplicant {
  ref: string;
  appliedOn: string | null;
  contactedOn: string | null;
  contactMethod: ContactMethod | null;
  outcome: ApplicantOutcome;
  /** The reason given for an applicant who wasn't hired; null otherwise. */
  reason: string | null;
}

export interface SharedRecruitmentRecord {
  employerName: string;
  positionTitle: string;
  steps: SharedStep[];
  /** The ETA 9089 filing window, when either end is known. */
  filingWindow: { opens: string | null; closes: string | null } | null;
  applicants: SharedApplicant[];
}

/** The case fields the record reads. */
export interface SharedCaseFields extends CaseRecruitmentFields {
  employerName: string;
  positionTitle: string;
  jobOrderEndDate?: string | null;
  noticeOfFilingEndDate?: string | null;
  additionalRecruitmentMethods?: ReadonlyArray<{
    method: string;
    date?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    subEntries?: ReadonlyArray<{ date: string }> | null;
  }> | null;
  filingWindowOpens?: string | null;
  filingWindowCloses?: string | null;
}

const day = (d: string | null | undefined): string | null => (isISODateString(d) ? d : null);

function span(start: string | null | undefined, end?: string | null): SharedDates | null {
  const s = day(start);
  return s ? { start: s, end: day(end) } : null;
}

/** Whether the log's reason field holds a reason (not hired) rather than a private note (hired or pending). */
function isReason(outcome: ApplicantOutcome): boolean {
  return outcome !== "hired" && outcome !== "pending";
}

export function sharedRecruitmentRecord(c: SharedCaseFields, applicants: readonly ApplicantEntry[]): SharedRecruitmentRecord {
  const dates = new Map<RecruitmentStepKey, SharedDates[]>();
  const add = (key: RecruitmentStepKey, d: SharedDates | null) => {
    if (d) dates.set(key, [...(dates.get(key) ?? []), d]);
  };

  add("job_order", span(c.jobOrderStartDate, c.jobOrderEndDate));
  add("sunday_ad_1", span(c.sundayAdFirstDate));
  add("sunday_ad_2", span(c.sundayAdSecondDate));
  add("notice_of_filing", span(c.noticeOfFilingStartDate, c.noticeOfFilingEndDate));

  const listed = new Set<RecruitmentStepKey>();
  for (const m of c.additionalRecruitmentMethods ?? []) {
    const step = recruitmentStep(m.method);
    if (!step || step.kind !== "additional") continue;
    listed.add(step.key);
    add(step.key, m.startDate ? span(m.startDate, m.endDate) : span(m.date));
    for (const sub of m.subEntries ?? []) add(step.key, span(sub.date));
  }

  const steps = RECRUITMENT_STEPS.filter((s) => s.kind === "every" || listed.has(s.key)).map((s) => ({
    key: s.key,
    label: s.label,
    dates: [...(dates.get(s.key) ?? [])].sort((a, b) => a.start.localeCompare(b.start)),
  }));

  const opens = day(c.filingWindowOpens);
  const closes = day(c.filingWindowCloses);

  return {
    employerName: c.employerName,
    positionTitle: c.positionTitle,
    steps,
    filingWindow: opens || closes ? { opens, closes } : null,
    applicants: applicants.map((a) => {
      const reason = a.reason?.trim();
      return {
        ref: a.ref,
        appliedOn: day(a.appliedOn),
        contactedOn: day(a.contactedOn),
        contactMethod: a.contactMethod ?? null,
        outcome: a.outcome,
        reason: isReason(a.outcome) && reason ? reason : null,
      };
    }),
  };
}
