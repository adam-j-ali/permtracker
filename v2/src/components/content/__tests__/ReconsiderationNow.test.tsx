import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The appeal guide's timing block: DOL's last posted months from the readings kept, and our own record only from
 * a document built by the rule that leaves the catch-up out. A link to the appeal page when neither can be read.
 */
const reads = vi.hoisted(() => ({ history: null as unknown, stats: null as unknown, fail: false }));
vi.mock("@/lib/db/processingTimes", () => ({
  getProcessingTimesHistory: vi.fn(async () => {
    if (reads.fail) throw new Error("read failed");
    return reads.history;
  }),
}));
vi.mock("@/lib/db/stageStats", () => ({
  getStageStats: vi.fn(async () => {
    if (reads.fail) throw new Error("read failed");
    return reads.stats;
  }),
}));
vi.mock("@/lib/softRead", () => ({ softFail: (_label: string, fallback: unknown) => () => fallback }));

const { ReconsiderationNow } = await import("../ReconsiderationNow");

const reading = (permAsOf: string, month: string | null) => ({
  permAsOf,
  permQueues: month ? [{ queue: "Reconsideration Request to the CO", priorityDate: month, raw: "" }] : [],
});
const HISTORY = [reading("2026-10-31", null), reading("2026-10-21", "2026-05"), reading("2026-10-05", "2026-05"), reading("2026-09-22", "2026-04"), reading("2026-08-20", "2026-04")];
const STATS = {
  asOf: "2026-11-09",
  source: "DOL",
  since: "2026-08-30",
  stages: [{ status: "RECONSIDERATION APPEALS", pending: 2559, meanAgeDays: 520 }],
  exits: [
    { from: "RECONSIDERATION APPEALS", to: "NORD ISSUED", n: 335 },
    { from: "RECONSIDERATION APPEALS", to: "CERTIFIED", n: 303 },
    { from: "RECONSIDERATION APPEALS", to: "DENIED", n: 18 },
    { from: "RECONSIDERATION APPEALS", to: "ANALYST REVIEW", n: 17 },
    { from: "RECONSIDERATION APPEALS", to: "APPLICATION ON HOLD", n: 11 },
    { from: "RECONSIDERATION APPEALS", to: "REQUEST FOR REVIEW", n: 4 },
  ],
  durations: [{ stage: "RECONSIDERATION APPEALS", entered: 745, observedDays: 71, curve: [{ days: 30, eligible: 520, left: 9 }, { days: 45, eligible: 430, left: 11 }, { days: 60, eligible: 40, left: 11 }] }],
};

beforeEach(() => {
  reads.fail = false;
  reads.history = HISTORY;
  reads.stats = STATS;
});

describe("ReconsiderationNow", () => {
  it("gives DOL's last posting, each month it posted, and the day the line left its page", async () => {
    render((await ReconsiderationNow()) as ReactElement);
    expect(screen.getByText("About 5 months behind")).toBeInTheDocument();
    expect(screen.getByText(/On October 21, 2026, DOL's processing-times page said it was working on reconsideration requests from May 2026\./)).toBeInTheDocument();
    const months = screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/\s+/g, " ").trim());
    expect(months).toEqual(["April 2026: posted from August 20, 2026 to September 22, 2026", "May 2026: posted from October 5, 2026 to October 21, 2026"]);
    expect(screen.getByText(/has left this line out since its October 31, 2026 update/)).toBeInTheDocument();
  });

  it("gives our own record from the furthest day enough requests were followed to, and how the decided ones ended", async () => {
    const { container } = render((await ReconsiderationNow()) as ReactElement);
    const text = container.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("Our own record, since August 30, 2026");
    // Day 45, the furthest with 60 or more followed: day 60 has 40.
    expect(text).toContain("Of the 430 requests our daily check watched arrive and has followed for at least 45 days, 11 (2.6%) had an answer by then.");
    // Granted: certified, back in review or on hold. Refused: a NORD or a denial. A request for review is neither.
    // The site's share rule: whole percents from 10% up, one decimal below.
    expect(text).toContain("Of the 684 requests it has seen decided, 331 (48%) were granted and 353 were refused with a NORD or a denial.");
  });

  it("holds our own record back from a document built before the catch-up was left out", async () => {
    reads.stats = { ...STATS, since: undefined };
    const { container } = render((await ReconsiderationNow()) as ReactElement);
    expect(screen.getByText("About 5 months behind")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Our own record");
    expect(container.textContent).not.toContain("had an answer by then");
  });

  it("shows our record alone when no reading of DOL's page carried the line", async () => {
    reads.history = [reading("2026-10-31", null)];
    const { container } = render((await ReconsiderationNow()) as ReactElement);
    expect(container.textContent).not.toContain("DOL's last posting");
    expect(container.textContent).toContain("Our own record, since August 30, 2026");
  });

  it("points to the appeal page when nothing can be read", async () => {
    reads.fail = true;
    render((await ReconsiderationNow()) as ReactElement);
    expect(screen.getByRole("link", { name: "RFI, audit and appeal page" })).toHaveAttribute("href", "/perm-rfi-audit#step-by-step");
  });
});
