import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calculateAutoStatus, type StatusCalculationInput } from "./statusCalculation";

/** A PERM case whose I-140 was approved, the point the green card stages start from. */
const approvedI140: StatusCalculationInput = {
  pwdFilingDate: "2023-01-10",
  pwdDeterminationDate: "2023-04-10",
  eta9089FilingDate: "2023-08-01",
  eta9089CertificationDate: "2024-05-01",
  i140FilingDate: "2024-06-01",
  i140ApprovalDate: "2024-09-01",
};

describe("calculateAutoStatus past the I-140", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an approved I-140 with nothing after it where it was: I-140, approved", () => {
    expect(calculateAutoStatus(approvedI140)).toEqual({ caseStatus: "i140", progressStatus: "approved" });
  });

  it("moves an approved I-140 to the chosen path's first step once the path is chosen", () => {
    expect(calculateAutoStatus({ ...approvedI140, greenCardPath: "adjustment" })).toEqual({
      caseStatus: "i485",
      progressStatus: "working",
    });
    expect(calculateAutoStatus({ ...approvedI140, greenCardPath: "consular" })).toEqual({
      caseStatus: "consular",
      progressStatus: "working",
    });
  });

  it("doesn't move a pending I-140 on the choice alone", () => {
    const pending = { ...approvedI140, i140ApprovalDate: undefined };
    expect(calculateAutoStatus({ ...pending, greenCardPath: "adjustment" })).toEqual({
      caseStatus: "i140",
      progressStatus: "filed",
    });
  });

  describe("adjustment of status (I-485)", () => {
    it("is filed once the I-485 is filed, even beside a pending I-140 (filed together)", () => {
      expect(calculateAutoStatus({ ...approvedI140, i485FilingDate: "2025-01-02" })).toEqual({
        caseStatus: "i485",
        progressStatus: "filed",
      });
      expect(
        calculateAutoStatus({ ...approvedI140, i140ApprovalDate: undefined, i485FilingDate: "2024-06-01" }),
      ).toEqual({ caseStatus: "i485", progressStatus: "filed" });
    });

    it("stays filed through the fingerprints, is under review at the interview, approved at approval", () => {
      const filed = { ...approvedI140, i485FilingDate: "2025-01-02", i485ReceiptDate: "2025-01-09" };
      expect(calculateAutoStatus({ ...filed, i485BiometricsDate: "2025-02-01" }).progressStatus).toBe("filed");
      expect(calculateAutoStatus({ ...filed, i485InterviewDate: "2025-06-01" })).toEqual({
        caseStatus: "i485",
        progressStatus: "under_review",
      });
      expect(calculateAutoStatus({ ...filed, i485ApprovalDate: "2025-07-01" })).toEqual({
        caseStatus: "i485",
        progressStatus: "approved",
      });
    });

    it("counts a work permit or travel document filing as the adjustment path", () => {
      expect(calculateAutoStatus({ ...approvedI140, eadFilingDate: "2025-01-02" })).toEqual({
        caseStatus: "i485",
        progressStatus: "filed",
      });
    });
  });

  describe("consular processing", () => {
    it("works at NVC, is filed with the DS-260, under review at the interview", () => {
      expect(calculateAutoStatus({ ...approvedI140, nvcReceivedDate: "2025-01-02" })).toEqual({
        caseStatus: "consular",
        progressStatus: "working",
      });
      expect(calculateAutoStatus({ ...approvedI140, ds260SubmittedDate: "2025-02-02" })).toEqual({
        caseStatus: "consular",
        progressStatus: "filed",
      });
      expect(calculateAutoStatus({ ...approvedI140, consularInterviewDate: "2025-05-02" })).toEqual({
        caseStatus: "consular",
        progressStatus: "under_review",
      });
    });
  });

  describe("the card", () => {
    it("is approved once the card is made, on either path", () => {
      expect(
        calculateAutoStatus({ ...approvedI140, i485FilingDate: "2025-01-02", cardProducedDate: "2025-07-05" }),
      ).toEqual({ caseStatus: "i485", progressStatus: "approved" });
      expect(
        calculateAutoStatus({ ...approvedI140, consularInterviewDate: "2025-05-02", cardProducedDate: "2025-07-05" }),
      ).toEqual({ caseStatus: "consular", progressStatus: "approved" });
    });

    it("is complete only when the card arrives", () => {
      expect(
        calculateAutoStatus({
          ...approvedI140,
          i485FilingDate: "2025-01-02",
          i485ApprovalDate: "2025-07-01",
          cardReceivedDate: "2025-07-15",
        }),
      ).toEqual({ caseStatus: "complete", progressStatus: "approved" });
    });

    it("is complete when the card arrives even with an old request for evidence left open", () => {
      expect(
        calculateAutoStatus({
          ...approvedI140,
          rfeEntries: [{ receivedDate: "2024-07-01" }],
          cardReceivedDate: "2025-07-15",
        }),
      ).toEqual({ caseStatus: "complete", progressStatus: "approved" });
    });
  });

  it("still closes a denied I-140, whatever was filed after it", () => {
    expect(
      calculateAutoStatus({
        ...approvedI140,
        i140ApprovalDate: undefined,
        i140DenialDate: "2024-09-01",
        i485FilingDate: "2024-06-01",
      }),
    ).toEqual({ caseStatus: "closed", progressStatus: "approved" });
  });
});
