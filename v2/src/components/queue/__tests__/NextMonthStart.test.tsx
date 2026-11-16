import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BacklogMonth } from "@/lib/backlogMonths";
import type { MonthStart, NextStart } from "@/lib/monthStart";

import { NextMonthStart, answerLine, splitMonth } from "../NextMonthStart";

const s = (status: string, count: number, isFinal = false) => ({ status, count, isFinal });

/** February 2026 as the live census held it on Nov 16 2026. */
const february: BacklogMonth = {
  month: "2026-02",
  total: 5494,
  pending: 3451,
  decided: 2043,
  decidedPct: 37.2,
  statuses: [
    s("ANALYST REVIEW", 2975),
    s("CERTIFIED", 1806, true),
    s("APPLICATION ON HOLD", 407),
    s("WITHDRAWN", 224, true),
    s("RFI ISSUED", 68),
    s("DENIED", 13, true),
    s("REQUEST FOR REVIEW", 1),
  ],
};

const starts: MonthStart[] = [
  { month: "2025-12", day: "2026-09-22", previous: "2025-11", previousShare: 0.7996, previousDecided: 12279, previousWorkable: 15356, previousInLine: 2607 },
  { month: "2026-01", day: "2026-10-20", previous: "2025-12", previousShare: 0.8088, previousDecided: 12188, previousWorkable: 15070, previousInLine: 2557 },
  { month: "2026-02", day: "2026-11-10", previous: "2026-01", previousShare: 0.8248, previousDecided: 8582, previousWorkable: 10405, previousInLine: 1603 },
];

const shared = {
  month: "2026-03",
  current: "2026-02",
  currentStarted: "2026-11-10",
  asOf: "2026-11-15",
  decided: 2043,
  workable: 5087,
  inLine: 2975,
  held: 407,
  share: 2043 / 5087,
  shareLow: 0.7996,
  shareHigh: 0.8248,
  basedOn: starts,
};

const estimate: NextStart = {
  ...shared,
  state: "estimate",
  needLow: 2025,
  needHigh: 2153,
  pace: 603,
  from: "2026-11-20",
  to: "2026-11-20",
};

describe("NextMonthStart", () => {
  it("answers with the day, the work left and the pace, in rounded figures", () => {
    render(<NextMonthStart est={estimate} current={february} />);
    expect(screen.getByRole("heading", { level: 2, name: "When DOL starts March 2026" })).toBeTruthy();
    expect(screen.getByText("Likely Friday, Nov 20")).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).toContain("DOL began each of the last three months once the month before was about 80% to 82% decided.");
    expect(body).toContain("February is 40% decided.");
    expect(body).toContain("About 2,030 to 2,150 more February decisions to go.");
    expect(body).toContain("about 600 a working day since it began on Tuesday, Nov 10, which takes about 4 working days.");
    expect(body).toContain("407 on hold left out");
  });

  it("splits the bar by the queue page's own stage rule, holds left out", () => {
    expect(splitMonth(february)).toEqual({ decided: 2043, aside: 69, inLine: 2975 });
    render(<NextMonthStart est={estimate} current={february} />);
    expect(screen.getByText("At RFI, audit or appeal")).toBeTruthy();
    expect(screen.getByText("2,975")).toBeTruthy();
  });

  it("lists the last starts newest first, each with the month before's share", () => {
    render(<NextMonthStart est={estimate} current={february} />);
    expect(screen.getByRole("heading", { level: 3, name: "The last three starts" })).toBeTruthy();
    const items = screen.getAllByRole("listitem").filter((li) => /Began/.test(li.textContent ?? ""));
    expect(items.map((li) => li.querySelector("span")?.textContent)).toEqual(["February 2026", "January 2026", "December 2025"]);
    expect(items[0]?.textContent).toContain("January was 82% decided, with 1,603 still in analyst review.");
  });

  it("says a range, a due day and a count without a pace in their own words", () => {
    expect(answerLine({ ...estimate, from: "2026-11-19", to: "2026-11-23" })).toBe(
      "Likely between Thursday, Nov 19 and Monday, Nov 23",
    );
    expect(answerLine({ ...shared, state: "due", from: "2026-11-10" })).toBe("Due now: likely Tuesday, Nov 10");
    expect(answerLine({ ...estimate, pace: null, from: null, to: null })).toBe("After about 2,153 more February decisions");
  });

  it("keeps every word apart in the rendered text", () => {
    const { container } = render(<NextMonthStart est={estimate} current={february} />);
    const text = container.textContent ?? "";
    // The usual JSX glue: a figure running into the next word or a label into its count.
    expect(text).not.toMatch(/\d[A-Za-z]/);
    expect(text).not.toMatch(/[a-z]\d/);
    expect(text).not.toMatch(/decided\d|review\d|appeal\d/);
  });
});
