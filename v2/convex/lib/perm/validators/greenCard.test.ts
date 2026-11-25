import { describe, it, expect } from "vitest";
import { validateGreenCard } from "./greenCard";
import { validateCase } from "./validateCase";
import { mapToValidatorFormat } from "../utils/fieldMapper";

const ruleIds = (r: { errors: readonly { ruleId: string }[] }) => r.errors.map((e) => e.ruleId);

describe("validateGreenCard", () => {
  it("passes a case with no green card dates at all", () => {
    expect(validateGreenCard({}).valid).toBe(true);
  });

  it("refuses an I-485 denial before its filing", () => {
    expect(ruleIds(validateGreenCard({ i485_filing_date: "2025-03-01", i485_denial_date: "2025-02-01" }))).toEqual([
      "V-GC-08",
    ]);
    expect(ruleIds(validateGreenCard({ i485_filing_date: "2025-03-01", i485_denial_date: "2025-03-01" }))).toEqual([]);
  });

  it("refuses an approval before its filing: I-485, work permit, travel document", () => {
    expect(ruleIds(validateGreenCard({ i485_filing_date: "2025-03-01", i485_approval_date: "2025-02-01" }))).toEqual([
      "V-GC-01",
    ]);
    expect(ruleIds(validateGreenCard({ ead_filing_date: "2025-03-01", ead_approval_date: "2025-02-01" }))).toEqual([
      "V-GC-02",
    ]);
    expect(ruleIds(validateGreenCard({ ap_filing_date: "2025-03-01", ap_approval_date: "2025-02-01" }))).toEqual([
      "V-GC-03",
    ]);
  });

  it("refuses a receipt, fingerprints or interview before the I-485 was filed", () => {
    const r = validateGreenCard({
      i485_filing_date: "2025-03-01",
      i485_receipt_date: "2025-02-27",
      i485_biometrics_date: "2025-02-01",
      i485_interview_date: "2025-01-01",
    });
    expect(ruleIds(r)).toEqual(["V-GC-04", "V-GC-04", "V-GC-04"]);
  });

  it("refuses a consular interview before the DS-260 went in", () => {
    expect(
      ruleIds(validateGreenCard({ ds260_submitted_date: "2025-03-01", consular_interview_date: "2025-02-01" })),
    ).toEqual(["V-GC-05"]);
  });

  it("refuses a card that arrived before it was made", () => {
    expect(ruleIds(validateGreenCard({ card_produced_date: "2025-03-01", card_received_date: "2025-02-01" }))).toEqual([
      "V-GC-06",
    ]);
  });

  it("allows same-day dates: nothing above is a clock the law sets", () => {
    expect(
      validateGreenCard({
        i485_filing_date: "2025-03-01",
        i485_receipt_date: "2025-03-01",
        i485_approval_date: "2025-03-01",
        card_produced_date: "2025-03-02",
        card_received_date: "2025-03-02",
      }).valid,
    ).toBe(true);
  });

  it("refuses a country that isn't a country code", () => {
    expect(ruleIds(validateGreenCard({ country_of_birth: "India" }))).toEqual(["V-GC-07"]);
    expect(ruleIds(validateGreenCard({ chargeability_country: "ZZ" }))).toEqual(["V-GC-07"]);
    expect(validateGreenCard({ country_of_birth: "IN", chargeability_country: "CA" }).valid).toBe(true);
  });

  it("runs as part of validateCase, through the field mapper", () => {
    const r = validateCase(
      mapToValidatorFormat({ i485FilingDate: "2025-03-01", i485ApprovalDate: "2025-02-01", countryOfBirth: "IN" }),
    );
    expect(ruleIds(r)).toContain("V-GC-01");
  });
});
