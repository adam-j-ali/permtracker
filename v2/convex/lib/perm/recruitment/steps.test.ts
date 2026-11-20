import { describe, expect, it } from "vitest";

import { caseRecruitmentSteps, recruitmentStep, RECRUITMENT_STEPS, stepsMissingProof } from "./steps";

describe("the recruitment steps", () => {
  it("names each step's rule and proof, and covers every method the case form offers", () => {
    for (const s of RECRUITMENT_STEPS) {
      expect(s.cite).toMatch(/^20 CFR 656\.(17|10)\(/);
      expect(s.proof.length).toBeGreaterThan(20);
    }
    expect(recruitmentStep("job_order")?.datesAreProof).toBe(true);
  });

  it("lists the steps a case has entered, in the rule's order, each method once", () => {
    const steps = caseRecruitmentSteps({
      jobOrderStartDate: "2026-01-05",
      sundayAdFirstDate: "2026-01-11",
      sundayAdSecondDate: "2026-01-18",
      noticeOfFilingStartDate: "2026-01-06",
      additionalRecruitmentMethods: [{ method: "employer_website" }, { method: "job_fair" }, { method: "employer_website" }, { method: "not_a_step" }],
    });
    expect(steps.map((s) => s.key)).toEqual(["job_order", "sunday_ad_1", "sunday_ad_2", "notice_of_filing", "job_fair", "employer_website"]);
  });

  it("flags each step with no proof, but never the job order, whose dates are its proof", () => {
    const c = { jobOrderStartDate: "2026-01-05", sundayAdFirstDate: "2026-01-11", additionalRecruitmentMethods: [{ method: "employer_website" }] };
    expect(stepsMissingProof(c, []).map((s) => s.key)).toEqual(["sunday_ad_1", "employer_website"]);
    expect(stepsMissingProof(c, [{ step: "sunday_ad_1" }, { step: null }]).map((s) => s.key)).toEqual(["employer_website"]);
  });
});
