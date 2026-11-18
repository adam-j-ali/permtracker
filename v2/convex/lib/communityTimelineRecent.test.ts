import { describe, expect, it } from "vitest";

import {
  APPLICANTS,
  RECENT_DAYS,
  RECENT_MIN,
  RECENT_STEPS,
  TIMELINE_TEXT_FIELDS,
  recentApprovals,
  toBoardRow,
  toOfficeRow,
  validateTimeline,
  type TimelineRecord,
} from "./communityTimeline";

/**
 * Whose case a timeline follows (the main applicant or a spouse or child), and the approvals people reported in
 * the last week, each counted only once enough timelines report one.
 */

const rec = (over: Partial<TimelineRecord>): TimelineRecord => ({ public: true, updatedAt: Date.UTC(2026, 10, 1), ...over });
const TODAY = "2026-11-18";

describe("whose case a timeline follows", () => {
  it("takes the main applicant or a dependent, and nothing else", () => {
    expect(APPLICANTS.map((a) => a.id)).toEqual(["principal", "dependent"]);
    expect(TIMELINE_TEXT_FIELDS).toContain("applicant");
    const ok = validateTimeline({ applicant: "dependent", i485FiledOn: "2026-04-14" }, TODAY);
    expect(ok.ok && ok.value.applicant).toBe("dependent");
    const none = validateTimeline({ i485FiledOn: "2026-04-14" }, TODAY);
    expect(none.ok && none.value.applicant).toBeUndefined();
    const bad = validateTimeline({ applicant: "spouse", i485FiledOn: "2026-04-14" }, TODAY);
    expect(bad).toMatchObject({ ok: false, code: "choice", field: "applicant" });
  });

  it("travels to the board's row and the office's row, null when not given", () => {
    expect(toBoardRow(rec({ applicant: "dependent" })).applicant).toBe("dependent");
    expect(toBoardRow(rec({})).applicant).toBeNull();
    expect(toOfficeRow(rec({ applicant: "principal", i485FiledOn: "2026-01-02" })).applicant).toBe("principal");
  });
});

describe("approvals reported in the last week", () => {
  const ead = (on: string) => rec({ eadOn: on });

  it("covers the last RECENT_DAYS days, today included, and names the window", () => {
    const r = recentApprovals([], TODAY)!;
    expect(RECENT_DAYS).toBe(7);
    expect(r).toMatchObject({ from: "2026-11-12", through: TODAY });
    expect(r.steps.map((s) => s.id)).toEqual(RECENT_STEPS.map((s) => s.id));
  });

  it("prints a count once RECENT_MIN timelines report it, and only days inside the window", () => {
    const inside = ["2026-11-12", "2026-11-14", "2026-11-16", "2026-11-17", "2026-11-18"].slice(0, RECENT_MIN);
    const rows = [...inside.map(ead), ead("2026-11-11"), rec({ apOn: "2026-11-17" })];
    const r = recentApprovals(rows, TODAY)!;
    const by = Object.fromEntries(r.steps.map((s) => [s.id, s.count]));
    expect(RECENT_MIN).toBe(5);
    expect(by.eadOn).toBe(RECENT_MIN);
    // One travel document is below the floor: it reads as "fewer than 3", never as one person's date.
    expect(by.apOn).toBeNull();
    expect(by.greenCardOn).toBeNull();
  });

  it("a count just under the floor stays hidden", () => {
    const r = recentApprovals(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"].map(ead), TODAY)!;
    expect(r.steps.find((s) => s.id === "eadOn")?.count).toBeNull();
  });

  it("counts one household once: timelines from one connection share their days", () => {
    const family = Array.from({ length: RECENT_MIN }, () => ({ ...ead("2026-11-17"), ipHash: "same" }));
    expect(recentApprovals(family, TODAY)!.steps.find((s) => s.id === "eadOn")?.count).toBeNull();
  });

  it("gives nothing for a day that isn't one", () => {
    expect(recentApprovals([], "11/18/2026")).toBeNull();
    expect(recentApprovals([], "2026-13-01")).toBeNull();
  });
});
