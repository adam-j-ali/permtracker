import { afterEach, describe, expect, it } from "vitest";

import { sendsAtOnce } from "../alertDelivery";

/**
 * Which alerts skip the day's one email. A case's own status change always goes at once. On a paid email plan
 * (EMAIL_DAILY_LIMIT above the free plan's 100) an employer's move goes at once too; the free plan holds it for the
 * address's one email of the day. Queue, bulletin and possible-PERM news wait on either plan.
 */
describe("which alerts go at once", () => {
  afterEach(() => {
    delete process.env.EMAIL_DAILY_LIMIT;
  });

  it("sends a case's status change at once on either plan", () => {
    // Arrange, Act, Assert
    expect(sendsAtOnce("case")).toBe(true);
    process.env.EMAIL_DAILY_LIMIT = "1600";
    expect(sendsAtOnce("case")).toBe(true);
  });

  it("holds an employer's move for the day's one email on the free plan", () => {
    // Arrange: unset, and the free plan's own figure, both mean the free plan.
    // Act, Assert
    expect(sendsAtOnce("employer")).toBe(false);
    process.env.EMAIL_DAILY_LIMIT = "100";
    expect(sendsAtOnce("employer")).toBe(false);
  });

  it("sends an employer's move at once on a paid plan", () => {
    // Arrange
    process.env.EMAIL_DAILY_LIMIT = "1600";
    // Act, Assert
    expect(sendsAtOnce("employer")).toBe(true);
  });

  it("still gathers queue, bulletin and possible-PERM news on a paid plan", () => {
    // Arrange
    process.env.EMAIL_DAILY_LIMIT = "1600";
    // Act, Assert
    expect(sendsAtOnce("queue")).toBe(false);
    expect(sendsAtOnce("bulletin")).toBe(false);
    expect(sendsAtOnce("match")).toBe(false);
  });
});
