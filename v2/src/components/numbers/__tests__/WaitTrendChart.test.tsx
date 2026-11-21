import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WaitTrendChart } from "../WaitTrendChart";
import { parseWaitTrend } from "@/lib/pwdNow";

/**
 * The PERM wait trend runs from FY2015 (DOL's older files) to this month: about 145 columns, one a month, which
 * overflow a 375px phone at the chart's 3px gaps alone. It shows three fiscal years at a time, the newest first,
 * with a row of choices for the earlier ones; a short trend (the wage requests', from FY2024) stays one chart.
 */

function trendOf(first: string, count: number, newestPartial = false) {
  const months = [];
  let [y, m] = first.split("-").map(Number) as [number, number];
  for (let i = 0; i < count; i++) {
    months.push({ m: `${y}-${String(m).padStart(2, "0")}`, n: 900, p25: 50, p50: 100 + i, p75: 150, from: "files" });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  if (newestPartial) Object.assign(months[months.length - 1]!, { from: "sweep", partial: true });
  return parseWaitTrend(JSON.stringify({ asOf: "2026-11-21", filesThrough: "2026-06-30", months }))!;
}

const LABEL = "Median days from filing to decision, by the month DOL decided";

describe("WaitTrendChart", () => {
  it("shows the newest three fiscal years first, with a choice for each earlier window", () => {
    render(<WaitTrendChart trend={trendOf("2014-10", 145)} noun="cases" label={LABEL} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Since FY2024",
      "FY2021 to FY2023",
      "FY2018 to FY2020",
      "FY2015 to FY2017",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tablist")).toHaveAccessibleName("Years shown");
    // Every window is in the page, the ones not picked hidden.
    const panels = screen.getAllByRole("tabpanel", { hidden: true });
    expect(panels).toHaveLength(4);
    expect(panels.filter((p) => !p.hidden)).toHaveLength(1);
  });

  it("keeps each window to a phone's width of columns, on one shared scale", () => {
    const { container } = render(<WaitTrendChart trend={trendOf("2014-10", 145)} noun="cases" label={LABEL} />);
    const panels = [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    const maxes = new Set<string>();
    for (const p of panels) {
      const cols = p.querySelectorAll('[role="img"] > [data-tip]');
      expect(cols.length).toBeGreaterThan(0);
      // 47 columns and their 3px gaps fit a 375px screen's chart width; 145 don't.
      expect(cols.length).toBeLessThanOrEqual(47);
      maxes.add(p.querySelector("p")?.textContent ?? "");
    }
    expect(maxes.size).toBe(1);
  });

  it("draws the newest month lime, in the first window only", () => {
    const { container } = render(<WaitTrendChart trend={trendOf("2014-10", 145)} noun="cases" label={LABEL} />);
    const lime = [...container.querySelectorAll('[role="img"] > .bg-primary')];
    expect(lime).toHaveLength(1);
    expect(lime[0]!.closest('[role="tabpanel"]')).toBe(container.querySelector('[role="tabpanel"]'));
    expect(lime[0]!.getAttribute("data-tip")).toMatch(/^Decided in October 2026/);
  });

  it("moves to an earlier window by keyboard", () => {
    render(<WaitTrendChart trend={trendOf("2014-10", 145)} noun="cases" label={LABEL} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(screen.getAllByRole("tab")[3]).toHaveAttribute("aria-selected", "true");
    const shown = screen.getAllByRole("tabpanel").find((p) => !p.hidden)!;
    expect(within(shown).getByText("Oct ’14")).toBeInTheDocument();
  });

  it("stays one chart for a trend of a few years", () => {
    const { container } = render(<WaitTrendChart trend={trendOf("2023-10", 38, true)} noun="requests" label={LABEL} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[role="img"] > [data-tip]').length).toBe(38);
  });
});
