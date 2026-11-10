import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Held mail is the only copy, so Delete asks for a second press, and once "Not spam" has sent a message on, its row
 * offers nothing more to press: a second forward or a delete after the release was one click away.
 */
const mutations = vi.hoisted(() => ({ release: vi.fn(), remove: vi.fn(), markSpam: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => {
    const name = String((ref as { _name?: string })?._name ?? ref);
    if (name.includes("release")) return mutations.release;
    if (name.includes("deleteHeld")) return mutations.remove;
    return mutations.markSpam;
  },
}));
vi.mock("@convex/_generated/api", () => ({
  api: { inboundFilter: { release: "inboundFilter:release", deleteHeld: "inboundFilter:deleteHeld", markSpam: "inboundFilter:markSpam" } },
}));

const { InboxFilterPanel } = await import("../InboxFilterPanel");

const held = {
  id: "m1",
  fromEmail: "sender@example.test",
  fromName: "A sender",
  toEmail: "support@example.test",
  subject: "A message",
  snippet: "Hello",
  reasons: ["link shortener"],
  score: 7,
  heldAt: 1_790_000_000_000,
  receivedAt: 1_790_000_000_000,
};
const data = { held: [held], recent: [] } as never;

beforeEach(() => {
  mutations.release.mockReset().mockResolvedValue(null);
  mutations.remove.mockReset().mockResolvedValue(null);
});

describe("the held mail list", () => {
  it("deletes held mail only on a second press, and Keep it backs out", async () => {
    // Arrange
    render(<InboxFilterPanel data={data} />);
    // Act: the first press only asks
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Assert
    expect(mutations.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    // Act: ask again, then confirm
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    // Assert
    await waitFor(() => expect(mutations.remove).toHaveBeenCalledWith({ id: "m1" }));
  });

  it("offers nothing more once Not spam has sent it on", async () => {
    // Arrange
    render(<InboxFilterPanel data={data} />);
    // Act
    fireEvent.click(screen.getByRole("button", { name: "Not spam" }));
    // Assert
    await screen.findByText("Sending to your inbox");
    expect(screen.queryByRole("button", { name: "Not spam" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(mutations.release).toHaveBeenCalledTimes(1);
  });

  // Each press swaps buttons, which drops keyboard focus to the page unless it's moved on purpose.
  it("keeps keyboard focus on the row through Delete, Keep it and Not spam", async () => {
    // Arrange
    render(<InboxFilterPanel data={data} />);
    // Act, Assert: the first press hands focus to Keep it
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    // Backing out hands it back to Delete
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    // Not spam hands it to the line that says what happened
    fireEvent.click(screen.getByRole("button", { name: "Not spam" }));
    await waitFor(() => expect(screen.getByText("Sending to your inbox")).toHaveFocus());
  });

  // The server drops a released row a moment after the press. If the row left the list, the one under it would slide
  // up beneath the same thumb, and a second tap would let that one through too.
  it("keeps a row where it stood after Not spam, so the next row never slides under the same press", async () => {
    // Arrange: two held messages, the newer one first
    const older = { ...held, id: "m0", subject: "An older message", receivedAt: held.receivedAt - 60_000, heldAt: held.heldAt - 60_000 };
    const { rerender } = render(<InboxFilterPanel data={{ held: [held, older], recent: [] } as never} />);
    // Act: let the first through, then the server's list comes back without it
    fireEvent.click(screen.getAllByRole("button", { name: "Not spam" })[0]!);
    await screen.findByText("Sending to your inbox");
    rerender(<InboxFilterPanel data={{ held: [older], recent: [] } as never} />);
    // Assert: both rows are still listed, in the same order, and only the older one can still be pressed
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("A message");
    expect(rows[0]).toHaveTextContent("Sending to your inbox");
    expect(rows[1]).toHaveTextContent("An older message");
    expect(screen.getAllByRole("button", { name: "Not spam" })).toHaveLength(1);
    expect(mutations.release).toHaveBeenCalledTimes(1);
    expect(mutations.release).toHaveBeenCalledWith({ id: "m1" });
    // The count is the mail still waiting, not the rows on screen
    expect(screen.getByRole("heading", { name: "Held (1)" })).toBeInTheDocument();
  });

  it("keeps a deleted row where it stood too, saying Deleted, with nothing left to press on it", async () => {
    // Arrange
    const older = { ...held, id: "m0", subject: "An older message", receivedAt: held.receivedAt - 60_000, heldAt: held.heldAt - 60_000 };
    const { rerender } = render(<InboxFilterPanel data={{ held: [held, older], recent: [] } as never} />);
    // Act
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    await screen.findByText("Deleted");
    rerender(<InboxFilterPanel data={{ held: [older], recent: [] } as never} />);
    // Assert
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Deleted");
    expect(rows[1]).toHaveTextContent("An older message");
    expect(screen.getByText("Deleted")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Delete for good" })).not.toBeInTheDocument();
    expect(mutations.remove).toHaveBeenCalledTimes(1);
  });

  it("says nothing is held only when no row is left to show", () => {
    render(<InboxFilterPanel data={{ held: [], recent: [] } as never} />);
    expect(screen.getByText("Nothing held.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Held" })).toBeInTheDocument();
  });
});

