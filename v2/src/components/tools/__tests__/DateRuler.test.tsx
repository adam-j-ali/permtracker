import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { DateRuler } from "../DateRuler";

/**
 * The ruler's count under the bar. Before the period starts (an I-94 or OPT end still ahead) it says how long until
 * it starts; it never counts "left" from today across days the period doesn't hold.
 */
describe("DateRuler's count", () => {
  it("says how long until a period that hasn't started, never more days left than it holds", () => {
    // Arrange: a 240-day period starting Dec 1, seen on Oct 2
    const { container } = render(
      <DateRuler from="2026-12-01" to="2027-07-28" today="2026-10-02" fromLabel="Starts" toLabel="Ends" emptyHint="" inclusive />,
    );
    // Act
    const text = container.textContent ?? "";
    // Assert
    expect(text).toContain("60 days until it starts, then 240 in all.");
    expect(text).not.toMatch(/days left/);
  });

  it("counts the days left once the period has started", () => {
    // Arrange, Act
    const { container } = render(
      <DateRuler from="2026-12-01" to="2027-07-28" today="2027-07-18" fromLabel="Starts" toLabel="Ends" emptyHint="" inclusive />,
    );
    // Assert
    expect(container.textContent).toContain("10 days left, of 240 in all.");
  });
});
