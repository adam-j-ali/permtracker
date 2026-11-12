import { describe, expect, it } from "vitest";

import { changeTrend, changeWords, yearOnYear, type SeventyFiveMonth } from "../seventyFive";

const m = (month: string, eb75: number, ebOther: number): SeventyFiveMonth => ({ month, eb75, ebOther, all75: eb75 * 10, allOther: ebOther * 10 });

describe("the 75-country pause, year on year", () => {
  it("sets the newest month against the same month a year before", () => {
    // State's own counts: 920 employment visas to the 75 countries in Feb 2025, 216 in Feb 2026.
    const got = yearOnYear([m("2025-02", 920, 3165), m("2025-10", 2345, 3629), m("2026-02", 216, 3758)]);
    expect(got?.newest).toBe("2026-02");
    expect(got?.yearBefore).toBe("2025-02");
    expect(got?.eb75).toEqual({ from: 920, to: 216, percent: -77 });
    expect(got?.ebOther.percent).toBe(19);
    expect(changeWords(got!.eb75)).toBe("down 77%");
    expect(changeWords(got!.ebOther)).toBe("up 19%");
  });

  it("says nothing when the year-earlier month isn't held", () => {
    expect(yearOnYear([m("2025-10", 2345, 3629), m("2026-02", 216, 3758)])).toBeNull();
    expect(yearOnYear([])).toBeNull();
  });

  it("never divides by a zero month", () => {
    expect(changeWords({ from: 0, to: 5, percent: null })).toBe("new");
    expect(changeWords({ from: 5, to: 5, percent: 0 })).toBe("no change");
  });

  it("draws a change as a chip: which way, how much, against what, and never good or bad", () => {
    // Arrange: a count that fell, one that rose, one that held, one with nothing before.
    const fell = { from: 920, to: 216, percent: -77 };
    const rose = { from: 3165, to: 3758, percent: 19 };
    const held = { from: 500, to: 501, percent: 0 };
    const fresh = { from: 0, to: 5, percent: null };

    // Act and assert: a count of visas is volume, so the chip is information whichever way it moved.
    expect(changeTrend(fell, "February 2025")).toEqual({ text: "Down 77% on February 2025", dir: "down", tone: "info" });
    expect(changeTrend(rose, "February 2025")).toEqual({ text: "Up 19% on February 2025", dir: "up", tone: "info" });
    expect(changeTrend(held, "February 2025")).toEqual({ text: "About the same as February 2025", dir: "level", tone: "neutral" });
    // Nothing to compare against draws no chip: "new" stays in the note's words.
    expect(changeTrend(fresh, "February 2025")).toBeUndefined();
  });
});
