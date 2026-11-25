import { describe, expect, it } from "vitest";

import { approvedShareOfDecisions, certifiedShareOfOutcomes, deniedShareOfDecisions } from "./approval";

describe("the approval rate, one rule (D4)", () => {
  it("divides by decisions only: a withdrawal is on neither side", () => {
    // 900 certified, 10 denied, 90 withdrawn: 900 / 910 over decisions, 900 / 1,000 over every outcome.
    expect(approvedShareOfDecisions(900, 10)).toBeCloseTo(0.989011, 6);
    expect(deniedShareOfDecisions(900, 10)).toBeCloseTo(0.010989, 6);
    expect(certifiedShareOfOutcomes(900, 1000)).toBe(0.9);
  });

  it("is exactly the division a page printed before, so no figure moves by a rounding", () => {
    for (const [a, d] of [[1, 2], [2999, 1], [7, 0], [0, 7], [123_456, 789]] as const) {
      expect(approvedShareOfDecisions(a, d)).toBe(a / (a + d));
      expect(deniedShareOfDecisions(a, d)).toBe(d / (a + d));
      expect(approvedShareOfDecisions(a, d)! + deniedShareOfDecisions(a, d)!).toBeCloseTo(1, 12);
    }
  });

  it("has no rate when nothing was decided, never 0", () => {
    expect(approvedShareOfDecisions(0, 0)).toBeNull();
    expect(deniedShareOfDecisions(0, 0)).toBeNull();
    expect(certifiedShareOfOutcomes(0, 0)).toBeNull();
    // A count that failed to read gives no rate either, never a confident 0.
    expect(approvedShareOfDecisions(Number.NaN, 3)).toBeNull();
    expect(approvedShareOfDecisions(3, Number.NaN)).toBeNull();
  });
});
