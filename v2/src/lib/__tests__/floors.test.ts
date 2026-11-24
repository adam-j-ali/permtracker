import { describe, expect, it } from "vitest";

import { wilsonInterval } from "@convex/lib/wilson";
import cases from "../../../scripts/data/floor_cases.json";
import table from "../../../scripts/data/floors.json";
import { FLOORS, marginPoints, marginWords, meetsFloor, sampleShare, tooFewWords } from "../floors";

/**
 * The floors and the margin rule for new figures, held to scripts/data/floor_cases.json. The Python half
 * (scripts/lib_floors.py) tests against the same file.
 */
describe("floors for new figures", () => {
  it("read the one table", () => {
    expect(FLOORS).toEqual(table.floors);
    expect(FLOORS.share.min).toBe(100);
    expect(FLOORS.median.min).toBe(30);
  });

  it.each(cases.shares)("gives $k of $n its share and margin, or the words instead", (c) => {
    // Act
    const got = sampleShare(c.k, c.n, c.unit);
    // Assert
    if ("words" in c) {
      expect(got).toEqual({ shown: false, words: c.words });
      return;
    }
    expect(got.shown).toBe(true);
    if (!got.shown) return;
    expect(got.pct).toBeCloseTo(c.pct!, 9);
    expect(got.margin).toBe(c.margin);
    expect(got.lo).toBeLessThanOrEqual(got.pct);
    expect(got.hi).toBeGreaterThanOrEqual(got.pct);
  });

  it.each(cases.medians)("holds a median to its floor at $n", (c) => {
    expect(meetsFloor("median", c.n)).toBe(c.meets);
    if (!c.meets) expect(tooFewWords("median", c.n, c.unit)).toBe(c.words);
  });

  it.each(cases.marginWords)("says a margin of $points points in words", (c) => {
    expect(marginWords(c.points)).toBe(c.words);
  });

  it("never prints a margin smaller than the interval's wider side", () => {
    for (const [k, n] of [[1000, 2000], [44, 2000], [7, 250], [1, 3]] as const) {
      const ci = wilsonInterval(k, n)!;
      const exact = Math.max((k / n) * 100 - ci.lo, ci.hi - (k / n) * 100);
      expect(marginPoints(k, n)!).toBeGreaterThanOrEqual(exact);
      expect(marginPoints(k, n)! - exact).toBeLessThan(0.1);
    }
    expect(marginPoints(1, 0)).toBeNull();
  });

  it("writes each table's words as plain sentences a reader can take", () => {
    for (const row of Object.values(table.floors)) {
      expect(row.words).toMatch(/\{unit\}/);
      expect(row.words).toMatch(/\{n\}/);
      expect(row.words).toMatch(/\{min\}/);
      expect(row.words.trim().endsWith(".")).toBe(true);
      expect(row.words).not.toMatch(/—/);
    }
  });
});
