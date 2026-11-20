import { describe, expect, it } from "vitest";

import { sharedRecruitmentRecord, type SharedCaseFields } from "./sharedRecord";

/** A case with everything a case holds, the private parts marked so a leak is easy to see. */
const CASE = {
  employerName: "ACME Robotics",
  positionTitle: "Robotics Engineer",
  beneficiaryIdentifier: "PRIVATE-BENEFICIARY",
  caseNumber: "PRIVATE-CASE-NUMBER",
  pwdWageAmount: 123456,
  notes: [{ id: "n1", content: "PRIVATE-NOTE", createdAt: 1, status: "pending" }],
  jobOrderState: "CA",
  jobOrderStartDate: "2026-01-05",
  jobOrderEndDate: "2026-02-04",
  sundayAdFirstDate: "2026-01-11",
  sundayAdSecondDate: "2026-01-18",
  sundayAdNewspaper: "PRIVATE-NEWSPAPER",
  noticeOfFilingStartDate: "2026-01-06",
  noticeOfFilingEndDate: "2026-01-20",
  additionalRecruitmentMethods: [
    { method: "radio_ad", date: "", description: "PRIVATE-STATION", subEntries: [{ date: "2026-01-14", description: "PRIVATE-SPOT" }, { date: "2026-01-12" }] },
    { method: "employer_website", date: "", startDate: "2026-01-07", endDate: "2026-02-06" },
    { method: "job_fair", date: "2026-01-21" },
    { method: "employer_website", date: "2026-02-10" },
    { method: "not_a_step", date: "2026-01-09" },
  ],
  filingWindowOpens: "2026-03-08",
  filingWindowCloses: "2026-07-04",
} as unknown as SharedCaseFields;

describe("the recruitment record a client sees", () => {
  it("names the employer and the job, and gives every step its dates in the rule's order", () => {
    const r = sharedRecruitmentRecord(CASE, []);
    expect(r.employerName).toBe("ACME Robotics");
    expect(r.positionTitle).toBe("Robotics Engineer");
    expect(r.steps.map((s) => [s.key, s.dates])).toEqual([
      ["job_order", [{ start: "2026-01-05", end: "2026-02-04" }]],
      ["sunday_ad_1", [{ start: "2026-01-11", end: null }]],
      ["sunday_ad_2", [{ start: "2026-01-18", end: null }]],
      ["notice_of_filing", [{ start: "2026-01-06", end: "2026-01-20" }]],
      ["job_fair", [{ start: "2026-01-21", end: null }]],
      // A method listed twice is one step with both its dates, earliest first.
      ["employer_website", [{ start: "2026-01-07", end: "2026-02-06" }, { start: "2026-02-10", end: null }]],
      // Each radio spot is a date of its own.
      ["radio_ad", [{ start: "2026-01-12", end: null }, { start: "2026-01-14", end: null }]],
    ]);
    expect(r.steps[0]!.label).toBe("Job order with the state workforce agency");
    expect(r.filingWindow).toEqual({ opens: "2026-03-08", closes: "2026-07-04" });
  });

  it("always lists the four steps every job takes, with no dates until they're entered", () => {
    const r = sharedRecruitmentRecord({ employerName: "E", positionTitle: "J", additionalRecruitmentMethods: [] }, []);
    expect(r.steps.map((s) => [s.key, s.dates.length])).toEqual([
      ["job_order", 0],
      ["sunday_ad_1", 0],
      ["sunday_ad_2", 0],
      ["notice_of_filing", 0],
    ]);
    expect(r.filingWindow).toBeNull();
  });

  it("gives the half of the filing window that's known", () => {
    const r = sharedRecruitmentRecord({ employerName: "E", positionTitle: "J", filingWindowOpens: "2026-03-08" }, []);
    expect(r.filingWindow).toEqual({ opens: "2026-03-08", closes: null });
  });

  it("drops a date that isn't one", () => {
    const r = sharedRecruitmentRecord({ employerName: "E", positionTitle: "J", sundayAdFirstDate: "Jan 11", jobOrderStartDate: "2026-01-05", jobOrderEndDate: "soon" }, []);
    expect(r.steps.find((s) => s.key === "sunday_ad_1")!.dates).toEqual([]);
    expect(r.steps.find((s) => s.key === "job_order")!.dates).toEqual([{ start: "2026-01-05", end: null }]);
  });

  it("lists each applicant's reference, dates, contact, outcome and lawful reason, in the log's order", () => {
    const r = sharedRecruitmentRecord(CASE, [
      { ref: "Applicant 2", appliedOn: "2026-01-12", source: "sunday_ad_1", contactedOn: "2026-01-14", contactMethod: "email", outcome: "not_qualified", reason: "No bachelor's degree, which the job requires." },
      { ref: "Applicant 1", outcome: "pending" },
    ]);
    expect(r.applicants).toEqual([
      { ref: "Applicant 2", appliedOn: "2026-01-12", contactedOn: "2026-01-14", contactMethod: "email", outcome: "not_qualified", reason: "No bachelor's degree, which the job requires." },
      { ref: "Applicant 1", appliedOn: null, contactedOn: null, contactMethod: null, outcome: "pending", reason: null },
    ]);
  });

  it("keeps the notes on a hired or pending applicant private: the form calls that field Notes", () => {
    const r = sharedRecruitmentRecord(CASE, [
      { ref: "A1", outcome: "hired", reason: "PRIVATE-HIRED-NOTE" },
      { ref: "A2", outcome: "pending", reason: "PRIVATE-PENDING-NOTE" },
      { ref: "A3", outcome: "withdrew", reason: "Took another job." },
    ]);
    expect(r.applicants.map((a) => a.reason)).toEqual([null, null, "Took another job."]);
  });

  it("carries nothing else from the case: no beneficiary, case number, wage, notes, newspaper, outlet or state", () => {
    const r = sharedRecruitmentRecord(CASE, [{ ref: "A1", outcome: "hired", reason: "PRIVATE-HIRED-NOTE", source: "sunday_ad_1" }]);
    expect(Object.keys(r).sort()).toEqual(["applicants", "employerName", "filingWindow", "positionTitle", "steps"]);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/PRIVATE|123456|"CA"|"source"/);
    expect(Object.keys(r.applicants[0]!).sort()).toEqual(["appliedOn", "contactMethod", "contactedOn", "outcome", "reason", "ref"]);
    expect(Object.keys(r.steps[0]!).sort()).toEqual(["dates", "key", "label"]);
  });
});
