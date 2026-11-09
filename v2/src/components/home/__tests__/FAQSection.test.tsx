import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FAQSection } from "../FAQSection";

/**
 * A closed answer is out of reach, not only out of sight: its links were tab stops a keyboard landed on invisibly,
 * since the answer is folded by height and opacity alone. A closed answer is inert, an open one isn't.
 */
describe("FAQSection", () => {
  it("keeps closed answers out of the tab order, and opens one to the keyboard", () => {
    // Arrange
    const { container } = render(<FAQSection />);
    const regions = [...container.querySelectorAll<HTMLElement>('[role="region"]')];
    // Assert: all closed, all inert
    expect(regions.length).toBeGreaterThan(1);
    for (const r of regions) expect(r).toHaveAttribute("inert");
    // Act: open the first
    const first = screen.getAllByRole("button", { expanded: false })[0]!;
    fireEvent.click(first);
    // Assert
    expect(regions[0]).not.toHaveAttribute("inert");
    for (const r of regions.slice(1)) expect(r).toHaveAttribute("inert");
  });
});
