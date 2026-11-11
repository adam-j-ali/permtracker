import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HISTORY_FROM, statusHistory, type StatusEvent, seenInStatusSince } from "../statusHistory";

// An instant at a given Eastern hour (EDT, UTC-4, in the autumn days these use).
const at = (day: string, hourEt: number) => Date.parse(`${day}T${String(hourEt + 4).padStart(2, "0")}:00:00Z`);
const ev = (day: string, hour: number, from: string, to: string): StatusEvent => ({ at: at(day, hour), from, to });

describe("a case's status history", () => {
  it("lists the status it held when our record began, then each change on DOL's day, with how long each held", () => {
    const steps = statusHistory([
      ev("2026-09-30", 10, "ANALYST REVIEW", "RFI ISSUED"),
      ev("2026-11-03", 15, "RFI ISSUED", "ANALYST REVIEW"),
      ev("2026-11-10", 10, "ANALYST REVIEW", "CERTIFIED"),
    ]);
    expect(steps).toEqual([
      { status: "ANALYST REVIEW", since: null, days: null },
      { status: "RFI ISSUED", since: "2026-09-30", days: 34 },
      { status: "ANALYST REVIEW", since: "2026-11-03", days: 7 },
      { status: "CERTIFIED", since: "2026-11-10", days: null },
    ]);
  });

  it("a change seen during the record's catch-up (to Aug 29) says where the case stood, not when it moved", () => {
    const steps = statusHistory([
      ev("2026-08-28", 10, "DENIED", "RECONSIDERATION APPEALS"),
      ev("2026-09-23", 10, "RECONSIDERATION APPEALS", "NORD ISSUED"),
    ]);
    expect(steps).toEqual([
      { status: "RECONSIDERATION APPEALS", since: null, days: null },
      { status: "NORD ISSUED", since: "2026-09-23", days: null },
    ]);
  });

  it("dates a change seen before 7 AM Eastern to the day before, DOL's working day", () => {
    const steps = statusHistory([ev("2026-10-17", 4, "ANALYST REVIEW", "CERTIFIED")]);
    expect(steps[1]).toMatchObject({ status: "CERTIFIED", since: "2026-10-16" });
  });

  it("a case filed after the record began starts on its filing day, with its first status's length", () => {
    const steps = statusHistory([ev("2026-10-20", 10, "ANALYST REVIEW", "APPLICATION ON HOLD")], "2026-09-15");
    expect(steps[0]).toEqual({ status: "ANALYST REVIEW", since: "2026-09-15", days: 35, filed: true });
    // Filed during the catch-up: its start isn't dated either.
    expect(statusHistory([ev("2026-10-20", 10, "ANALYST REVIEW", "DENIED")], "2026-08-27")[0]!.since).toBeNull();
    // Filed before the record began: the start is unknown, so no length.
    expect(statusHistory([ev("2026-10-20", 10, "ANALYST REVIEW", "DENIED")], "2025-03-01")[0]).toEqual({
      status: "ANALYST REVIEW",
      since: null,
      days: null,
    });
  });

  it("keeps the later of two changes on one DOL day, and drops a change to the same status", () => {
    const steps = statusHistory([
      ev("2026-10-01", 10, "ANALYST REVIEW", "RFI ISSUED"),
      ev("2026-10-01", 15, "RFI ISSUED", "ANALYST REVIEW"),
      ev("2026-10-05", 10, "ANALYST REVIEW", "analyst review "),
    ]);
    expect(steps).toEqual([]);
  });

  it("shows nothing when nothing changed on our record", () => {
    expect(statusHistory([])).toEqual([]);
  });
});

describe("the catch-up's last day, one rule in both languages", () => {
  // The sweep's script leaves the catch-up's changes out of the stage statistics, the RFI path and the RFI clock by
  // the same day this module leaves them undated. A drift wouldn't error: the page's history and its counts would
  // quietly start disagreeing about which changes are real moves.
  const script = readFileSync(path.join(process.cwd(), "scripts", "ingest_case_status_direct.py"), "utf8");

  it("is the same day in the sweep's script", () => {
    expect(script.match(/^HISTORY_FROM = "(\d{4}-\d{2}-\d{2})"$/m)?.[1]).toBe(HISTORY_FROM);
  });

  it("starts the watched record on the next Eastern day, as a date and as its first instant", () => {
    const next = new Date(Date.parse(`${HISTORY_FROM}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(script.match(/^WATCHED_FROM = "(\d{4}-\d{2}-\d{2})"$/m)?.[1]).toBe(next);
    // Midnight Eastern on that day, in daylight time: 04:00 UTC.
    const [, y, m, d, h, min] = script.match(/^WATCHED_FROM_MS = int\(datetime\.datetime\((\d+), (\d+), (\d+), (\d+), (\d+), tzinfo=datetime\.timezone\.utc\)/m) ?? [];
    expect(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min))).toISOString()).toBe(`${next}T04:00:00.000Z`);
    // That instant is the new Eastern day, and the millisecond before it is still the catch-up's last.
    const easternDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    expect(easternDay(Date.parse(`${next}T04:00:00Z`))).toBe(next);
    expect(easternDay(Date.parse(`${next}T04:00:00Z`) - 1)).toBe(HISTORY_FROM);
  });
});

describe("the day our checks first saw a case in its status", () => {
  // Noon Eastern on a November day is 17:00 UTC.
  const at = (day: string, hourUtc = 17) => Date.parse(`${day}T${String(hourUtc).padStart(2, "0")}:00:00Z`);

  it("is the DOL day of the newest change into that status", () => {
    const events = [
      { at: at("2026-10-01"), from: "IN PROCESS", to: "ANALYST REVIEW" },
      { at: at("2026-11-06"), from: "ANALYST REVIEW", to: "CERTIFIED" },
    ];

    expect(seenInStatusSince(events, "CERTIFIED")).toBe("2026-11-06");
    expect(seenInStatusSince(events, "certified")).toBe("2026-11-06");
  });

  it("dates a change our 4 AM check saw to the day before, as every count does", () => {
    // 4:10 AM Eastern on Nov 7 is 09:10 UTC: the evening work of Nov 6.
    const events = [{ at: Date.parse("2026-11-07T09:10:00Z"), from: "ANALYST REVIEW", to: "CERTIFIED" }];

    expect(seenInStatusSince(events, "CERTIFIED")).toBe("2026-11-06");
  });

  it("can't date a status the record only caught up to", () => {
    const events = [{ at: at(HISTORY_FROM), from: "ANALYST REVIEW", to: "CERTIFIED" }];

    expect(seenInStatusSince(events, "CERTIFIED")).toBeNull();
  });

  it("is null with no change into that status on record", () => {
    expect(seenInStatusSince([], "CERTIFIED")).toBeNull();
    expect(seenInStatusSince([{ at: at("2026-11-06"), from: "IN PROCESS", to: "ANALYST REVIEW" }], "CERTIFIED")).toBeNull();
  });
});

