import { describe, expect, it } from "vitest";

import { ISSUED_WINDOW_HOURS, issuedWeek, type IssuedRun } from "../uscisIssued";

const run = (day: string, issued: number, hours: number, block = "IOE09", byForm?: Record<string, number>): IssuedRun => ({
  day,
  block,
  issued,
  hours,
  per_day: Math.round((issued * 24) / hours),
  by_form: byForm ?? { "I-765": issued },
});

describe("online receipts issued a day", () => {
  it("says nothing until a block's walks cover a full week", () => {
    const sixDays = Array.from({ length: 6 }, (_, i) => run(`2026-11-2${i}`, 15_000, 24));
    expect(issuedWeek(sixDays)).toBeNull();
    expect(ISSUED_WINDOW_HOURS).toBe(168);
  });

  it("sums the newest runs until they cover a week, then counts cases a day over those hours", () => {
    // Seven 24-hour walks, then an older one the window doesn't need.
    const runs = [
      run("2026-11-10", 99_999, 24),
      ...Array.from({ length: 7 }, (_, i) => run(`2026-11-${12 + i}`, 14_000, 24)),
    ];
    const week = issuedWeek(runs);
    expect(week).not.toBeNull();
    expect(week!.issued).toBe(98_000);
    expect(week!.perDay).toBe(14_000);
    expect(week!.from).toBe("2026-11-12");
    expect(week!.to).toBe("2026-11-18");
  });

  it("weights a short overnight run by its hours, never as a day", () => {
    // 400 cases in 8 overnight hours, then 160 hours at the daytime pace: the week is 400 + 15,000 x 160/24.
    const runs = [run("2026-11-11", 400, 8), ...Array.from({ length: 4 }, (_, i) => run(`2026-11-${12 + i}`, 25_000, 40))];
    const week = issuedWeek(runs)!;
    expect(week.hours).toBe(168);
    expect(week.perDay).toBe(Math.round(((400 + 100_000) * 24) / 168));
  });

  it("adds the online blocks together and leaves paper blocks out", () => {
    const week = (block: string, n: number) => Array.from({ length: 7 }, (_, i) => run(`2026-11-${12 + i}`, n, 24, block));
    const both = issuedWeek([...week("IOE09", 14_000), ...week("IOE98", 1_000), ...week("SRC27", 300)])!;
    expect(both.perDay).toBe(15_000);
  });

  it("names the forms with the most cases a day, and leaves a case with no form out", () => {
    const runs = Array.from({ length: 7 }, (_, i) =>
      run(`2026-11-${12 + i}`, 10_000, 24, "IOE09", { "I-765": 6_000, "I-485": 3_000, "": 700, "I-131": 300 }),
    );
    expect(issuedWeek(runs, 2)!.forms).toEqual([
      { form: "I-765", perDay: 6_000 },
      { form: "I-485", perDay: 3_000 },
    ]);
  });
});
