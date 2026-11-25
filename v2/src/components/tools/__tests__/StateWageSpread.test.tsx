/**
 * The wages page's one state chart (Nov 25 2026: the explorer's "By worksite state" and the "Every state on one axis"
 * chapter merged, keeping everything either showed): every state in short pages, the 5th to 95th and the 25th to 75th
 * as bands with the median, the 10th and 90th where the rows carry them, the whole ladder in the table, and the states
 * whose ladder jumps named.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StateWageSpread } from "../StateWageSpread";

const row = (state: string, n: number, base: number, jump = 1) => ({
  state, n, avg: base * 1.1,
  p5: base * 0.6, p10: base * 0.7, p25: base * 0.85, p50: base, p75: base * 1.2 * jump, p90: base * 1.4 * jump, p95: base * 1.6 * jump,
});

const ROWS = Array.from({ length: 20 }, (_, i) => row(`S${String(i).padStart(2, "0")}`, 1000 - i * 10, 80_000 + i * 1000));

describe("StateWageSpread", () => {
  it("draws every state a page at a time, busiest first", () => {
    const { container } = render(<StateWageSpread rows={ROWS} nounPlural="cases" minCases={30} />);
    const chart = () => within(container.querySelector("ol") as HTMLElement);
    expect(chart().getByText("S00")).toBeTruthy();
    expect(chart().queryByText("S15")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(chart().getByText("S15")).toBeTruthy();
  });

  it("keeps the whole ladder in the table, the 10th and 90th included", () => {
    render(<StateWageSpread rows={ROWS} nounPlural="cases" minCases={30} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual(["State", "Cases", "5th", "10th", "25th", "Median", "75th", "90th", "95th", "Average"]);
  });

  it("leaves the 10th and 90th out when no row carries them", () => {
    const five = ROWS.map(({ p10: _a, p90: _b, ...r }) => r);
    render(<StateWageSpread rows={five} nounPlural="cases" minCases={30} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).not.toContain("10th");
  });

  it("names a state whose ladder jumps", () => {
    const rows = [row("GA", 900, 30_000, 3.5), ...ROWS.slice(1)];
    render(<StateWageSpread rows={rows} nounPlural="cases" minCases={30} />);
    expect(screen.getAllByText(/two populations sharing one row/).length).toBeGreaterThan(0);
  });

  it("is the page's #by-state anchor", () => {
    const { container } = render(<StateWageSpread rows={ROWS} nounPlural="cases" minCases={30} />);
    expect(container.querySelector("#by-state")).toBeTruthy();
  });
});
