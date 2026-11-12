import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AnswerNext } from "../AnswerNext";

// The email box beside the date renders nothing without a Convex address: pinned, so this file is about the date.
const REAL_CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
beforeAll(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://test-deployment.convex.cloud";
});
afterAll(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = REAL_CONVEX_URL;
});

const base = { caseNumber: "G-100-26044-639002", program: "perm" as const, date: "Around November 23, 2026" };

/**
 * Under a pending case's estimated date: the days left and the share of the estimated wait behind it, as a bar and a
 * sentence. Both come from the estimate, so they show only with a date and always call themselves an estimate.
 */
describe("the days left under an estimated decision", () => {
  it("draws the wait passed as a named bar and says the days left and the share in words", () => {
    render(<AnswerNext {...base} progress={{ daysLeft: 11, daysPassed: 272, totalDays: 283, passedPct: 96 }} />);
    expect(screen.getByText("About 11 days left.")).toBeInTheDocument();
    expect(screen.getByText("96% of the estimated wait has passed.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "272 of an estimated 283 days have passed" })).toBeInTheDocument();
  });

  it("counts one day as a day, and the day itself as today", () => {
    const { rerender } = render(<AnswerNext {...base} progress={{ daysLeft: 1, daysPassed: 282, totalDays: 283, passedPct: 99 }} />);
    expect(screen.getByText("About 1 day left.")).toBeInTheDocument();
    rerender(<AnswerNext {...base} progress={{ daysLeft: 0, daysPassed: 283, totalDays: 283, passedPct: 99 }} />);
    expect(screen.getByText("Estimated for today.")).toBeInTheDocument();
  });

  it("draws nothing without a count, and nothing without a date to count to", () => {
    const { rerender } = render(<AnswerNext {...base} progress={null} />);
    expect(screen.queryByText(/of the estimated wait has passed/)).toBeNull();
    expect(screen.queryByRole("img", { name: /days have passed/ })).toBeNull();
    rerender(<AnswerNext {...base} date={null} note="No date can honestly be put on this case." progress={{ daysLeft: 11, daysPassed: 272, totalDays: 283, passedPct: 96 }} />);
    expect(screen.queryByText(/days left/)).toBeNull();
  });
});
