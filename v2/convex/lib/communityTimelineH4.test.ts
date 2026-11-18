import { describe, expect, it } from "vitest";

import {
  H4_DATES,
  METRIC_MIN_N,
  OFFICE_METRIC_IDS,
  RECENT_MIN,
  TIMELINE_TEXT_FIELDS,
  computeMetrics,
  h4EadRoute,
  recentApprovals,
  toBoardRow,
  toOfficeRow,
  validateTimeline,
  type TimelineRecord,
} from "./communityTimeline";

/**
 * A spouse's H-4 papers while the green card case runs: the extension of stay (I-539) and the H-4 work permit
 * (I-765, category (c)(26)), each filed and approved. USCIS posts the work permit's two routes (with the I-539, on its
 * own) as separate times, so its medians are split by route: the person's answer, or the two filing days when they
 * gave none, and a row that says neither is in neither median.
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

  it("don't count as the green card step a timeline needs, and the refusal says what's missing", () => {
    expect(validateTimeline({ h4FiledOn: "2026-01-01" }, TODAY)).toMatchObject({
      ok: false,
      code: "no-dates",
      message: "The H-4 dates go with a green card timeline: add at least one I-140 or I-485 date too.",
    });
    expect(validateTimeline({}, TODAY)).toMatchObject({ code: "no-dates", message: "Add at least one date after PERM to record a timeline." });
  });

  it("take the work permit's route as asked, and refuse one the form doesn't offer", () => {
    expect(validateTimeline({ ...base, h4EadRoute: "alone" }, TODAY)).toMatchObject({ ok: true, value: { h4EadRoute: "alone" } });
    expect(validateTimeline({ ...base, h4EadRoute: "sideways" }, TODAY)).toMatchObject({ ok: false, code: "choice", field: "h4EadRoute" });
    expect(TIMELINE_TEXT_FIELDS).toContain("h4EadRoute");
  });

  it("read the route from the answer first, then from two filing days, and never from a missing one", () => {
    expect(h4EadRoute({ h4FiledOn: "2026-01-01", h4EadFiledOn: "2026-01-01" })).toBe("with-i539");
    expect(h4EadRoute({ h4FiledOn: "2026-01-01", h4EadFiledOn: "2026-01-02" })).toBe("alone");
    // A blank I-539 date says nothing about the route.
    expect(h4EadRoute({ h4EadFiledOn: "2026-01-01" })).toBeNull();
    expect(h4EadRoute({})).toBeNull();
    // The person's own answer wins over the days.
    expect(h4EadRoute({ h4EadRoute: "with-i539", h4EadFiledOn: "2026-01-01" })).toBe("with-i539");
    expect(h4EadRoute({ h4EadRoute: "alone", h4FiledOn: "2026-01-01", h4EadFiledOn: "2026-01-01" })).toBe("alone");
  });
});

describe("the H-4 medians", () => {
  const together = (i: number) =>
    rec({ ...base, h4FiledOn: "2026-01-01", h4ApprovedOn: "2026-07-01", h4EadFiledOn: "2026-01-01", h4EadApprovedOn: `2026-06-${String(10 + i).padStart(2, "0")}` });
  const alone = (i: number) => rec({ ...base, h4EadRoute: "alone", h4EadFiledOn: "2025-06-01", h4EadApprovedOn: `2026-04-${String(10 + i).padStart(2, "0")}` });
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

  it("leave a work permit that doesn't say its route out of both", () => {
    const silent = (i: number) => rec({ ...base, h4EadFiledOn: "2026-01-01", h4EadApprovedOn: `2026-06-${String(10 + i).padStart(2, "0")}` });
    const rows = Array.from({ length: METRIC_MIN_N }, (_, i) => silent(i));
    expect(metric(rows, "h4-ead-together").n).toBe(0);
    expect(metric(rows, "h4-ead-alone").n).toBe(0);
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
    // A pending work permit filed with the I-539 says nothing of its route: the page prints no work permit line.
    expect(toBoardRow(rec({ ...base, h4FiledOn: "2026-03-01", h4ApprovedOn: "2026-06-01", h4EadFiledOn: "2026-03-01" })).h4).toEqual({
      extensionDays: 92,
      workPermitDays: null,
      together: false,
    });
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
