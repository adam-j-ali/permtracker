import { describe, expect, it } from "vitest";

import { calculateCapGap, calculateOptUnemployment, calculatePendingExtension, fiscalYearOfDay, optUnemploymentFromJobs } from "./f1Dates";

/** Each expectation is the regulation's own words worked on dates chosen so the answer can be checked by hand. */

describe("cap-gap, 8 CFR 214.2(f)(5)(vii)(A)", () => {
  it("names the fiscal year by the September it ends in", () => {
    expect(fiscalYearOfDay("2026-10-01")).toBe(2027);
    expect(fiscalYearOfDay("2026-09-30")).toBe(2026);
  });

  it("runs until April 1 of the fiscal year while the petition is pending", () => {
    const r = calculateCapGap({ requestedStart: "2026-10-01", filed: "2026-04-01", optEnds: "2026-06-15" });
    expect(r).toMatchObject({ fiscalYear: 2027, aprilFirst: "2027-04-01", until: "2027-04-01", byApproval: false, optValidAtFiling: true, gap: true });
  });

  it("ends at the approved start date when that comes first", () => {
    const r = calculateCapGap({ requestedStart: "2026-10-01", approvedStart: "2026-10-01", filed: "2026-04-01", optEnds: "2026-06-15" });
    expect(r.until).toBe("2026-10-01");
    expect(r.byApproval).toBe(true);
  });

  it("says when the OPT had already ended on the filing day", () => {
    const r = calculateCapGap({ requestedStart: "2026-10-01", filed: "2026-05-02", optEnds: "2026-05-01" });
    expect(r.optValidAtFiling).toBe(false);
    expect(calculateCapGap({ requestedStart: "2026-10-01", filed: "2026-05-01", optEnds: "2026-05-01" }).optValidAtFiling).toBe(true);
  });

  it("sees no gap when the OPT runs past the start", () => {
    expect(calculateCapGap({ requestedStart: "2026-10-01", filed: "2026-04-01", optEnds: "2026-12-31" }).gap).toBe(false);
  });
});

describe("OPT unemployment, 8 CFR 214.2(f)(10)(ii)(E)", () => {
  it("counts every day of the current stretch, the first and today included", () => {
    const r = calculateOptUnemployment({ stem: false, usedBefore: 10, unemployedSince: "2026-10-01", today: "2026-10-31" });
    expect(r.used).toBe(41);
    expect(r.left).toBe(49);
    // The 90th day: 80 more from October 1, the first of them October 1 itself.
    expect(r.lastDay).toBe("2026-12-19");
    expect(r.over).toBe(false);
  });

  it("allows 150 in all once a STEM extension is granted", () => {
    const r = calculateOptUnemployment({ stem: true, usedBefore: 90, unemployedSince: "2026-10-01", today: "2026-10-01" });
    expect(r).toMatchObject({ limit: 150, used: 91, left: 59, lastDay: "2026-11-29" });
  });

  it("says over the limit past it", () => {
    expect(calculateOptUnemployment({ stem: false, usedBefore: 89, unemployedSince: "2026-10-30", today: "2026-10-31" }).over).toBe(true);
    expect(calculateOptUnemployment({ stem: false, usedBefore: 88, unemployedSince: "2026-10-30", today: "2026-10-31" }).over).toBe(false);
  });

  it("names no last day once the earlier days used up the limit, never a day before the stretch began", () => {
    expect(calculateOptUnemployment({ stem: false, usedBefore: 90, unemployedSince: "2026-10-01", today: "2026-10-05" })).toMatchObject({ lastDay: null, over: true });
    expect(calculateOptUnemployment({ stem: false, usedBefore: 120, unemployedSince: "2026-10-01", today: "2026-10-05" }).lastDay).toBeNull();
    // One day left: the stretch's own first day is the last one inside the limit.
    expect(calculateOptUnemployment({ stem: false, usedBefore: 89, unemployedSince: "2026-10-01", today: "2026-10-01" }).lastDay).toBe("2026-10-01");
  });

  it("counts only the days already used when working now", () => {
    expect(calculateOptUnemployment({ stem: false, usedBefore: 30, today: "2026-10-31" })).toMatchObject({ used: 30, left: 60, lastDay: null });
  });
});

describe("the 240-day rule, 8 CFR 274a.12(b)(20)", () => {
  it("counts 240 days beginning on the I-94's end date, and says the later count too", () => {
    const r = calculatePendingExtension({ i94Ends: "2026-01-01", extensionFiled: "2025-12-15" });
    expect(r.lastDay).toBe("2026-08-28");
    expect(r.lastDayCountingFromNext).toBe("2026-08-29");
    expect(r.filedInTime).toBe(true);
  });

  it("says when the extension was filed after the stay ended", () => {
    expect(calculatePendingExtension({ i94Ends: "2026-01-01", extensionFiled: "2026-01-02" }).filedInTime).toBe(false);
  });

  it("refuses a date that isn't one", () => {
    expect(() => calculatePendingExtension({ i94Ends: "2026-02-30", extensionFiled: "2026-01-01" })).toThrow(/i94Ends/);
  });
});

/**
 * Counted the way SEVIS counts (SEVIS Help Hub, "Unemployment Counter", last updated July 27 2026): look back to the
 * OPT start date and count each day without an employer, weekends included (SEVP Policy Guidance 1004-03, 7.1.6).
 */
describe("OPT unemployment from job dates", () => {
  it("counts every day from the OPT start to the first job, the start day included", () => {
    // Arrange: OPT from June 1, 2026, the job from July 1: June's 30 days, then work through today.
    const input = { optStart: "2026-06-01", stem: false, jobs: [{ start: "2026-07-01" }], today: "2026-11-25" };

    // Act
    const r = optUnemploymentFromJobs(input);

    // Assert
    expect(r).toMatchObject({ limit: 90, used: 30, left: 60, over: false, workingNow: true, lastDay: null });
  });

  it("counts the gap between two jobs, and the days since the last one ended through today", () => {
    // June 1 to 10 (10 days), July 1 to 14 (14 days), and November 21 to 25 (5 days).
    const r = optUnemploymentFromJobs({
      optStart: "2026-06-01",
      stem: false,
      jobs: [
        { start: "2026-06-11", end: "2026-06-30" },
        { start: "2026-07-15", end: "2026-11-20" },
      ],
      today: "2026-11-25",
    });
    expect(r.used).toBe(29);
    expect(r.left).toBe(61);
    expect(r.workingNow).toBe(false);
    // Without work from here on, the 90th day: 61 more days, today the 29th.
    expect(r.lastDay).toBe("2027-01-25");
  });

  it("counts a day covered by two overlapping jobs once, and a job before the OPT start not at all", () => {
    const r = optUnemploymentFromJobs({
      optStart: "2026-06-01",
      stem: false,
      jobs: [
        { start: "2026-05-01", end: "2026-06-05" },
        { start: "2026-06-03", end: "2026-06-20" },
      ],
      today: "2026-06-30",
    });
    // June 21 to 30.
    expect(r.used).toBe(10);
  });

  it("counts nothing before the OPT starts, and a job that starts later doesn't count yet", () => {
    expect(optUnemploymentFromJobs({ optStart: "2026-12-01", stem: false, jobs: [], today: "2026-11-25" })).toMatchObject({ used: 0, left: 90, countedThrough: null });
    expect(optUnemploymentFromJobs({ optStart: "2026-11-01", stem: false, jobs: [{ start: "2026-12-01" }], today: "2026-11-25" }).used).toBe(25);
  });

  it("stops at the last day of OPT", () => {
    const r = optUnemploymentFromJobs({ optStart: "2026-06-01", optEnd: "2026-06-15", stem: false, jobs: [], today: "2026-11-25" });
    expect(r.used).toBe(15);
    expect(r.countedThrough).toBe("2026-06-15");
    // The OPT has ended: no day still to come.
    expect(r.lastDay).toBeNull();
  });

  it("names the day the count passed the limit", () => {
    const r = optUnemploymentFromJobs({ optStart: "2026-06-01", stem: false, jobs: [], today: "2026-09-30" });
    // June 1 to September 30 is 122 days; the 91st is August 30.
    expect(r).toMatchObject({ used: 122, left: 0, over: true, firstDayOver: "2026-08-30", lastDay: null });
  });

  it("allows 150 days in all with a STEM extension, the first OPT period's days included", () => {
    const r = optUnemploymentFromJobs({
      optStart: "2025-06-01",
      stem: true,
      jobs: [{ start: "2025-08-30", end: "2026-05-31" }],
      today: "2026-06-30",
    });
    // June 1 to August 29, 2025 (90 days), then June 1 to 30, 2026 (30 days).
    expect(r).toMatchObject({ limit: 150, used: 120, left: 30, over: false, lastDay: "2026-07-30" });
  });

  it("stops the last day at the OPT's end when the OPT ends first", () => {
    const r = optUnemploymentFromJobs({ optStart: "2026-06-01", optEnd: "2026-12-01", stem: false, jobs: [], today: "2026-06-30" });
    expect(r.left).toBe(60);
    // The 90th day would be August 29, inside the OPT.
    expect(r.lastDay).toBe("2026-08-29");
    expect(optUnemploymentFromJobs({ optStart: "2026-06-01", optEnd: "2026-07-15", stem: false, jobs: [], today: "2026-06-30" }).lastDay).toBeNull();
  });

  it("refuses a job that ends before it starts, and a date that isn't one", () => {
    expect(() => optUnemploymentFromJobs({ optStart: "2026-06-01", stem: false, jobs: [{ start: "2026-07-02", end: "2026-07-01" }], today: "2026-11-25" })).toThrow(/job 1/);
    expect(() => optUnemploymentFromJobs({ optStart: "2026-06-31", stem: false, jobs: [], today: "2026-11-25" })).toThrow(/optStart/);
  });
});
