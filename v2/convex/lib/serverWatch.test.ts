import { describe, expect, it } from "vitest";

import { DISK_PCT, REMIND_MS, STALE_MS, judge, step } from "./serverWatch";

const NOW = 1_791_640_000_000;
const fresh = (diskPct = 34) => ({ computed_at: NOW - 5 * 60 * 1000, json: JSON.stringify({ now: { diskPct } }) });

describe("judge", () => {
  it("a fresh report with room on the disk needs nothing", () => {
    expect(judge(fresh(), NOW)).toBeNull();
  });

  it("a report older than 35 minutes is the server going quiet (Oct 10 2026: it stopped at 5:20 AM)", () => {
    const why = judge({ computed_at: NOW - STALE_MS - 60_000, json: "{}" }, NOW);
    expect(why).toMatch(/36 minutes old/);
  });

  it("libSQL's string integers are read as numbers", () => {
    expect(judge({ computed_at: String(NOW - 60_000), json: "{}" }, NOW)).toBeNull();
  });

  it("a nearly full disk is named even while the report is fresh", () => {
    expect(judge(fresh(DISK_PCT), NOW)).toMatch(/90% full/);
    expect(judge(fresh(DISK_PCT - 1), NOW)).toBeNull();
  });

  it("a database that does not answer is an alarm, never a quiet pass", () => {
    expect(judge(null, NOW, "fetch failed")).toMatch(/did not answer/);
    expect(judge(null, NOW)).toMatch(/never written/);
  });
});

describe("step", () => {
  it("emails when trouble starts, not every 15 minutes, again after 6 hours, and once on recovery", () => {
    let s = step(null, "quiet", NOW);
    expect(s.mail?.kind).toBe("start");
    s = step(s.next, "quiet", NOW + 15 * 60 * 1000);
    expect(s.mail).toBeNull();
    s = step(s.next, "quiet", NOW + REMIND_MS);
    expect(s.mail?.kind).toBe("still");
    s = step(s.next, null, NOW + REMIND_MS + 15 * 60 * 1000);
    expect(s.mail).toEqual({ kind: "clear", reason: "quiet", since: expect.any(Number) });
    expect(step(s.next, null, NOW + REMIND_MS + 30 * 60 * 1000).mail).toBeNull();
  });

  /*
   * Nov 2026: a 15-minute database blip sent a pair of emails (start, then clear) for something that fixed itself.
   * The database not answering mails only after two checks in a row; one miss is a line in the morning report.
   */
  const MISS = "the server's database did not answer (fetch failed)";
  const QUARTER = 15 * 60 * 1000;

  it("one database miss sends nothing and is kept for the morning report", () => {
    // Arrange
    const first = step(null, MISS, NOW);
    // Act
    const next = step(first.next, null, NOW + QUARTER);
    // Assert
    expect(first.mail).toBeNull();
    expect(first.next.down).toBe(false);
    expect(next.mail).toBeNull();
    expect(next.next.blips).toEqual([NOW]);
    expect(next.next.pendingSince).toBeUndefined();
  });

  it("two database misses in a row mail once, dated from the first", () => {
    const first = step(null, MISS, NOW);
    const second = step(first.next, MISS, NOW + QUARTER);
    expect(second.mail).toEqual({ kind: "start", reason: MISS, since: NOW });
    expect(second.next.down).toBe(true);
    expect(second.next.pendingSince).toBeUndefined();
    expect(step(second.next, null, NOW + 2 * QUARTER).mail?.kind).toBe("clear");
  });

  it("a stale report or a full disk still mails at once", () => {
    expect(step(null, "the server's health report is 40 minutes old (it writes one every 10)", NOW).mail?.kind).toBe("start");
    expect(step(null, "the server's disk is 93% full", NOW).mail?.kind).toBe("start");
  });

  it("keeps a day of single misses, no more", () => {
    const old = { down: false, since: NOW, mailedAt: 0, reason: "", blips: [NOW - 2 * 24 * 3600_000, NOW - 3600_000] };
    const first = step(old, MISS, NOW);
    expect(step(first.next, null, NOW + QUARTER).next.blips).toEqual([NOW - 3600_000, NOW]);
  });
});
