/**
 * The recruitment a PERM application needs before it's filed, as data: each step, the rule that asks for it, and the
 * proof the rule names for it. Read from the rule's own text (20 CFR 656.17(e) and 656.10(d), eCFR, Nov 20 2026).
 *
 * Held as data, not written into the screens, because DOL's proposed PERM rule may change the steps: a new rule's
 * steps are added here beside today's, and every screen that lists a step or a proof slot reads this file.
 *
 * Today's rule, in short:
 * - every job: a 30-day job order with the state workforce agency, two print ads on two different Sundays, and the
 *   Notice of Filing posted for 10 consecutive business days (656.17(e)(1)(i), (e)(2); 656.10(d));
 * - a professional job: three more steps from ten listed (656.17(e)(1)(ii)(A) to (J)), and one of the two Sunday ads
 *   may run in a professional journal when the job needs experience and an advanced degree (656.17(e)(1)(i)(B)(4)).
 */

export type RecruitmentStepKey =
  | "job_order"
  | "sunday_ad_1"
  | "sunday_ad_2"
  | "notice_of_filing"
  | "job_fair"
  | "employer_website"
  | "job_website_ad"
  | "on_campus_recruitment"
  | "trade_organization"
  | "private_employment_firm"
  | "employee_referral"
  | "campus_placement"
  | "local_newspaper"
  | "radio_ad"
  | "tv_ad";

export interface RecruitmentStep {
  key: RecruitmentStepKey;
  label: string;
  /** The paragraph of 20 CFR that asks for the step. */
  cite: string;
  /** The proof the rule names, in plain words. */
  proof: string;
  /** True when the rule says the dates on the application are themselves the proof, so an upload is optional. */
  datesAreProof?: boolean;
  /** "every" for every job, "additional" for the professional job's three chosen steps. */
  kind: "every" | "additional";
}

export const RECRUITMENT_STEPS: readonly RecruitmentStep[] = [
  {
    key: "job_order",
    label: "Job order with the state workforce agency",
    cite: "20 CFR 656.17(e)(1)(i)(A)",
    proof: "The job order's start and end dates on the application are its proof. A printout of the posting is useful to keep.",
    datesAreProof: true,
    kind: "every",
  },
  {
    key: "sunday_ad_1",
    label: "First Sunday newspaper ad",
    cite: "20 CFR 656.17(e)(1)(i)(B)",
    proof: "A copy of the newspaper page the ad appeared on, or the newspaper's proof of publication.",
    kind: "every",
  },
  {
    key: "sunday_ad_2",
    label: "Second Sunday newspaper ad, or the professional journal ad",
    cite: "20 CFR 656.17(e)(1)(i)(B)",
    proof: "A copy of the page the ad appeared on, or the newspaper's proof of publication.",
    kind: "every",
  },
  {
    key: "notice_of_filing",
    label: "Notice of Filing",
    cite: "20 CFR 656.10(d)",
    proof: "A copy of the posted notice and where it was posted, and copies of the in-house media it went out in.",
    kind: "every",
  },
  {
    key: "job_fair",
    label: "Job fair",
    cite: "20 CFR 656.17(e)(1)(ii)(A)",
    proof: "Brochures advertising the fair, and newspaper ads naming the employer as a participant.",
    kind: "additional",
  },
  {
    key: "employer_website",
    label: "The employer's website",
    cite: "20 CFR 656.17(e)(1)(ii)(B)",
    proof: "Dated copies of the site's pages advertising the job.",
    kind: "additional",
  },
  {
    key: "job_website_ad",
    label: "A job search website other than the employer's",
    cite: "20 CFR 656.17(e)(1)(ii)(C)",
    proof: "Dated copies of the website's pages advertising the job.",
    kind: "additional",
  },
  {
    key: "on_campus_recruitment",
    label: "On-campus recruiting",
    cite: "20 CFR 656.17(e)(1)(ii)(D)",
    proof: "The placement office's notice naming the employer and the date it interviewed for the job.",
    kind: "additional",
  },
  {
    key: "trade_organization",
    label: "Trade or professional organization",
    cite: "20 CFR 656.17(e)(1)(ii)(E)",
    proof: "Copies of the newsletter or trade journal pages carrying the ad.",
    kind: "additional",
  },
  {
    key: "private_employment_firm",
    label: "Private employment firm",
    cite: "20 CFR 656.17(e)(1)(ii)(F)",
    proof: "The contract with the firm, and copies of the ads it placed for the job.",
    kind: "additional",
  },
  {
    key: "employee_referral",
    label: "Employee referral program with incentives",
    cite: "20 CFR 656.17(e)(1)(ii)(G)",
    proof: "Dated notices or memos advertising the program and the incentives it offers.",
    kind: "additional",
  },
  {
    key: "campus_placement",
    label: "Campus placement office",
    cite: "20 CFR 656.17(e)(1)(ii)(H)",
    proof: "The employer's notice of the job given to the placement office.",
    kind: "additional",
  },
  {
    key: "local_newspaper",
    label: "Local or ethnic newspaper",
    cite: "20 CFR 656.17(e)(1)(ii)(I)",
    proof: "A copy of the newspaper page carrying the ad.",
    kind: "additional",
  },
  {
    key: "radio_ad",
    label: "Radio ad",
    cite: "20 CFR 656.17(e)(1)(ii)(J)",
    proof: "The ad's text, and the station's written confirmation of when it aired.",
    kind: "additional",
  },
  {
    key: "tv_ad",
    label: "Television ad",
    cite: "20 CFR 656.17(e)(1)(ii)(J)",
    proof: "The ad's text, and the station's written confirmation of when it aired.",
    kind: "additional",
  },
];

const BY_KEY: ReadonlyMap<string, RecruitmentStep> = new Map(RECRUITMENT_STEPS.map((s) => [s.key, s]));

/** A step's label inside a sentence: its first letter lowercased, a proper noun such as Sunday kept. */
export function stepInSentence(step: RecruitmentStep): string {
  return step.label.charAt(0).toLowerCase() + step.label.slice(1);
}

/** A step by its key, or undefined for a key no rule here names. */
export function recruitmentStep(key: string): RecruitmentStep | undefined {
  return BY_KEY.get(key);
}

/** The recruitment fields of a case that say which steps it took. */
export interface CaseRecruitmentFields {
  jobOrderStartDate?: string | null;
  sundayAdFirstDate?: string | null;
  sundayAdSecondDate?: string | null;
  noticeOfFilingStartDate?: string | null;
  additionalRecruitmentMethods?: ReadonlyArray<{ method: string }> | null;
}

/**
 * The steps a case has entered, in the rule's order: the ones every job takes once their dates are in, and each
 * additional method the case lists (a method listed twice is one step).
 */
export function caseRecruitmentSteps(c: CaseRecruitmentFields): RecruitmentStep[] {
  const entered = new Set<string>();
  if (c.jobOrderStartDate) entered.add("job_order");
  if (c.sundayAdFirstDate) entered.add("sunday_ad_1");
  if (c.sundayAdSecondDate) entered.add("sunday_ad_2");
  if (c.noticeOfFilingStartDate) entered.add("notice_of_filing");
  for (const m of c.additionalRecruitmentMethods ?? []) if (BY_KEY.has(m.method)) entered.add(m.method);
  return RECRUITMENT_STEPS.filter((s) => entered.has(s.key));
}

/** Of these steps, the ones no document proves, leaving out the job order, whose dates are its proof. */
export function missingProof(
  steps: readonly RecruitmentStep[],
  documents: ReadonlyArray<{ step?: string | null }>,
): RecruitmentStep[] {
  const proved = new Set(documents.map((d) => d.step).filter((s): s is string => !!s));
  return steps.filter((s) => !s.datesAreProof && !proved.has(s.key));
}

/** The steps of a case with no proof attached. */
export function stepsMissingProof(
  c: CaseRecruitmentFields,
  documents: ReadonlyArray<{ step?: string | null }>,
): RecruitmentStep[] {
  return missingProof(caseRecruitmentSteps(c), documents);
}
