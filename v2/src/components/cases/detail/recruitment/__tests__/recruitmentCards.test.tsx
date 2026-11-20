import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recruitmentReport } from "@convex/lib/perm/recruitment/applicantReport";
import { caseRecruitmentSteps } from "@convex/lib/perm/recruitment/steps";
import type { Id } from "@convex/_generated/dataModel";

const calls = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn(), setStep: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => {
    const name = String(ref);
    if (name.includes("setDocumentStep")) return calls.setStep;
    if (name.endsWith(":add") || name.includes("add")) return calls.add;
    if (name.includes("update")) return calls.update;
    return calls.remove;
  },
}));
vi.mock("convex/server", async (orig) => orig());
vi.mock("@convex/_generated/api", () => ({
  api: {
    recruitmentApplicants: { add: "recruitmentApplicants:add", update: "recruitmentApplicants:update", remove: "recruitmentApplicants:remove" },
    documents: { setDocumentStep: "documents:setDocumentStep" },
  },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { ApplicantLog } = await import("../ApplicantLog");
const { RecruitmentProof } = await import("../RecruitmentProof");
const { RecruitmentReportCard } = await import("../RecruitmentReportCard");

const caseId = "c1" as Id<"cases">;
const fields = { jobOrderStartDate: "2026-01-05", sundayAdFirstDate: "2026-01-11", noticeOfFilingStartDate: "2026-01-06" };
const steps = caseRecruitmentSteps(fields);
const row = (over: Record<string, unknown>) =>
  ({ _id: "a1", _creationTime: 1, userId: "u1", caseId, ref: "Applicant 1", outcome: "pending", createdAt: 1, updatedAt: 1, ...over }) as never;

describe("the applicant log card", () => {
  beforeEach(() => Object.values(calls).forEach((f) => f.mockReset()));
  afterEach(() => vi.clearAllMocks());

  it("adds an applicant with only the fields filled, the reference numbered next", async () => {
    render(<ApplicantLog caseId={caseId} applicants={[row({})]} steps={steps} />);
    fireEvent.click(screen.getByRole("button", { name: /Add an applicant/ }));
    expect(screen.getByLabelText("Reference")).toHaveValue("Applicant 2");
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "not_qualified" } });
    fireEvent.change(screen.getByLabelText("Answered"), { target: { value: "sunday_ad_1" } });
    fireEvent.change(screen.getByLabelText("The lawful, job-related reason"), { target: { value: "No bachelor's degree, which the job requires." } });
    fireEvent.click(screen.getByRole("button", { name: "Add applicant" }));
    await waitFor(() => expect(calls.add).toHaveBeenCalledTimes(1));
    expect(calls.add).toHaveBeenCalledWith({
      caseId,
      ref: "Applicant 2",
      outcome: "not_qualified",
      source: "sunday_ad_1",
      reason: "No bachelor's degree, which the job requires.",
    });
  });

  it("asks before removing an applicant, and keeps it when told to", async () => {
    render(<ApplicantLog caseId={caseId} applicants={[row({ outcome: "hired" })]} steps={steps} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Applicant 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(calls.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove Applicant 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.remove).toHaveBeenCalledWith({ id: "a1" }));
  });
});

describe("the proof slots", () => {
  it("names each step's rule and proof, flags the steps with no proof, and never the job order", () => {
    render(
      <RecruitmentProof
        caseId={caseId}
        steps={steps}
        documents={[{ id: "d1", name: "Notice.pdf", url: "https://files.example/n", step: "notice_of_filing" }]}
        filingWindowOpens="2026-03-01"
        filed={false}
        onUpload={vi.fn(async () => null)}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("One step has no proof yet: first Sunday newspaper ad. The filing window opens");
    expect(screen.getByText("Its dates are its proof.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notice.pdf" })).toHaveAttribute("target", "_blank");
    expect(screen.getAllByText("20 CFR 656.17(e)(1)(i)(B)").length).toBeGreaterThan(0);
  });
});

describe("the report card", () => {
  it("states the results and says when the draft isn't final", () => {
    const applicants = [
      { ref: "Applicant 1", outcome: "not_qualified" as const },
      { ref: "Applicant 2", outcome: "hired" as const },
    ];
    render(
      <RecruitmentReportCard
        report={recruitmentReport(fields, applicants)}
        applicants={applicants}
        documents={[]}
        employer="ACME"
        position="Engineer"
        caseNumber={null}
      />,
    );
    expect(screen.getByText(/2 U.S. applicants responded\. 1 was hired, 1 was not hired/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Not final yet: Applicant 1 has no reason written.");
    expect(screen.getByRole("button", { name: "Download the audit file" })).toBeInTheDocument();
  });
});
