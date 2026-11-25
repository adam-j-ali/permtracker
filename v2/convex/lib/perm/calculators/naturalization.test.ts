import { describe, expect, it } from "vitest";

import { N400_EARLY_FILING_DAYS, n400EarliestFiling } from "./naturalization";

/**
 * Each expectation is worked by hand from the rule's own words: INA 334(a), 8 CFR 334.2(b), and the USCIS Policy
 * Manual's worked example (12 USCIS-PM D.6(D) and G.3(E), read Nov 25 2026): residence first complete on June 10, 2010
 * means the earliest filing day is March 12, 2010.
 */

describe("the N-400 early filing date, INA 334(a) and 8 CFR 334.2(b)", () => {
  it("matches the Policy Manual's own example: complete June 10, file from March 12", () => {
    // Arrange: five years from June 10, 2005 are first complete on June 10, 2010.
    const input = { residentSince: "2005-06-10", path: "five" as const };

    // Act
    const r = n400EarliestFiling(input);

    // Assert
    expect(r.residenceComplete).toBe("2010-06-10");
    expect(r.earlyFilingOpens).toBe("2010-03-12");
    expect(r.earliest).toBe("2010-03-12");
    expect(N400_EARLY_FILING_DAYS).toBe(90);
  });

  it("counts three years on the spouse path, and the same 90 days before it", () => {
    // Arrange
    const input = { residentSince: "2023-06-10", path: "three" as const, marriedOn: "2019-01-05" };

    // Act
    const r = n400EarliestFiling(input);

    // Assert
    expect(r.residenceComplete).toBe("2026-06-10");
    expect(r.earliest).toBe("2026-03-12");
    expect(r.marriageComplete).toBe("2022-01-05");
    expect(r.setByMarriage).toBe(false);
  });

  it("waits for three years of marriage to a citizen when they end later, since early filing covers only the residence", () => {
    // Arrange: residence opens March 12, 2026, but the third wedding anniversary is August 1, 2026.
    const input = { residentSince: "2023-06-10", path: "three" as const, marriedOn: "2023-08-01" };

    // Act
    const r = n400EarliestFiling(input);

    // Assert
    expect(r.earlyFilingOpens).toBe("2026-03-12");
    expect(r.marriageComplete).toBe("2026-08-01");
    expect(r.earliest).toBe("2026-08-01");
    expect(r.setByMarriage).toBe(true);
  });

  it("counts the marriage from the day the spouse became a citizen when that came after the wedding", () => {
    // Arrange: married 2020, the spouse naturalized November 2, 2023.
    const input = { residentSince: "2022-01-03", path: "three" as const, marriedOn: "2020-05-01", spouseCitizenSince: "2023-11-02" };

    // Act
    const r = n400EarliestFiling(input);

    // Assert
    expect(r.marriageComplete).toBe("2026-11-02");
    expect(r.earliest).toBe("2026-11-02");
    expect(r.setByMarriage).toBe(true);
  });

  it("ignores a spouse's citizenship date before the wedding", () => {
    const r = n400EarliestFiling({ residentSince: "2022-01-03", path: "three", marriedOn: "2021-05-01", spouseCitizenSince: "1990-01-01" });
    expect(r.marriageComplete).toBe("2024-05-01");
  });

  it("leaves the marriage out on the five-year path, and when no wedding date is given", () => {
    expect(n400EarliestFiling({ residentSince: "2021-04-01", path: "five", marriedOn: "2025-01-01" }).marriageComplete).toBeNull();
    expect(n400EarliestFiling({ residentSince: "2021-04-01", path: "three" }).marriageComplete).toBeNull();
  });

  it("counts calendar days across February: one day later in a leap year", () => {
    // January 16 to April 15, 2028 is 31 + 29 + 30 = 90 days; in common 2027 the same 90 reach back to January 15.
    expect(n400EarliestFiling({ residentSince: "2023-04-15", path: "five" }).earliest).toBe("2028-01-16");
    expect(n400EarliestFiling({ residentSince: "2022-04-15", path: "five" }).earliest).toBe("2027-01-15");
  });

  it("counts a February 29 resident to March 1 in a common year, the later day, and says so", () => {
    // Arrange
    const input = { residentSince: "2020-02-29", path: "five" as const };

    // Act
    const r = n400EarliestFiling(input);

    // Assert: 2025 has no February 29.
    expect(r.residenceComplete).toBe("2025-03-01");
    expect(r.leapDay).toBe(true);
    expect(n400EarliestFiling({ residentSince: "2020-02-29", path: "three" })).toMatchObject({ residenceComplete: "2023-03-01", leapDay: true });
    expect(n400EarliestFiling({ residentSince: "2020-02-28", path: "five" })).toMatchObject({ residenceComplete: "2025-02-28", leapDay: false });
  });

  it("counts a February 29 wedding the same way", () => {
    expect(n400EarliestFiling({ residentSince: "2021-01-04", path: "three", marriedOn: "2024-02-29" }).marriageComplete).toBe("2027-03-01");
  });

  it("refuses a date that isn't one", () => {
    expect(() => n400EarliestFiling({ residentSince: "2021-02-30", path: "five" })).toThrow(/residentSince/);
    expect(() => n400EarliestFiling({ residentSince: "2021-02-01", path: "three", marriedOn: "nope" })).toThrow(/marriedOn/);
  });
});
