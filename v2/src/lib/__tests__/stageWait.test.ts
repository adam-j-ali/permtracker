import { describe, expect, it } from "vitest";

import {
  joinExits,
  knownWaitSummary,
  lastArrivals,
  startFor,
  waitBuckets,
  weeklyExits,
  type StageExitRaw,
} from "../stageWait";

// 2026-11-10 15:00 UTC is 10 AM Eastern, inside DOL's Nov 10 day.
const NOV10 = Date.UTC(2026, 10, 10, 15);
const DAY = 86_400_000;
// 2026-08-28 15:00 UTC: the record's catch-up, which says where a case stood, never when it moved.
const CATCH_UP = Date.UTC(2026, 7, 28, 15);

describe("startFor", () => {
  it("dates a case from the day our check saw it arrive, after the record's catch-up", () => {
    expect(startFor(NOV10, null, true)).toEqual({ on: "2026-11-10", source: "seen" });
  });

  it("never dates a case from a catch-up sighting", () => {
    expect(startFor(CATCH_UP, null, false)).toEqual({ on: null, source: "unknown" });
  });

  it("falls back to DOL's denial date on an appeal stage only", () => {
    expect(startFor(CATCH_UP, "2026-06-12", true)).toEqual({ on: "2026-06-12", source: "denied" });
    expect(startFor(null, "2026-06-12", false)).toEqual({ on: null, source: "unknown" });
  });

  it("prefers the seen arrival over the denial date", () => {
    expect(startFor(NOV10, "2026-06-12", true)).toEqual({ on: "2026-11-10", source: "seen" });
  });

  it("ignores a malformed denial date", () => {
    expect(startFor(null, "June 2026", true)).toEqual({ on: null, source: "unknown" });
  });
});

describe("lastArrivals", () => {
  it("keeps each case's latest arrival", () => {
    const m = lastArrivals([
      { caseNumber: "G-1", at: NOV10 - 5 * DAY },
      { caseNumber: "G-1", at: NOV10 },
      { caseNumber: "G-2", at: CATCH_UP },
    ]);
    expect(m.get("G-1")).toBe(NOV10);
    expect(m.get("G-2")).toBe(CATCH_UP);
  });
});

describe("waitBuckets", () => {
  const today = "2026-11-17";
  it("counts each known start into its band and the rest as unknown", () => {
    const r = waitBuckets(
      [
        { on: "2026-11-10", source: "seen" }, // 7 days
        { on: "2026-09-01", source: "seen" }, // 77 days
        { on: "2026-06-12", source: "denied" }, // 158 days
        { on: "2025-09-22", source: "denied" }, // 421 days
        { on: null, source: "unknown" },
      ],
      today,
    );
    expect(r.known).toBe(4);
    expect(r.unknown).toBe(1);
    const byKey = Object.fromEntries(r.buckets.map((b) => [b.key, b]));
    expect(byKey["lt30"]?.seen).toBe(1);
    expect(byKey["60-89"]?.seen).toBe(1);
    expect(byKey["90-179"]?.denied).toBe(1);
    expect(byKey["365+"]?.denied).toBe(1);
    expect(r.buckets.reduce((n, b) => n + b.seen + b.denied, 0)).toBe(4);
  });

  it("puts a day exactly on a band's edge in the band it starts", () => {
    const r = waitBuckets([{ on: "2026-10-18", source: "seen" }], today); // 30 days
    expect(r.buckets.find((b) => b.key === "30-59")?.seen).toBe(1);
  });
});

describe("knownWaitSummary", () => {
  it("gives the median and the longest wait among known starts", () => {
    const s = knownWaitSummary(
      [
        { on: "2026-11-16", source: "seen" }, // 1
        { on: "2026-11-07", source: "seen" }, // 10
        { on: "2026-10-18", source: "seen" }, // 30
        { on: null, source: "unknown" },
      ],
      "2026-11-17",
    );
    expect(s).toEqual({ known: 3, unknown: 1, median: 10, longest: 30 });
  });

  it("says nothing typical with no known start", () => {
    expect(knownWaitSummary([{ on: null, source: "unknown" }], "2026-11-17")).toEqual({
      known: 0,
      unknown: 1,
      median: null,
      longest: null,
    });
  });
});

describe("joinExits", () => {
  const base: Omit<StageExitRaw, "caseNumber" | "at" | "to"> = {
    filingDate: "2025-03-04",
    employer: "Acme",
    employerSlug: "acme",
    jobTitle: "Engineer",
    nowStatus: "CERTIFIED",
    deniedOn: null,
  };

  it("times a stay from the arrival seen before the exit, and keeps unknown starts", () => {
    const rows = joinExits(
      [
        { ...base, caseNumber: "G-1", at: NOV10, to: "CERTIFIED" },
        { ...base, caseNumber: "G-2", at: NOV10, to: "NORD ISSUED" },
      ],
      [
        { caseNumber: "G-1", at: NOV10 - 20 * DAY },
        { caseNumber: "G-1", at: NOV10 + DAY }, // a later return, not this stay's start
        { caseNumber: "G-2", at: CATCH_UP },
      ],
      false,
    );
    expect(rows[0]).toMatchObject({ caseNumber: "G-1", leftOn: "2026-11-10", startOn: "2026-10-21", startSource: "seen", days: 20 });
    expect(rows[1]).toMatchObject({ caseNumber: "G-2", startOn: null, startSource: "unknown", days: null });
  });

  it("drops exits seen during the record's catch-up", () => {
    const rows = joinExits([{ ...base, caseNumber: "G-3", at: CATCH_UP, to: "CERTIFIED" }], [], false);
    expect(rows).toEqual([]);
  });

  it("keeps the newest exit first", () => {
    const rows = joinExits(
      [
        { ...base, caseNumber: "G-1", at: NOV10 - DAY, to: "CERTIFIED" },
        { ...base, caseNumber: "G-2", at: NOV10, to: "DENIED" },
      ],
      [],
      false,
    );
    expect(rows.map((r) => r.caseNumber)).toEqual(["G-2", "G-1"]);
  });
});

describe("weeklyExits", () => {
  it("folds exits into Monday-start weeks by tone, oldest week first, ending this week", () => {
    const weeks = weeklyExits(
      [
        { leftOn: "2026-11-16", to: "CERTIFIED" }, // Mon, this week
        { leftOn: "2026-11-17", to: "NORD ISSUED" }, // Tue, this week
        { leftOn: "2026-11-13", to: "CERTIFIED" }, // Fri, last week
      ],
      "2026-11-17",
      3,
    );
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(weeks[2]).toMatchObject({ total: 2, partial: true });
    expect(weeks[2]?.tones.good).toBe(1);
    expect(weeks[2]?.tones.bad).toBe(1);
    expect(weeks[1]?.tones.good).toBe(1);
    expect(weeks[0]?.total).toBe(0);
  });

  it("leaves weeks before the record began out", () => {
    const weeks = weeklyExits([], "2026-09-08", 6);
    expect(weeks[0]?.weekStart).toBe("2026-08-31");
  });
});
