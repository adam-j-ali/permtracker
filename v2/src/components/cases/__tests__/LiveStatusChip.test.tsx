import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LiveStatusChip } from "../LiveStatusChip";

/**
 * DOL's live status on a saved case wears the site's one status colour code: certified green, denied red, filed or
 * waiting yellow, withdrawn purple. The words always say it too; the dot is a second cue.
 */
describe("LiveStatusChip", () => {
  it.each([
    ["CERTIFIED", "good"],
    ["DENIED", "bad"],
    ["ANALYST REVIEW", "wait"],
    ["WITHDRAWN", "withdrawn"],
  ])("colours %s as the site's %s tint", (status, tint) => {
    // Arrange, Act
    render(<LiveStatusChip status={status} />);
    // Assert
    expect(screen.getByText(status)).toBeInTheDocument();
    expect(screen.getByTestId("live-status-dot")).toHaveAttribute("data-tint", tint);
  });

  it("gives a waiting case and a withdrawn one different colours", () => {
    // Arrange
    const { rerender } = render(<LiveStatusChip status="ANALYST REVIEW" />);
    const waiting = screen.getByTestId("live-status-dot").className;
    // Act
    rerender(<LiveStatusChip status="WITHDRAWN" />);
    // Assert
    expect(screen.getByTestId("live-status-dot").className).not.toBe(waiting);
  });
});
