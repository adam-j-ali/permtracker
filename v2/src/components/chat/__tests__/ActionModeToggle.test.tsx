// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ActionModeToggle } from "../ActionModeToggle";

/**
 * While a mode change saves, the strip waits, but the picked mode keeps keyboard focus: a disabled button drops focus
 * to the page, so the strip marks itself unavailable instead and ignores presses.
 */
describe("ActionModeToggle while a change saves", () => {
  it("keeps the focused mode focusable and ignores presses", () => {
    // Arrange
    const onChange = vi.fn();
    const { rerender } = render(<ActionModeToggle mode="confirm" onChange={onChange} />);
    const picked = screen.getByRole("radio", { name: /Ask first/ });
    picked.focus();
    // Act: the save starts
    rerender(<ActionModeToggle mode="confirm" onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("radio", { name: /Auto/ }));
    // Assert
    expect(picked).not.toBeDisabled();
    expect(picked).toHaveAttribute("aria-disabled", "true");
    expect(picked).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });
});
