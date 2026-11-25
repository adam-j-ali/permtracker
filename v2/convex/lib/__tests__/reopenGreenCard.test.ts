import { describe, it, expect } from "vitest";
import { determineReopenStatus } from "../caseListHelpers";

const i140Approved = {
  eta9089FilingDate: "2023-08-01",
  eta9089CertificationDate: "2024-05-01",
  i140FilingDate: "2024-06-01",
  i140ApprovalDate: "2024-09-01",
};

describe("reopening a case past the I-140", () => {
  it("reopens an approved I-140 with nothing after it where it was", () => {
    expect(determineReopenStatus(i140Approved)).toEqual({ caseStatus: "i140", progressStatus: "approved" });
  });

  it("reopens at the I-485 or consulate stage its dates reach", () => {
    expect(determineReopenStatus({ ...i140Approved, i485FilingDate: "2025-01-02" })).toEqual({
      caseStatus: "i485",
      progressStatus: "filed",
    });
    expect(determineReopenStatus({ ...i140Approved, greenCardPath: "consular", ds260SubmittedDate: "2025-01-02" })).toEqual({
      caseStatus: "consular",
      progressStatus: "filed",
    });
  });

  it("reopens a case whose card arrived as complete", () => {
    expect(determineReopenStatus({ ...i140Approved, cardReceivedDate: "2025-08-01" })).toEqual({
      caseStatus: "complete",
      progressStatus: "approved",
    });
  });
});
