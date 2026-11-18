import { describe, expect, it } from "vitest";

import {
  H4_DATES,
  METRIC_MIN_N,
  OFFICE_METRIC_IDS,
  RECENT_MIN,
  TIMELINE_TEXT_FIELDS,
  computeMetrics,
  h4FiledTogether,
  recentApprovals,
  toBoardRow,
  toOfficeRow,
  validateTimeline,
  type TimelineRecord,
} from "./communityTimeline";

/**
 * A spouse's H-4 papers while the green card case runs: the extension of stay (I-539) and the H-4 work permit
 * (I-765, category (c)(26)), each filed and approved. Filed on the same day counts as filed together, which USCIS
 * posts as its own route, so the work permit's medians are split by it.
 */

const TODAY = "2026-11-18";
const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ public: true, updatedAt: Date.UTC(2026, 10, 1), ...over });
const base = { i140FiledOn: "2026-01-05" };

describe("the H-4 dates", () => {
  it("are text fields the HTTP layer narrows and an edit reads back, in filing order", () => {
    expect(H4_DATES.map((d) => d.id)).toEqual(["h4FiledOn", "h4ApprovedOn", "h4EadFiledOn", "h4EadApprovedOn"]);
    for (const d of H4_DATES) {
      expect(TIMELINE_TEXT_FIELDS).toContain(d.id);
      expect(d.routes).toEqual(["adjustment", "consular"]);
    }
  });

  it("are saved on either route, before PERM or after the I-485, with no order against the other steps", () => {
    const dates = { h4FiledOn: "2025-02-01", h4ApprovedOn: "2025-08-01", h4EadFiledOn: "2025-02-01", h4EadApprovedOn: "2025-07-15" };
    for (const route of ["adjustment", "consular"] as const) {
      const r = validateTimeline({ ...base, route, ...dates }, TODAY);
      expect(r.ok && r.value).toMatchObject(dates);
    }
  });

  it("refuse an approval dated before its filing, naming the approval", () => {
    const one = validateTimeline({ ...base, h4FiledOn: "2026-03-01", h4ApprovedOn: "2026-02-01" }, TODAY);
    expect(one).toMatchObject({ ok: false, code: "h4-order", field: "h4ApprovedOn" });
    const two = validateTimeline({ ...base, h4EadFiledOn: "2026-03-01", h4EadApprovedOn: "2026-02-01" }, TODAY);
    expect(two).toMatchObject({ ok: false, code: "h4-ead-order", field: "h4EadApprovedOn" });
  });

  it("refuse a date in the future or not a date, like every other date", () => {
    expect(validateTimeline({ ...base, h4EadApprovedOn: "2026-12-01" }, TODAY)).toMatchObject({ ok: false, code: "date" });
    expect(validateTimeline({ ...base, h4FiledOn: "last spring" }, TODAY)).toMatchObject({ ok: false, code: "date" });
  });

  it("don't count as the green card step a timeline needs", () => {
    expect(validateTimeline({ h4FiledOn: "2026-01-01" }, TODAY)).toMatchObject({ ok: false, code: "no-dates" });
  });

  it("count as filed together only when the work permit went in on the I-539's own day", () => {
    expect(h4FiledTogether({ h4FiledOn: "2026-01-01", h4EadFiledOn: "2026-01-01" })).toBe(true);
    expect(h4FiledTogether({ h4FiledOn: "2026-01-01", h4EadFiledOn: "2026-01-02" })).toBe(false);
    expect(h4FiledTogether({ h4EadFiledOn: "2026-01-01" })).toBe(false);
    expect(h4FiledTogether({})).toBe(false);
  });
});

describe("the H-4 medians", () => {
  const together = (i: number) =>
    rec({ ...base, h4FiledOn: "2026-01-01", h4ApprovedOn: "2026-07-01", h4EadFiledOn: "2026-01-01", h4EadApprovedOn: `2026-06-${String(10 + i).padStart(2, "0")}` });
  const alone = (i: number) => rec({ ...base, h4EadFiledOn: "2025-06-01", h4EadApprovedOn: `2026-04-${String(10 + i).padStart(2, "0")}` });
  const metric = (rows: TimelineRecord[], id: string) => computeMetrics(rows).find((m) => m.id === id)!;

  it("split the work permit by route, so a median across both never prints", () => {
    const rows = [...Array.from({ length: METRIC_MIN_N }, (_, i) => together(i)), ...Array.from({ length: METRIC_MIN_N }, (_, i) => alone(i))];
    const t = metric(rows, "h4-ead-together");
    const a = metric(rows, "h4-ead-alone");
    expect(t.n).toBe(METRIC_MIN_N);
    expect(a.n).toBe(METRIC_MIN_N);
    // Filed Jan 1, approved Jun 10 to Jun 14: the middle is Jun 12, 162 days.
    expect(t.median).toBe(162);
    // Filed Jun 1 2025, approved Apr 10 to Apr 14 2026: the middle is Apr 12, 315 days.
    expect(a.median).toBe(315);
    expect(metric(rows, "h4-i539")).toMatchObject({ n: METRIC_MIN_N, median: 181 });
  });

  it("print nothing below the floor, and count people", () => {
    const rows = Array.from({ length: METRIC_MIN_N - 1 }, (_, i) => together(i));
    expect(metric(rows, "h4-ead-together")).toMatchObject({ n: METRIC_MIN_N - 1, median: null, p25: null, p75: null });
  });

  it("aren't office stages", () => {
    for (const id of ["h4-i539", "h4-ead-together", "h4-ead-alone"]) expect(OFFICE_METRIC_IDS).not.toContain(id);
  });
});

describe("the H-4 work permit on the board and in the week's count", () => {
  it("gives each row its H-4 durations, never a date", () => {
    const r = rec({ ...base, permFiledOn: "2025-01-10", h4FiledOn: "2026-01-01", h4ApprovedOn: "2026-07-01", h4EadFiledOn: "2026-01-01", h4EadApprovedOn: "2026-06-12" });
    expect(toBoardRow(r).h4).toEqual({ extensionDays: 181, workPermitDays: 162, together: true });
    expect(toOfficeRow(rec({ ...base, i485FiledOn: "2026-02-01", h4EadFiledOn: "2026-03-01", h4EadApprovedOn: "2026-09-01" })).h4).toEqual({
      extensionDays: null,
      workPermitDays: 184,
      together: false,
    });
    expect(toBoardRow(rec({ ...base, h4FiledOn: "2026-01-01" })).h4).toBeNull();
    expect(JSON.stringify(toBoardRow(r))).not.toContain("2026-06-12");
  });

  it("counts H-4 work permit approvals in the week, at the floor", () => {
    const rows = Array.from({ length: RECENT_MIN }, (_, i) => ({ ...rec({ ...base, h4EadApprovedOn: "2026-11-16" }), ipHash: `p${i}` }));
    const step = recentApprovals(rows, TODAY)!.steps.find((s) => s.id === "h4EadApprovedOn");
    expect(step).toEqual({ id: "h4EadApprovedOn", label: "H-4 work permits", count: RECENT_MIN });
  });
});
