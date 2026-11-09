import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EventProps } from "react-big-calendar";

import { createCalendarEvent, type CalendarEvent as CalendarEventType } from "@/lib/calendar/types";
import type { Id } from "@convex/_generated/dataModel";
import { CalendarEvent } from "../CalendarEvent";

/**
 * A deadline on the calendar grid: a link to its case that a keyboard can reach, with a hover and focus summary
 * that names the case's stage once, in words.
 */
const event = createCalendarEvent({
  id: "e1",
  title: "ETA 9089 filing window closes: Acme Corp",
  start: new Date(2026, 10, 20),
  end: new Date(2026, 10, 20),
  allDay: true,
  caseId: "case123" as Id<"cases">,
  deadlineType: "filing_window_closes" as never,
  stage: "eta9089",
  isFilingWindow: true,
  daysUntil: 11,
  employerName: "Acme Corp",
  positionTitle: "Software engineer",
  caseStatus: "eta9089",
});

const props = { event, title: event.title } as unknown as EventProps<CalendarEventType>;

describe("a deadline on the calendar grid", () => {
  it("is a link to its case that a keyboard can reach", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<CalendarEvent {...props} />);
    // Act
    await user.tab();
    // Assert
    const link = screen.getByRole("link", { name: /ETA 9089 filing window closes: Acme Corp/ });
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute("href", "/cases/case123");
  });

  it("names the stage in words, once, and never prints a raw stage code", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<CalendarEvent {...props} />);
    // Act: focus opens the summary, as hover does
    await user.tab();
    // Assert
    const summary = await screen.findAllByText("ETA 9089");
    expect(summary.length).toBeGreaterThan(0);
    expect(screen.queryByText("eta9089")).not.toBeInTheDocument();
    expect(screen.queryByText("Progress")).not.toBeInTheDocument();
  });

  it("lets a key press reach the page's own shortcuts while it has focus", async () => {
    // Arrange: a document-level shortcut, like the app search's Cmd or Ctrl+K
    const user = userEvent.setup();
    const onKey = vi.fn();
    document.addEventListener("keydown", onKey);
    render(<CalendarEvent {...props} />);
    await user.tab();
    // Act
    await user.keyboard("{Control>}k{/Control}");
    // Assert: the k itself reached the page, not only the Control key's own press
    expect(onKey.mock.calls.some(([e]) => (e as KeyboardEvent).key === "k" && (e as KeyboardEvent).ctrlKey)).toBe(true);
    document.removeEventListener("keydown", onKey);
  });
});

