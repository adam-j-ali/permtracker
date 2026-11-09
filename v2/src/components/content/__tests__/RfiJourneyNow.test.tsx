import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The RFI timing guide's live figures: the same three reads the RFI page makes, two tiles across at most inside
 * the article column, and a link to the RFI page when none of them can be read.
 */
const reads = vi.hoisted(() => ({ stats: null as unknown, clock: null as unknown, fail: false }));
vi.mock("@/lib/db/stageStats", () => ({
  getStageStats: vi.fn(async () => {
    if (reads.fail) throw new Error("read failed");
    return reads.stats;
  }),
}));
vi.mock("@/lib/db/rfiClock", () => ({
  getRfiClock: vi.fn(async () => {
    if (reads.fail) throw new Error("read failed");
    return reads.clock;
  }),
}));
vi.mock("@/lib/db/pulse", () => ({ getObservedDays: vi.fn(async () => []) }));
vi.mock("@/lib/softRead", () => ({ softFail: (_label: string, fallback: unknown) => () => fallback }));
vi.mock("@/components/rfi/StepByStep", () => ({
  RfiJourney: (props: { narrow?: boolean }) => <p>{`journey narrow=${String(props.narrow)}`}</p>,
}));

const { RfiJourneyNow } = await import("../RfiJourneyNow");

describe("RfiJourneyNow", () => {
  it("points to the RFI page when no figure can be read", async () => {
    // Arrange
    reads.fail = true;
    // Act
    render((await RfiJourneyNow()) as ReactElement);
    // Assert
    expect(screen.getByRole("link", { name: "RFI and audit page" })).toHaveAttribute("href", "/perm-rfi-audit#step-by-step");
    reads.fail = false;
  });

  it("shows the RFI page's block, narrowed for the article column", async () => {
    // Arrange
    reads.clock = { leaveDays: { p50: 31 }, afterLeaveDays: { p50: 12, p75: 20 } };
    // Act
    render((await RfiJourneyNow()) as ReactElement);
    // Assert
    expect(screen.getByText("journey narrow=true")).toBeInTheDocument();
  });
});
