import { describe, expect, it } from "vitest";

import { inLayoffWindow, layoffWindow } from "../layoffCheck";

describe("the layoff check's six months", () => {
  it("looks back six months from the ETA 9089's filing day, or from today before it's filed", () => {
    expect(layoffWindow("2026-03-31", "2026-11-20")).toEqual({ from: "2025-09-30", to: "2026-03-31", filed: true });
    expect(layoffWindow(undefined, "2026-11-20")).toEqual({ from: "2026-05-20", to: "2026-11-20", filed: false });
    expect(layoffWindow("not a date", "2026-11-20").filed).toBe(false);
  });

  it("takes a notice dated inside, the ends included, and a month-only one whose month overlaps", () => {
    const w = { from: "2026-05-20", to: "2026-11-20" };
    expect(["2026-05-20", "2026-08-01", "2026-11-20"].map((d) => inLayoffWindow(d, w))).toEqual([true, true, true]);
    expect(["2026-05-19", "2026-11-21", "2025-12-01"].map((d) => inLayoffWindow(d, w))).toEqual([false, false, false]);
    expect(["2026-05", "2026-11", "2026-04", "2026-12", "soon"].map((d) => inLayoffWindow(d, w))).toEqual([true, true, false, false, false]);
  });
});
