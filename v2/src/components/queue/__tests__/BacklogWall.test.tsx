import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { BacklogMonth } from "@/lib/backlogMonths";

import { BacklogWall } from "../BacklogWall";

/**
 * The queue wall's percent column is about 48px on a phone, too narrow for "over 99%" or "under 0.1%": the cell
 * takes the short marks, and the words stay in the row's accessible name and its tip.
 */
const month = (m: string, pending: number, decided: number): BacklogMonth => ({
  month: m,
  total: pending + decided,
  pending,
  decided,
  decidedPct: ((decided / (pending + decided)) * 100),
  statuses: [
    { status: "ANALYST REVIEW", count: pending, isFinal: false },
    { status: "CERTIFIED", count: decided, isFinal: true },
  ],
});

describe("BacklogWall's percent column", () => {
  it("prints the short marks in the cell and the words in the row's name", () => {
    // Arrange, Act: one month nearly decided, one barely started
    render(
      <BacklogWall
        months={[month("2024-01", 41, 9_959), month("2026-01", 9_998, 2)]}
        frontierMonth={null}
        frontierAsOf={null}
        frontMonth="2026-01"
      />,
    );
    // Assert
    const old = screen.getByRole("listitem", { name: /January 2024: 41 of 10,000 still waiting, over 99% decided/ });
    expect(old.textContent).toContain(">99%");
    const recent = screen.getByRole("listitem", { name: /January 2026: 9,998 of 10,000 still waiting, under 0\.1% decided/ });
    expect(recent.textContent).toContain("<0.1%");
  });
});
