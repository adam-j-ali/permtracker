import { describe, expect, it } from "vitest";

import { I751_FILING_WINDOW_DAYS, i751FilingWindow } from "./conditionalResidence";

/**
 * 8 CFR 216.4(a)(1): the joint petition is filed "within the 90-day period immediately preceding the second
 * anniversary" of conditional residence, the day the card says it expires. USCIS's own filing calculator (uscis.gov,
 * "When to File Your Petition to Remove Conditions", read Nov 25 2026) gives April 1, 2023 for a card expiring
 * June 30, 2023, so the 90 days run April 1 to June 29.
 */

describe("the I-751 filing window, 8 CFR 216.4(a)(1)", () => {
  it("matches USCIS's own example: a card expiring June 30, 2023 opens the window April 1", () => {
    // Arrange
    const input = { cardExpires: "2023-06-30", today: "2023-03-01" };

    // Act
    const r = i751FilingWindow(input);

    // Assert
    expect(r.opens).toBe("2023-04-01");
    expect(r.lastDay).toBe("2023-06-29");
    expect(r.expires).toBe("2023-06-30");
    expect(I751_FILING_WINDOW_DAYS).toBe(90);
  });

  it("holds exactly 90 days, both ends counted", () => {
    const r = i751FilingWindow({ cardExpires: "2027-01-15", today: "2026-11-25" });
    // October 17, 2026 to January 14, 2027: 15 + 30 + 31 + 14 = 90 days, both ends in.
    expect(r.opens).toBe("2026-10-17");
    expect(r.lastDay).toBe("2027-01-14");
  });

  it("says too early before the window, with the days until it opens", () => {
    const r = i751FilingWindow({ cardExpires: "2023-06-30", today: "2023-03-30" });
    expect(r.stage).toBe("early");
    expect(r.daysToOpen).toBe(2);
    expect(r.daysLeft).toBeNull();
  });

  it("says open on its first and last days, with the days left counting today", () => {
    expect(i751FilingWindow({ cardExpires: "2023-06-30", today: "2023-04-01" })).toMatchObject({ stage: "open", daysLeft: 90, daysToOpen: null });
    expect(i751FilingWindow({ cardExpires: "2023-06-30", today: "2023-06-29" })).toMatchObject({ stage: "open", daysLeft: 1 });
  });

  it("says late from the day the card expires", () => {
    expect(i751FilingWindow({ cardExpires: "2023-06-30", today: "2023-06-30" })).toMatchObject({ stage: "late", daysLeft: null, daysToOpen: null });
  });

  it("refuses a date that isn't one", () => {
    expect(() => i751FilingWindow({ cardExpires: "2023-02-30", today: "2023-01-01" })).toThrow(/cardExpires/);
    expect(() => i751FilingWindow({ cardExpires: "2023-02-03", today: "today" })).toThrow(/today/);
  });
});
