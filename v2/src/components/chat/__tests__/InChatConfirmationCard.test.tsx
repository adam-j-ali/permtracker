// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { InChatConfirmationCard } from "../InChatConfirmationCard";

/** A card's answer is sent once: a second press while the card is on its way out sends nothing more. */
function card(onApprove = vi.fn(), onDeny = vi.fn()) {
  render(
    <InChatConfirmationCard
      toolName="deleteCase"
      toolCallId="t1"
      arguments={{ id: "c1" }}
      description="Delete the case"
      isDestructive
      status="pending"
      onApprove={onApprove}
      onDeny={onDeny}
    />,
  );
  return { onApprove, onDeny };
}

describe("InChatConfirmationCard", () => {
  it("sends Cancel once, however many times it's pressed", () => {
    // Arrange
    const { onDeny, onApprove } = card();
    // Act
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    // Assert
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("sends Confirm once", () => {
    // Arrange
    const { onApprove } = card();
    // Act
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    // Assert
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
