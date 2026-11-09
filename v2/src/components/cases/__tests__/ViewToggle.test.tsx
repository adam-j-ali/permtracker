import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ViewToggle } from "../ViewToggle";

/**
 * The card and list switch is two pressed-or-not buttons, each its own tab stop, and the picked one is lime like
 * every other picked option. It said "radio" while doing none of the arrow-key behaviour a radio group promises.
 */
describe("the case list's view switch", () => {
  it("is two toggle buttons, not a radio group it can't keep", () => {
    // Arrange, Act
    render(<ViewToggle view="card" onChange={vi.fn()} />);
    // Assert
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "View mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Card view" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the picked view in lime", () => {
    // Arrange, Act
    render(<ViewToggle view="list" onChange={vi.fn()} />);
    // Assert
    expect(screen.getByRole("button", { name: "List view" }).className).toMatch(/\bbg-primary\b/);
    expect(screen.getByRole("button", { name: "Card view" }).className).not.toMatch(/\bbg-primary\b/);
  });

  it("switches from the keyboard", async () => {
    // Arrange
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ViewToggle view="card" onChange={onChange} />);
    // Act
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    // Assert
    expect(onChange).toHaveBeenCalledWith("list");
  });
});
