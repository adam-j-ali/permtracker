import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as unknown[]);
vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async (args: unknown) => void calls.push(args)) }));

import { TimelinesPanel, timelinesWaiting, type TimelinesData } from "../TimelinesPanel";

/**
 * Admin > Timelines: what waits first, with the dates and what to check beside each; approved timelines their
 * authors changed since; the decided ones. Every button sends the row's id, and a decline takes its reason from
 * the fixed list.
 */

type Row = TimelinesData["waiting"][number];
const AT = Date.UTC(2026, 10, 11, 15, 0);

const row = (over: Partial<Row>): Row => ({
  _id: "x" as Row["_id"],
  caseNumber: null,
  status: "pending",
  shared: true,
  hidden: false,
  edited: false,
  office: "Hartford",
  category: "EB-2",
  country: "India",
  route: "adjustment",
  premium: false,
  dates: [
    { label: "I-485 filed", on: "2025-05-01", verified: false },
    { label: "Green card", on: "2025-05-09", verified: false },
  ],
  rfe: null,
  declineReason: null,
  flags: ["The green card is dated 8 days after the I-485 filing."],
  createdAt: AT,
  updatedAt: AT,
  reviewedAt: null,
  ...over,
});

const data: TimelinesData = {
  waiting: [row({ _id: "w1" as Row["_id"] })],
  edited: [row({ _id: "e1" as Row["_id"], status: "approved", edited: true, flags: [], office: "Boston", reviewedAt: AT })],
  decided: [
    row({ _id: "d1" as Row["_id"], status: "declined", declineReason: "A test, or spam", flags: [], office: "Newark", reviewedAt: AT }),
    row({ _id: "a1" as Row["_id"], status: "approved", flags: [], office: "Tampa", caseNumber: "G-100-26029-601942", shared: false, reviewedAt: AT }),
  ],
};

const group = (name: RegExp) => screen.getByRole("heading", { name }).closest("section")!;

beforeEach(() => {
  calls.length = 0;
});

describe("TimelinesPanel", () => {
  it("shows a skeleton until the list arrives, and counts what needs the owner for the tab's badge", () => {
    const { container } = render(<TimelinesPanel data={undefined} />);
    expect(container.querySelector("li")).toBeNull();
    expect(timelinesWaiting(undefined)).toBe(0);
    expect(timelinesWaiting(data)).toBe(2);
  });

  it("puts what waits first, with its dates in Eastern words and what to check", () => {
    render(<TimelinesPanel data={data} />);
    const waiting = group(/Waiting for you \(1\)/);
    expect(within(waiting).getByText("Hartford, EB-2, India")).toBeTruthy();
    expect(within(waiting).getByText(/Check: The green card is dated 8 days after the I-485 filing\./)).toBeTruthy();
    expect(within(waiting).getByText("May 1, 2025")).toBeTruthy();
    expect(within(waiting).getByText("None given")).toBeTruthy();
    expect(within(waiting).getByText(/asked to be listed/)).toBeTruthy();
  });

  it("approves by the row's id", () => {
    render(<TimelinesPanel data={data} />);
    fireEvent.click(within(group(/Waiting for you/)).getByRole("button", { name: "Approve and show" }));
    expect(calls).toEqual([{ id: "w1" }]);
  });

  it("declines only with a reason from the fixed list", () => {
    render(<TimelinesPanel data={data} />);
    const waiting = group(/Waiting for you/);
    fireEvent.click(within(waiting).getByRole("button", { name: "Decline" }));
    expect(calls).toEqual([]);
    fireEvent.click(within(waiting).getByRole("button", { name: "Dates that can't be right" }));
    expect(calls).toEqual([{ id: "w1", reason: "implausible" }]);
  });

  it("lists an approved timeline its author changed, with one button to say it's fine", () => {
    render(<TimelinesPanel data={data} />);
    const edited = group(/Changed since you approved \(1\)/);
    expect(within(edited).getByText(/changed since you approved it/)).toBeTruthy();
    fireEvent.click(within(edited).getByRole("button", { name: "Looks fine" }));
    expect(calls).toEqual([{ id: "e1" }]);
  });

  it("shows a decided timeline's reason and its case number, marked as the owner's eyes only", () => {
    render(<TimelinesPanel data={data} />);
    const decided = group(/Decided \(2\)/);
    expect(within(decided).getByText(/A test, or spam/)).toBeTruthy();
    expect(within(decided).getByText("G-100-26029-601942 (only you see this)")).toBeTruthy();
    expect(within(decided).getByText("Counted in the medians only")).toBeTruthy();
  });

  it("asks before deleting", () => {
    render(<TimelinesPanel data={data} />);
    const edited = group(/Changed since you approved/);
    fireEvent.click(within(edited).getByRole("button", { name: "Delete for good" }));
    expect(calls).toEqual([]);
    fireEvent.click(within(edited).getByRole("button", { name: "Yes, delete it" }));
    expect(calls).toEqual([{ id: "e1" }]);
  });

  it("hides an approved timeline for now, and offers to show a hidden one again", () => {
    render(<TimelinesPanel data={{ ...data, decided: [row({ _id: "h1" as Row["_id"], status: "approved", hidden: true, flags: [], reviewedAt: AT })] }} />);
    fireEvent.click(within(group(/Changed since you approved/)).getByRole("button", { name: "Hide it for now" }));
    expect(calls).toEqual([{ id: "e1", hidden: true }]);
    expect(within(group(/Decided/)).getByText("Hidden")).toBeTruthy();
    expect(within(group(/Decided/)).getByRole("button", { name: "Show it again" })).toBeTruthy();
  });
});
