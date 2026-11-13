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

  it("gives the last column room for its own heading on a phone, in the heading row and every month's row alike", () => {
    // "Decided" in bold 14px is 56px wide. In a 48px column the page's own break rule split it as "Decide" over "d"
    // (seen at 390px, Nov 12 2026). The widths were measured on the page: a month's name needs about 60px of its
    // 80, the largest count 49px of its 56, so the 12px the heading lacked comes from those two and the bar keeps
    // every pixel it had (widening the last column alone took the bar to nothing at 320px). The heading row and the
    // month rows are separate grids, so they must share one set of columns or the figures drift from their headings.
    const { container } = render(
      <BacklogWall
        months={[month("2025-12", 500, 9_500), month("2026-01", 9_000, 1_000)]}
        frontierMonth={null}
        frontierAsOf={null}
        frontMonth="2026-01"
      />,
    );
    const PHONE_COLUMNS = "grid-cols-[4.5rem_1fr_3.25rem_3.75rem]";
    const heading = Array.from(container.querySelectorAll("div[aria-hidden='true']")).find((d) => d.textContent?.includes("Decided"));
    expect(heading?.className.split(/\s+/)).toContain(PHONE_COLUMNS);
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.className.split(/\s+/)).toContain(PHONE_COLUMNS);
  });
});
