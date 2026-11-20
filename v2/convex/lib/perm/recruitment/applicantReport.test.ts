import { describe, expect, it } from "vitest";

import { recruitmentReport, type ApplicantEntry } from "./applicantReport";

const a = (ref: string, outcome: ApplicantEntry["outcome"], reason?: string): ApplicantEntry => ({ ref, outcome, reason: reason ?? null });

describe("the recruitment report", () => {
  it("counts the hires, the pending and the not hired, grouped by the reason written, each group by reference", () => {
    const r = recruitmentReport({ jobOrderStartDate: "2026-01-05" }, [
      a("Applicant 10", "not_qualified", "No bachelor's degree in the field the job requires."),
      a("Applicant 2", "not_qualified", "Lacks the 2 years of required experience."),
      a("Applicant 3", "hired"),
      a("Applicant 4", "pending"),
      a("Applicant 5", "no_response", "Two emails, Jan 20 and Jan 27, no reply."),
    ]);
    expect(r).toMatchObject({ total: 5, hired: 1, pending: 1, notHired: 3 });
    expect(r.groups.map((g) => [g.key, g.entries.map((e) => e.ref)])).toEqual([
      ["not_qualified", ["Applicant 2", "Applicant 10"]],
      ["no_response", ["Applicant 5"]],
    ]);
    expect(r.steps.map((s) => s.key)).toEqual(["job_order"]);
    expect(r.withoutReason).toEqual([]);
  });

  it("names every not-hired applicant who has no reason yet, so the draft can't read as final", () => {
    const r = recruitmentReport({}, [a("A", "declined"), a("B", "declined", "Declined the interview by phone, Feb 2."), a("C", "pending")]);
    expect(r.withoutReason.map((e) => e.ref)).toEqual(["A"]);
  });

  it("is an empty report for an empty log", () => {
    expect(recruitmentReport({}, [])).toMatchObject({ total: 0, hired: 0, pending: 0, notHired: 0, groups: [], withoutReason: [] });
  });
});
