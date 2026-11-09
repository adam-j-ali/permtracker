// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { NoteEntry } from "@/lib/forms/case-form-schema";

import { NotesTab } from "../NotesTab";

/**
 * The notes tab, as a reader uses it: a note opens from the keyboard, the list pages while a note is open, every
 * control has a name, and a note is deleted only after a second press, since a deleted note can't be brought back.
 */
const notes: NoteEntry[] = Array.from({ length: 15 }, (_, i) => ({
  id: `n${i + 1}`,
  content: `Note number ${i + 1}`,
  // Newest first on the list, so note 15 is at the top.
  createdAt: 1_790_000_000_000 + i * 1000,
  status: "pending",
  priority: "medium",
  category: "other",
}));

describe("opening and paging notes", () => {
  it("opens a note from the keyboard", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<NotesTab notes={notes} onUpdateNotes={vi.fn()} />);
    // Act
    screen.getByRole("button", { name: "Note number 15" }).focus();
    await user.keyboard("{Enter}");
    // Assert
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
  });

  it("names the pager's buttons, and pages while a note is open", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<NotesTab notes={notes} onUpdateNotes={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Note number 15" }));
    // Act
    await user.click(screen.getByRole("button", { name: "Next page" }));
    // Assert
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Note number 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("names the filter and the new note's category and due date", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<NotesTab notes={notes} onUpdateNotes={vi.fn()} />);
    // Act
    await user.type(screen.getByPlaceholderText(/Add a case note/), "Call the client");
    // Assert
    expect(screen.getByLabelText("Show")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
  });
});

describe("deleting a note", () => {
  it("asks first, and deletes only on Delete", async () => {
    // Arrange
    const onUpdateNotes = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<NotesTab notes={notes.slice(0, 2)} onUpdateNotes={onUpdateNotes} />);
    // Act: the row's trash button, then Keep it
    await user.click(screen.getByRole("button", { name: "Delete note: Note number 2" }));
    expect(await screen.findByText("Delete this note?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    // Assert
    expect(onUpdateNotes).not.toHaveBeenCalled();

    // Act: again, then Delete
    await user.click(screen.getByRole("button", { name: "Delete note: Note number 2" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    // Assert
    await waitFor(() => expect(onUpdateNotes).toHaveBeenCalledTimes(1));
    expect(onUpdateNotes.mock.calls[0]![0].map((n: NoteEntry) => n.id)).toEqual(["n1"]);
  });

  it("puts focus back on the trash button when the dialog is closed with Keep it", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<NotesTab notes={notes.slice(0, 2)} onUpdateNotes={vi.fn()} />);
    const trash = screen.getByRole("button", { name: "Delete note: Note number 2" });
    // Act
    await user.click(trash);
    await user.click(await screen.findByRole("button", { name: "Keep it" }));
    // Assert
    await waitFor(() => expect(trash).toHaveFocus());
  });
});

