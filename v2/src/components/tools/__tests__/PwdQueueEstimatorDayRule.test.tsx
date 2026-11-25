import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { estimatePwdDay } from "@/lib/perm";
import type { PwdDayData } from "@/lib/pwdDay";
import { longDate } from "@convex/lib/months";

import { PwdQueueEstimator } from "../PwdQueueEstimator";

/**
 * D6 (Nov 25 2026): the wage request calculator's "Estimated determination" uses the day rule the case page and
 * /pwd-cases use (estimatePwdDay, about 0 days off in the backtest), for the middle of the month picked. DOL's month
 * table at its clearance rate (about 15 days off) stays only as the fallback when our daily count is missing or stale,
 * as on the case page.
 */

const BACKLOG = [
  { receiptMonth: "2026-07", remainingRequests: 1200 },
  { receiptMonth: "2026-08", remainingRequests: 9800 },
];

const DAY: PwdDayData = {
  queue: {
    asOf: "2026-10-30",
    byDay: [
      ["2026-07-27", 336],
      ["2026-07-28", 717],
      ["2026-08-03", 780],
      ["2026-08-14", 760],
      ["2026-08-17", 640],
    ],
    pace: { perWorkday: 700, fast: 775, slow: 669, workdaysUsed: 19 },
  },
  tested: null,
  measuredRange: [],
};

const TODAY = "2026-10-31";

function view(props: Partial<Parameters<typeof PwdQueueEstimator>[0]> = {}) {
  return render(
    <PwdQueueEstimator
      frontier={{ oewsMonth: "2026-07", nonOewsMonth: null }}
      backlog={BACKLOG}
      asOf="2026-10-30"
      clearancePerMonth={8766}
      {...props}
    />,
  );
}

describe("the calculator's estimated determination", () => {
  it("dates the middle of the picked month by the day rule", () => {
    view({ dayData: DAY, today: TODAY });
    const expected = estimatePwdDay({ filingDate: "2026-08-15", today: TODAY, queue: DAY.queue, measuredRange: [] });
    if (expected.kind !== "estimate") throw new Error("expected a dated estimate");
    expect(screen.getByText(`Around ${longDate(expected.date)}`)).toBeTruthy();
    expect(screen.getByText(/For a request filed August 15, 2026, the middle of the month/)).toBeTruthy();
    // 336 + 717 + 780 + 760 filed before the 15th are still waiting.
    expect(screen.getByText(/2,593 filed before it are still waiting/)).toBeTruthy();
    expect(screen.queryByText(/requests a month DOL has been clearing/)).toBeNull();
  });

  it("falls back to DOL's month table, and says why, when our daily count is missing", () => {
    view({ dayData: null, today: TODAY });
    expect(screen.getByText(/requests a month DOL has been clearing/)).toBeTruthy();
    expect(screen.getByText(/daily count, which dates a request by its day, isn't available/)).toBeTruthy();
  });

  it("falls back the same way when our count is too old to date from", () => {
    view({ dayData: { ...DAY, queue: { ...DAY.queue, asOf: "2026-10-20" } }, today: TODAY });
    expect(screen.getByText(/requests a month DOL has been clearing/)).toBeTruthy();
  });

  it("dates today rather than a middle of the month still to come", () => {
    view({
      dayData: DAY,
      today: "2026-08-10",
      backlog: [...BACKLOG],
    });
    expect(screen.getByText(/For a request filed August 10, 2026/)).toBeTruthy();
  });
});
