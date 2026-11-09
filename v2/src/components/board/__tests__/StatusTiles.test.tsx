import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatusTiles } from "../BoardParts";

/**
 * A status tile with no reading for a window says so: a missing count had read "same", a claim that nothing moved.
 */
describe("StatusTiles", () => {
  it("says there's no reading where a window has none, never \"same\"", () => {
    // Arrange, Act
    render(
      <StatusTiles
        dayLabel="Yesterday"
        rows={[
          { status: "ANALYST REVIEW", now: 1200, day: null, week: { status: "ANALYST REVIEW", in: 40, out: 40, net: 0 } as never },
        ]}
      />,
    );
    // Assert: the day has no reading, the week truly didn't move
    expect(screen.getByText("no reading")).toBeInTheDocument();
    expect(screen.getAllByText("same")).toHaveLength(1);
  });
});
