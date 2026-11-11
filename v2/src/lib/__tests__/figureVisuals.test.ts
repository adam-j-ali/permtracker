import { describe, expect, it } from "vitest";

import { filedLastMonth, waitingSplit } from "../figureVisuals";

describe("the split bar under a list's waiting count", () => {
  it("draws decided against waiting, and says both in one sentence", () => {
    const split = waitingSplit({ total: 100, pending: 8, decided: 92 }, "wage requests");
    expect(split?.parts).toEqual([
      { value: 92, tone: "good" },
      { value: 8, tone: "wait" },
    ]);
    expect(split?.label).toBe("8 of 100 wage requests are still waiting, and 92 are decided.");
  });

  it("draws nothing with no summary or an empty one", () => {
    expect(waitingSplit(null, "LCAs")).toBeUndefined();
    expect(waitingSplit({ total: 0, pending: 0, decided: 0 }, "LCAs")).toBeUndefined();
  });
});

describe("the last complete month's filings", () => {
  const months = [
    { month: "2026-08", total: 900 },
    { month: "2026-09", total: 1000 },
    { month: "2026-10", total: 1200 },
    { month: "2026-11", total: 310 }, // in progress on Nov 10
  ];

  it("leaves the month in progress out, since a part-month always reads as a fall", () => {
    const f = filedLastMonth(months, "2026-11-10");
    expect(f?.label).toBe("Filed in October 2026");
    expect(f?.value).toBe("1,200");
    expect(f?.spark).toEqual([900, 1000, 1200]);
  });

  it("says the change on the month before, as a change that's neither good nor bad", () => {
    expect(filedLastMonth(months, "2026-11-10")?.trend).toEqual({ text: "20% more than September", dir: "up", tone: "info" });
    expect(filedLastMonth([{ month: "2026-09", total: 1000 }, { month: "2026-10", total: 800 }], "2026-11-10")?.trend?.text).toBe("20% fewer than September");
  });

  it("keeps twelve months at most, in order, whatever order they came in", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ month: `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, total: i }));
    const f = filedLastMonth([...many].reverse(), "2026-11-10");
    expect(f?.spark).toHaveLength(12);
    expect(f?.spark).toEqual([...f!.spark].sort((a, b) => a - b));
  });

  it("answers nothing when no month is complete", () => {
    expect(filedLastMonth([{ month: "2026-11", total: 5 }], "2026-11-10")).toBeUndefined();
    expect(filedLastMonth(null, "2026-11-10")).toBeUndefined();
  });
});
