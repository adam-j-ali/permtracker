import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DayTally } from "@/lib/filingDay";

import { MonthDays } from "../MonthDays";

const links = () => screen.getAllByRole("link");
/** Every day of a month filed on, none waiting unless given. */
const month = (ym: string, days: number, over: Record<string, DayTally> = {}) =>
  Object.fromEntries(
    Array.from({ length: days }, (_, i) => {
      const iso = `${ym}-${String(i + 1).padStart(2, "0")}`;
      return [iso, over[iso] ?? { filed: 10, waiting: 0 }];
    }),
  );

describe("MonthDays", () => {
  it("puts the 1st under its weekday, Monday first, and links every day filed on", () => {
    // Arrange: January 2026 begins on a Thursday.
    const { container } = render(<MonthDays month="2026-01" days={month("2026-01", 31)} today="2026-10-28" />);
    // Act
    const cells = [...container.querySelectorAll("ol > li")];
    // Assert: Monday, Tuesday and Wednesday are blank, then 31 days.
    expect(cells.slice(0, 3).every((c) => c.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(cells[3]?.textContent).toMatch(/^January 1,/);
    expect(links()).toHaveLength(31);
    expect(links()[0]).toHaveAttribute("href", "/perm-queue/2026-01/01");
    expect(links()[30]).toHaveAttribute("href", "/perm-queue/2026-01/31");
  });

  it("doesn't link a day with nothing filed, or one that hasn't come", () => {
    const days = month("2026-10", 31);
    delete days["2026-10-04"];
    render(<MonthDays month="2026-10" days={days} today="2026-10-28" />);
    expect(links()).toHaveLength(27);
    expect(screen.getByText("4").closest("a")).toBeNull();
    expect(screen.getByText("31").closest("a")).toBeNull();
  });

  it("shades the day with the most waiting darkest and one with none on the tint", () => {
    const days = month("2026-01", 31, {
      "2026-01-05": { filed: 500, waiting: 400 },
      "2026-01-06": { filed: 90, waiting: 30 },
    });
    render(<MonthDays month="2026-01" days={days} today="2026-10-28" />);
    const day = (n: number) => links()[n - 1]!;
    expect(day(5)).toHaveClass("bg-chart-orange", "text-black");
    expect(day(6)).toHaveClass("bg-soft-wait");
    expect(day(7)).toHaveClass("bg-tint");
    expect(day(5)).toHaveTextContent("400");
    expect(day(5)).toHaveAccessibleName("January 5, 2026: 500 filed, 400 still waiting at DOL. Open the day's cases");
  });

  it("names a day's link by its own words, so the name always holds the day shown on it", () => {
    // An aria-label that left out the figures on the cell failed WCAG 2.5.3 (label in name) on all 28 to 31 links.
    const days = month("2026-01", 31, { "2026-01-05": { filed: 1500, waiting: 1094 } });
    render(<MonthDays month="2026-01" days={days} today="2026-10-28" />);
    const five = links()[4]!;
    const seven = links()[6]!;
    expect(five).not.toHaveAttribute("aria-label");
    expect(five).toHaveAccessibleName("January 5, 2026: 1,500 filed, 1,094 still waiting at DOL. Open the day's cases");
    // The day number and the short figure a phone shows are for the eye; the name carries each once, exactly.
    expect([...five.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent)).toEqual(["5", "1.1K"]);
    // A day with none waiting says so.
    expect(seven).toHaveAccessibleName("January 7, 2026: 10 filed, 0 still waiting at DOL. Open the day's cases");
  });
});
