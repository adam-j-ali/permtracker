import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The appeal guide's live count of where each appeal step led: the page's own block over the appeal's steps
 * alone, and a link to the page when the count can't be read or holds too few moves to show.
 */
const reads = vi.hoisted(() => ({ stats: null as unknown, fail: false }));
vi.mock("@/lib/db/stageStats", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db/stageStats")>("@/lib/stageStatsShape")),
  getStageStats: vi.fn(async () => {
    if (reads.fail) throw new Error("read failed");
    return reads.stats;
  }),
}));
vi.mock("@/lib/softRead", () => ({ softFail: (_label: string, fallback: unknown) => () => fallback }));

const { AppealStepsNow } = await import("../AppealStepsNow");

const STATS = {
  asOf: "2026-11-09",
  source: "DOL",
  since: "2026-08-30",
  stages: [{ status: "RECONSIDERATION APPEALS", pending: 2559, meanAgeDays: 520 }],
  exits: [
    { from: "DENIED", to: "RECONSIDERATION APPEALS", n: 726 },
    { from: "DENIED", to: "ANALYST REVIEW", n: 17 },
    { from: "DENIED", to: "CERTIFIED", n: 10 },
    { from: "RECONSIDERATION APPEALS", to: "NORD ISSUED", n: 335 },
    { from: "RECONSIDERATION APPEALS", to: "CERTIFIED", n: 303 },
    { from: "RFI ISSUED", to: "ANALYST REVIEW", n: 1851 },
    { from: "RFI ISSUED", to: "WITHDRAWN", n: 77 },
  ],
  durations: [],
};

beforeEach(() => {
  reads.fail = false;
  reads.stats = STATS;
});

describe("AppealStepsNow", () => {
  it("shows the appeal's own steps from the page's count, and leaves the RFI's out", async () => {
    render((await AppealStepsNow()) as ReactElement);
    expect(screen.getByRole("heading", { name: "After a denial" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "After a motion to reconsider" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "After an RFI" })).toBeNull();
    expect(screen.getByText(/753 moves seen/)).toBeInTheDocument();
  });

  it("says the day the count runs from, as the document itself gives it", async () => {
    const { container } = render((await AppealStepsNow()) as ReactElement);
    expect(container.textContent).toContain("since August 30, 2026");
  });

  it("points to the page when the count can't be read", async () => {
    reads.fail = true;
    render((await AppealStepsNow()) as ReactElement);
    expect(screen.getByRole("link", { name: "RFI, audit and appeal page" })).toHaveAttribute("href", "/perm-rfi-audit#step-by-step");
  });

  it("points to the page when no appeal step has enough moves to show", async () => {
    reads.stats = { ...STATS, exits: [{ from: "RFI ISSUED", to: "ANALYST REVIEW", n: 1851 }, { from: "DENIED", to: "CERTIFIED", n: 3 }] };
    render((await AppealStepsNow()) as ReactElement);
    expect(screen.getByRole("link", { name: "RFI, audit and appeal page" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "After a denial" })).toBeNull();
  });
});
