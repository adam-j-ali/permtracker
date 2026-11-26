import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSectionState } from "../useSectionState";
import type { CaseFormData } from "../../lib/forms";

const base = (overrides: Partial<CaseFormData> = {}): Partial<CaseFormData> => ({
  employerName: "Test Corp",
  positionTitle: "Engineer",
  caseStatus: "pwd",
  progressStatus: "working",
  isProfessionalOccupation: false,
  additionalRecruitmentMethods: [],
  ...overrides,
});

describe("useSectionState: the green card section past the I-140", () => {
  it("is closed to a case that hasn't filed its I-140, and says what opens it", () => {
    const { result } = renderHook(() => useSectionState(base()));
    expect(result.current.sectionStates.greenCard.isEnabled).toBe(false);
    expect(result.current.sectionStates.greenCard.disabledReason).toBe("Enter the I-140 filing date first");
  });

  it("opens once the I-140 is filed (the I-485 can go in beside it), or once any of its own dates is there", () => {
    const filed = renderHook(() => useSectionState(base({ i140FilingDate: "2025-01-02" })));
    expect(filed.result.current.sectionStates.greenCard.isEnabled).toBe(true);
    const ownDates = renderHook(() => useSectionState(base({ i485FilingDate: "2025-01-02" })));
    expect(ownDates.result.current.sectionStates.greenCard.isEnabled).toBe(true);
  });

  it("is complete when the card arrived, with a one-line summary of where the case is", () => {
    const { result } = renderHook(() =>
      useSectionState(
        base({
          i140FilingDate: "2024-06-01",
          greenCardPath: "adjustment",
          i485FilingDate: "2025-01-02",
          cardReceivedDate: "2025-08-01",
        }),
      ),
    );
    expect(result.current.sectionStates.greenCard.isComplete).toBe(true);
    expect(result.current.sectionStates.greenCard.summary).toBe("I-485, Filed Jan 2, Card received Aug 1");
  });

  it("says in its summary when the I-485 was denied", () => {
    const { result } = renderHook(() =>
      useSectionState(
        base({ i140FilingDate: "2024-06-01", greenCardPath: "adjustment", i485FilingDate: "2025-01-02", i485DenialDate: "2025-09-01" }),
      ),
    );
    expect(result.current.sectionStates.greenCard.summary).toBe("I-485, Filed Jan 2, Denied Sep 1");
  });
});
