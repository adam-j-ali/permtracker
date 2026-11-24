import { describe, expect, it } from "vitest";

import fixture from "../../scripts/data/wilson_cases.json";
import { Z_95, wilsonInterval } from "./wilson";

/**
 * The one Wilson interval, held to the answers in scripts/data/wilson_cases.json. The Python half
 * (scripts/lib_wilson.py) tests against the same file, so the two languages can't drift apart.
 */
describe("wilsonInterval", () => {
  it("uses the z the shared answers were made with", () => {
    expect(Z_95).toBe(fixture.z);
  });

  it.each(fixture.cases)("gives the shared answer for $k of $n", ({ k, n, lo, hi }) => {
    // Act
    const got = wilsonInterval(k, n);
    // Assert
    if (lo === null || hi === null) {
      expect(got).toBeNull();
      return;
    }
    expect(got).not.toBeNull();
    expect(got!.lo).toBeCloseTo(lo, 9);
    expect(got!.hi).toBeCloseTo(hi, 9);
  });

  it("bounds nothing that isn't a count", () => {
    for (const [k, n] of [
      [Number.NaN, 100],
      [1, Number.NaN],
      [1, Number.POSITIVE_INFINITY],
      [Number.POSITIVE_INFINITY, 10],
    ] as const) {
      expect(wilsonInterval(k, n)).toBeNull();
    }
  });

  it("stays inside 0 to 100 at both ends, where a plain plus-or-minus goes past them", () => {
    for (const [k, n] of [[0, 3], [3, 3], [0, 12], [12, 12], [1, 3]] as const) {
      const ci = wilsonInterval(k, n)!;
      expect(ci.lo).toBeGreaterThanOrEqual(0);
      expect(ci.hi).toBeLessThanOrEqual(100);
      expect(ci.lo).toBeLessThanOrEqual((k / n) * 100);
      expect(ci.hi).toBeGreaterThanOrEqual((k / n) * 100);
    }
  });

  it("always holds the share itself, even where rounding would leave it a hair outside", () => {
    // 100 of 100 came out as 99.99999999999999 from the arithmetic alone.
    for (const n of [1, 7, 12, 100, 2000, 140.2]) {
      expect(wilsonInterval(n, n)!.hi).toBe(100);
      expect(wilsonInterval(0, n)!.lo).toBe(0);
    }
  });

  it("never claims a spotless record is known to be spotless", () => {
    expect(wilsonInterval(0, 3)!.hi).toBeGreaterThan(50);
  });

  it("narrows as the count grows", () => {
    const widths = [10, 50, 200, 2000].map((n) => {
      const ci = wilsonInterval(n / 10, n)!;
      return ci.hi - ci.lo;
    });
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(widths[i - 1]!);
  });
});
