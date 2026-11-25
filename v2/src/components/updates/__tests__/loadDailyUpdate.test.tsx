import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /perm-updates beside its wage requests. What must hold: the day's page carries the wage determinations for the same
 * DOL day and week, says when the day's count can still rise, and a failed read of them leaves the line off: the page
 * never prints a 0 it didn't count.
 */

vi.mock("@/lib/db/changes", () => ({
  getChangeCalendar: vi.fn(async () => ({
    days: [{ date: "2026-11-20", total: 900, byProgram: { perm: 900, pwd: 0, lca: 0, seasonal: 0 } }],
    observedSince: "2026-08-28",
    programSince: { perm: "2026-08-28", pwd: "2026-08-28", lca: null, seasonal: null },
    truncated: false,
  })),
  getChangeDay: vi.fn(async (date: string) => ({ date, changes: [], total: 0, byProgram: { perm: 0, pwd: 0, lca: 0, seasonal: 0 }, transitions: [], expiriesExcluded: 0, bulkExcluded: 0 })),
}));
vi.mock("@/lib/db/activity", () => ({ getActivitySeries: vi.fn(async () => []) }));
vi.mock("@/lib/db/sweepCoverage", () => ({ getCheckTimes: vi.fn(async () => null) }));
vi.mock("@/lib/db/wageDeterminations", () => ({ getWageDeterminations: vi.fn() }));

import { DailyUpdateView } from "@/components/updates/DailyUpdateView";
import { loadDailyUpdate } from "@/components/updates/loadDailyUpdate";
import { getWageDeterminations } from "@/lib/db/wageDeterminations";
import { forgetSoftReads } from "@/lib/softRead";

/** An Eastern wall-clock time in November 2026 (UTC-5) as epoch ms. */
const est = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00-05:00`);
const SUNDAY = { day: "2026-11-22", onDay: 185, weekFrom: "2026-11-16", week: 4196 };

beforeEach(() => {
  forgetSoftReads();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function page(asked: string) {
  const load = await loadDailyUpdate(asked);
  if (load?.kind !== "day") throw new Error("no day page");
  return { props: load.props, html: renderToStaticMarkup(<DailyUpdateView {...load.props} />).replace(/\s+/g, " ") };
}

describe("/perm-updates and the wage determinations", () => {
  it("says the day's and the week's wage determinations once Monday's 5:40 AM read has landed", async () => {
    // Arrange: Monday Nov 23, 8 AM Eastern, Sunday's page.
    vi.setSystemTime(est("2026-11-23", "08:00"));
    vi.mocked(getWageDeterminations).mockResolvedValue(SUNDAY);

    // Act
    const { props, html } = await page("2026-11-22");

    // Assert
    expect(getWageDeterminations).toHaveBeenCalledWith("2026-11-22");
    expect(props.wageWhole).toBe(true);
    expect(html).toContain("DOL also issued 185 wage determinations on Sunday, and 4,196 in the week from Monday, November 16.");
  });

  it("says a weekend day's count arrives with the next morning's read", async () => {
    // Sunday afternoon: no wage read runs until Monday's 5:40 AM.
    vi.setSystemTime(est("2026-11-22", "16:00"));
    vi.mocked(getWageDeterminations).mockResolvedValue({ ...SUNDAY, onDay: 0, week: 4011 });
    const { props, html } = await page("2026-11-22");
    expect(props.wageWhole).toBe(false);
    expect(html).toContain("Sunday&#x27;s wage determinations aren&#x27;t in yet");
    expect(html).toContain("so Sunday&#x27;s arrive with Monday&#x27;s read.");
  });

  it("leaves the line off when the read fails, and the page still renders", async () => {
    vi.setSystemTime(est("2026-11-23", "08:00"));
    vi.mocked(getWageDeterminations).mockRejectedValue(new Error("SQLITE_BUSY"));
    const { props, html } = await page("2026-11-22");
    expect(props.wageCount).toBeNull();
    expect(html).toContain("PERM decisions, November 22, 2026");
    expect(html).not.toContain("wage determinations on Sunday");
    expect(html).not.toMatch(/issued no wage determinations/);
  });
});

describe("/perm-updates/[day] with a day that isn't one", () => {
  it("answers not found for an impossible or unreal day, never a thrown error", async () => {
    vi.setSystemTime(est("2026-11-25", "12:38"));
    for (const asked of ["2026-11-54", "2026-02-30", "2026-13-01", "2026-1-5", "abc", "2026-11-26"]) {
      await expect(loadDailyUpdate(asked), asked).resolves.toBeNull();
    }
  });
});
