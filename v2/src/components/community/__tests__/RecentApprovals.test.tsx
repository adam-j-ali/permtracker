import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RECENT_MIN, RECENT_STEPS, recentApprovals, type TimelineRecord } from "@/lib/communityTimeline";

import { RecentApprovals } from "../TimelineBoard";

/** The week's approvals: the window in words, a count at or over the floor, "Fewer than" under it, and the ask. */
const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ public: true, updatedAt: 1, ...over });

describe("approvals reported this week", () => {
  it("names the week and every step, with a count only at or over the floor", () => {
    const rows = Array.from({ length: RECENT_MIN + 1 }, (_, i) => rec({ eadOn: `2026-11-1${3 + i}` }));
    render(<RecentApprovals recent={recentApprovals(rows, "2026-11-18")!} />);
    expect(screen.getByRole("heading", { name: "Approvals reported this week" })).toBeTruthy();
    expect(screen.getByText(`Nov 12 to Nov 18, by the dates people added. Each count shows once ${RECENT_MIN} people report one.`)).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent?.trim());
    expect(items).toHaveLength(RECENT_STEPS.length);
    expect(items[0]).toBe(`Work permits (EAD) ${RECENT_MIN + 1}`);
    expect(items[1]).toBe(`Travel documents (advance parole) Fewer than ${RECENT_MIN}`);
    // Each item keeps its own space, so a count never runs into the next step's name.
    expect(screen.getByRole("list").textContent).toContain(`(EAD) ${RECENT_MIN + 1} Travel`);
    // With one count printed, the ask to add a date isn't needed.
    expect(screen.queryByText(/is how a wave shows here/)).toBeNull();
  });

  it("asks for dates when no step has reached the floor", () => {
    render(<RecentApprovals recent={recentApprovals([], "2026-11-18")!} />);
    expect(screen.getAllByText(`Fewer than ${RECENT_MIN}`)).toHaveLength(RECENT_STEPS.length);
    expect(screen.getByText(/Adding the date is how a wave shows here\./)).toBeTruthy();
  });
});
