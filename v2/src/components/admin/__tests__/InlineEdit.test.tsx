import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The admin table's inline edit: every control has a name a screen reader says, and a failed save is reported once,
 * by the handler that made it, never a second toast and a second error report from here.
 */
const toastError = vi.hoisted(() => vi.fn());
const captureError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/lib/sentry", () => ({ captureError }));

const { InlineEdit } = await import("../InlineEdit");

describe("InlineEdit", () => {
  it("names the field, its box and its two buttons", () => {
    // Arrange
    render(<InlineEdit value="Ada Lovelace" field="name" userId={"u1" as never} onSave={vi.fn()} />);
    // Act
    fireEvent.click(screen.getByRole("button", { name: "Edit name: Ada Lovelace" }));
    // Assert
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Save name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("leaves a failed save for its handler to report, and puts the old value back", async () => {
    // Arrange
    const onSave = vi.fn().mockRejectedValue(new Error("offline"));
    render(<InlineEdit value="Ada Lovelace" field="name" userId={"u1" as never} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit name: Ada Lovelace" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Ada" } });
    // Act
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    // Assert
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada Lovelace"));
    expect(toastError).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });
});
