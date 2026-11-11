import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { PermTimelineEstimator } from "../PermTimelineEstimator";
import type { MeasuredPace } from "@/lib/perm";
import type { MonthQueue } from "@/lib/queueAhead";

/**
 * "Does the date count the holidays?" The pace model does: it walks DOL's calendar. The calculator says so under
 * its answer, in the same words as the case page, and says nothing when the wait holds no holiday.
 */

const month = (filingMonth: string, total: number, decided: number): MonthQueue => ({
  filingMonth,
  total,
  pending: total - decided,
  decided,
  decidedPct: total > 0 ? (decided / total) * 100 : null,
});

// A dated window: 760 decisions on a working day, 5 on a weekend or holiday.
const PACE: MeasuredPace = {
  pace: 544, fast: 650, slow: 450, weekdayMean: 760, weekendMean: 5, weekdaysUsed: 20, daysUsed: 28,
  workday: 760, offday: 5,
};

function answerText(today: string, queueMonth: string, months: MonthQueue[], initialMonth: string): string {
  render(
    <PermTimelineEstimator
      today={today}
      frontier={{ analystQueueMonth: queueMonth, officialAvgDays: 336, asOf: today }}
      cohorts={[]}
      frontierAdvance={{ rate: 1.0, slowest: 0.8, fastest: 2.0 }}
      disclosure={null}
      months={months}
      decisionPace={PACE}
      sweepAgeDays={0}
      initialMonth={initialMonth}
    />,
  );
  return (document.body.textContent ?? "").replace(/\s+/g, " ");
}

describe("the timeline calculator says what the holidays add", () => {
  it("prints the line when the wait runs through Thanksgiving and the year's end", () => {
    const body = answerText(
      "2026-11-03",
      "2025-11",
      [month("2025-11", 15_000, 7_500), month("2025-12", 15_000, 500), month("2026-01", 12_000, 200)],
      "2026-01",
    );
    expect(body).toMatch(/It allows \d+ days? for the federal holidays ahead and DOL's slower weeks around them\./);
  });

  it("prints no such line for a wait in March and April, which hold no federal holiday", () => {
    const body = answerText(
      "2027-03-01",
      "2026-03",
      [month("2026-03", 15_000, 7_500), month("2026-04", 15_000, 500), month("2026-05", 12_000, 200)],
      "2026-05",
    );
    expect(body).toMatch(/Around /);
    expect(body).not.toMatch(/federal holidays ahead/);
  });
});
