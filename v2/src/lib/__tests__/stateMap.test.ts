import { describe, expect, it } from "vitest";

import type { FacetRow } from "@/lib/db/entityDetail";
import { canDrawStateMap, legendSteps, mapStates, stepBreaks, stepOf } from "@/lib/stateMap";

const row = (key: string | null, n: number | string, certified = 0, denied = 0): FacetRow => ({
  key, label: key ?? "Unknown", code: null, n: n as number, certified, denied,
});

describe("mapStates", () => {
  it("keeps two-letter states with filings, as numbers, busiest first", () => {
    // libSQL returns integers as strings: the rows are read as numbers here, once.
    const got = mapStates([row("OR", "335", 300, 5), row(null, 9), row("TX", 741, 700, 10), row("ZZZ", 4), row("NV", 0)]);
    expect(got).toEqual([
      { state: "TX", n: 741, certified: 700, denied: 10 },
      { state: "OR", n: 335, certified: 300, denied: 5 },
    ]);
  });
});

describe("canDrawStateMap", () => {
  const two = mapStates([row("TX", 741), row("OR", 335)]);

  it("draws a map for two or more states, once the facet is known to hold every state", () => {
    expect(canDrawStateMap(two, true)).toBe(true);
  });

  it("draws nothing until the nightly build has kept every state: a six-state facet would show the rest as zeros", () => {
    expect(canDrawStateMap(two, false)).toBe(false);
  });

  it("draws nothing for one state: the header's main worksite already answers", () => {
    expect(canDrawStateMap(two.slice(0, 1), true)).toBe(false);
    expect(canDrawStateMap([], true)).toBe(false);
  });
});

describe("the four steps", () => {
  it("cut a long tail by thirds of thirds, so a 741-filing state and a 3-filing one land far apart", () => {
    expect(stepBreaks(741)).toEqual([28, 83, 247]);
    expect(stepOf(741, stepBreaks(741))).toBe(3);
    expect(stepOf(335, stepBreaks(741))).toBe(3);
    expect(stepOf(100, stepBreaks(741))).toBe(2);
    expect(stepOf(30, stepBreaks(741))).toBe(1);
    expect(stepOf(3, stepBreaks(741))).toBe(0);
  });

  it("stay distinct whole numbers when the counts are small", () => {
    expect(stepBreaks(5)).toEqual([2, 3, 4]);
    expect(stepOf(1, stepBreaks(5))).toBe(0);
    expect(stepOf(5, stepBreaks(5))).toBe(3);
  });

  it("label each step with the counts it holds, leaving out a step nothing can reach", () => {
    expect(legendSteps(741)).toEqual([
      { step: 0, text: "1 to 27" },
      { step: 1, text: "28 to 82" },
      { step: 2, text: "83 to 246" },
      { step: 3, text: "247 to 741" },
    ]);
    expect(legendSteps(5)).toEqual([
      { step: 0, text: "1" },
      { step: 1, text: "2" },
      { step: 2, text: "3" },
      { step: 3, text: "4 to 5" },
    ]);
    expect(legendSteps(2)).toEqual([
      { step: 0, text: "1" },
      { step: 1, text: "2" },
    ]);
    expect(legendSteps(1_234_567).at(-1)).toEqual({ step: 3, text: "411,523 to 1,234,567" });
  });
});
