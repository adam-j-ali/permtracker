import { describe, expect, it } from "vitest";

import { calculatePWDExpiration } from "@/lib/perm";
import { carriesToMyCases, dolCarriedFields, dolCarryHref, readDolCarry } from "../dolCarried";

describe("Add to my cases, from a public case page", () => {
  it("carries a PERM case's public record to the new-case form and reads it back the same", () => {
    const href = dolCarryHref({ caseNumber: "G-100-25318-409609", employer: "FMR LLC", title: "Director, Full Stack Engineering", filed: "2025-11-14", decided: "2026-09-11", outcome: "CERTIFIED" });
    expect(href).toMatch(/^\/cases\/new\?add=G-100-25318-409609&/);
    const back = readDolCarry(new URL(`https://x${href}`).searchParams);
    expect(back).toEqual({ caseNumber: "G-100-25318-409609", employer: "FMR LLC", title: "Director, Full Stack Engineering", filed: "2025-11-14", decided: "2026-09-11", outcome: "CERTIFIED" });
  });

  it("fills a certified PERM case's number, filing and certification, and a denial in its own field", () => {
    expect(dolCarriedFields({ caseNumber: "G-100-25318-409609", employer: "FMR LLC", filed: "2025-11-14", decided: "2026-09-11", outcome: "CERTIFIED" })).toEqual({
      employerName: "FMR LLC",
      caseNumber: "G-100-25318-409609",
      eta9089CaseNumber: "G-100-25318-409609",
      eta9089FilingDate: "2025-11-14",
      eta9089CertificationDate: "2026-09-11",
    });
    expect(dolCarriedFields({ caseNumber: "G-100-25318-1", decided: "2026-09-11", outcome: "DENIED" }).eta9089DenialDate).toBe("2026-09-11");
    // Certified, then withdrawn or expired: no certification day is claimed.
    expect(dolCarriedFields({ caseNumber: "G-100-25318-1", decided: "2026-09-11", outcome: "CERTIFIED-WITHDRAWN" }).eta9089CertificationDate).toBeUndefined();
  });

  it("gives an issued wage request its determination day and the central rule's expiration", () => {
    const f = dolCarriedFields({ caseNumber: "P-100-26076-707795", filed: "2026-03-17", decided: "2026-06-24", outcome: "DETERMINATION ISSUED", level: "IV", wage: 238285 });
    expect(f).toMatchObject({ pwdCaseNumber: "P-100-26076-707795", pwdFilingDate: "2026-03-17", pwdDeterminationDate: "2026-06-24", pwdWageLevel: "IV", pwdWageAmount: 238285 });
    expect(f.pwdExpirationDate).toBe(calculatePWDExpiration("2026-06-24"));
    // Still in process: filed only.
    expect(dolCarriedFields({ caseNumber: "P-100-26324-376560", filed: "2026-11-20", outcome: "IN PROCESS" })).toEqual({ pwdCaseNumber: "P-100-26324-376560", pwdFilingDate: "2026-11-20" });
  });

  it("carries only the numbers the app tracks, and only fields that pass their shape", () => {
    expect(carriesToMyCases("P-400-26272-268643")).toBe(false);
    expect(carriesToMyCases("I-200-26125-868956")).toBe(false);
    expect(dolCarryHref({ caseNumber: "H-300-26272-266803" })).toBeNull();
    const back = readDolCarry(new URLSearchParams("add=g-100-25318-409609&filed=Nov%2014&decided=2026-09-11&level=V&wage=-5"));
    expect(back).toEqual({ caseNumber: "G-100-25318-409609", decided: "2026-09-11" });
    expect(readDolCarry(new URLSearchParams("add=not-a-case"))).toBeNull();
  });
});
