import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { measurePace } from "@/lib/perm";
import type { MonthQueue } from "@/lib/queueAhead";

import { PermTimelineEstimator } from "../PermTimelineEstimator";

/**
 * The estimator's way in for someone with no case number: the employer's name beside the date
 * finds the case itself, and a nearby day picked there becomes the date the estimate is for.
 */

vi.mock("@/lib/funnelEvents", async () => ({
  ...(await vi.importActual<typeof import("@/lib/funnelEvents")>("@/lib/funnelEvents")),
  trackFinder: vi.fn(),
}));

const month = (filingMonth: string, total: number, decided: number): MonthQueue => ({
  filingMonth, total, pending: total - decided, decided, decidedPct: total > 0 ? (decided / total) * 100 : null,
});
const MONTHS: MonthQueue[] = [month("2025-11", 15_000, 7_500), month("2025-12", 15_000, 500), month("2026-01", 12_000, 200)];
const PACE = measurePace(
  Array.from({ length: 28 }, (_, i) => {
    const dayOfWeek = (i + 1) % 7;
    return { dayOfWeek, n: dayOfWeek === 0 || dayOfWeek === 6 ? 210 : 790 };
  }),
)!;

function renderTool() {
  return render(
    <PermTimelineEstimator
      today="2026-09-13"
      frontier={{ analystQueueMonth: "2025-11", officialAvgDays: 336, asOf: "2026-08-31" }}
      cohorts={[]}
      frontierAdvance={{ rate: 1.0, slowest: 0.8, fastest: 2.0 }}
      disclosure={null}
      months={MONTHS}
      decisionPace={PACE}
      sweepAgeDays={0}
    />,
  );
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const filing = (caseNumber: string, employer: string) => ({ caseNumber, status: "ANALYST REVIEW", employer, employerSlug: "acme-robotics", jobTitle: "Controls Engineer", final: false });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the estimator's finder", () => {
  it("waits for the date, then lists the employer's PERM cases filed that day", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      return json({ cases: [filing("G-100-25349-000123", "Acme Robotics, Inc."), filing("G-100-25349-000777", "Other Co")], capped: false });
    }));
    renderTool();
    fireEvent.change(screen.getByRole("textbox", { name: /employer/i }), { target: { value: "acme" } });
    expect(screen.getByText(/Pick the filing date above/)).toBeInTheDocument();
    expect(asked).toEqual([]);

    fireEvent.change(screen.getByLabelText(/DOL received your case/i), { target: { value: "2025-12-15" } });
    await screen.findByText(/1 is from an employer matching “acme”\./);
    expect(asked).toEqual(["/api/filed-on?day=2025-12-15&program=perm"]);
    const finder = within(screen.getByRole("region", { name: "Find your case without its number" }));
    const row = within(finder.getByRole("list")).getByRole("listitem");
    expect(within(row).getByRole("link", { name: "G-100-25349-000123" })).toHaveAttribute("href", "/perm-case-status?case=G-100-25349-000123");
    expect(within(row).getByRole("link", { name: "Acme Robotics, Inc." })).toHaveAttribute("href", "/perm-employers/acme-robotics");
    // One kind of filing here, so no chooser.
    expect(screen.queryByRole("group", { name: "Kind of filing" })).toBeNull();
  });

  it("moves the estimate to a nearby day the reader picks", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.startsWith("/api/case-search") ? json({ rows: [{ filedOn: "2025-12-17" }] }) : json({ cases: [filing("G-100-25349-000777", "Other Co")], capped: false }),
    ));
    renderTool();
    const date = screen.getByLabelText(/DOL received your case/i) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2025-12-15" } });
    fireEvent.change(screen.getByRole("textbox", { name: /employer/i }), { target: { value: "acme" } });
    fireEvent.click(await screen.findByRole("button", { name: /December 17, 2025/ }));
    await waitFor(() => expect(date.value).toBe("2025-12-17"));
  });
});
