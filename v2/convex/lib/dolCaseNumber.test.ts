import { describe, expect, it } from "vitest";

import { dolCaseNumberOnCreate, dolCaseNumberOnUpdate, stepDolNumber } from "./dolCaseNumber";

const ETA = "G-100-25318-409609";
const PWD = "P-100-25210-123456";

describe("the case's DOL number, whichever box it was typed in", () => {
  it("takes the ETA 9089's number first, then the wage request's, in DOL's spelling", () => {
    expect(stepDolNumber({ eta9089CaseNumber: ` ${ETA.toLowerCase()} `, pwdCaseNumber: PWD })).toBe(ETA);
    expect(stepDolNumber({ pwdCaseNumber: PWD })).toBe(PWD);
    expect(stepDolNumber({ eta9089CaseNumber: "my own ref" })).toBeNull();
  });

  it("keeps a number typed in the DOL case number box, and fills an empty one from a step's box", () => {
    expect(dolCaseNumberOnCreate({ caseNumber: "G-100-1-1", eta9089CaseNumber: ETA })).toBe("G-100-1-1");
    expect(dolCaseNumberOnCreate({ caseNumber: "  ", eta9089CaseNumber: ETA })).toBe(ETA);
    expect(dolCaseNumberOnCreate({ pwdCaseNumber: PWD })).toBe(PWD);
    expect(dolCaseNumberOnCreate({})).toBeUndefined();
  });

  it("moves a number that followed the steps on to the new step, and fills an empty box on any save", () => {
    // The wage request's number, then the ETA 9089 is filed.
    expect(dolCaseNumberOnUpdate({ caseNumber: PWD, pwdCaseNumber: PWD }, { caseNumber: PWD, pwdCaseNumber: PWD, eta9089CaseNumber: ETA })).toBe(ETA);
    // A typo in the ETA 9089 box corrected.
    expect(dolCaseNumberOnUpdate({ caseNumber: "G-100-25318-409600", eta9089CaseNumber: "G-100-25318-409600" }, { caseNumber: "G-100-25318-409600", eta9089CaseNumber: ETA })).toBe(ETA);
    expect(dolCaseNumberOnUpdate({ eta9089CaseNumber: ETA }, { eta9089CaseNumber: ETA })).toBe(ETA);
    expect(dolCaseNumberOnUpdate({ caseNumber: ETA, eta9089CaseNumber: ETA }, { caseNumber: ETA, eta9089CaseNumber: ETA })).toBeNull();
  });

  it("never replaces a number the person typed there themselves", () => {
    const own = "G-200-24001-000001";
    expect(dolCaseNumberOnUpdate({ caseNumber: own, eta9089CaseNumber: ETA }, { caseNumber: own, eta9089CaseNumber: "G-100-25318-409601" })).toBeNull();
    // Typed in the same save as the step's box changed: the person's choice.
    expect(dolCaseNumberOnUpdate({ caseNumber: ETA, eta9089CaseNumber: ETA }, { caseNumber: own, eta9089CaseNumber: "G-100-25318-409601" })).toBeNull();
  });
});
