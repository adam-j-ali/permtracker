import { describe, expect, it } from "vitest";

import { ALERT_ROUTES, CHANNEL_ORDER, CHANNEL_WORDS, RUNS_WORDS, channelOf, isSentNow, levelOf, remindMsOf, routeOf } from "../alertRoutes";
import { errorRoute } from "../errorRecording";
import { DB_MISS, routeOfReason } from "../serverWatch";

/**
 * Convex reads the one routing list (scripts/data/alert_routes.json) through convex/lib/alertRoutes.ts. A gap in it
 * is never silence: an unlisted kind goes by phone. scripts/test_alert_routes.py holds the list and every program to
 * each other; these hold the TypeScript side's reading of it.
 */
describe("the routing list, read by Convex", () => {
  it("names every channel and every place a kind runs", () => {
    expect([...CHANNEL_ORDER].sort()).toEqual(Object.keys(CHANNEL_WORDS).sort());
    for (const r of ALERT_ROUTES) {
      expect(CHANNEL_ORDER, r.id).toContain(r.channel);
      expect(Object.keys(RUNS_WORDS), r.id).toContain(r.runs);
    }
  });

  it("sends an unlisted kind by phone at high, so a gap is never silence", () => {
    expect(routeOf("watch.nothing-like-this")).toBeUndefined();
    expect(channelOf("watch.nothing-like-this")).toBe("phone");
    expect(isSentNow("watch.nothing-like-this")).toBe(true);
    expect(levelOf("watch.nothing-like-this")).toBe("high");
    expect(remindMsOf("watch.nothing-like-this", 123)).toBe(123);
  });

  it("gives a push level only to a phone kind, and reminders in hours", () => {
    expect(levelOf("watch.quiet")).toBe("urgent");
    expect(levelOf("errors.once")).toBeNull();
    expect(remindMsOf("watch.quiet", 1)).toBe(6 * 3_600_000);
    expect(remindMsOf("errors.repeat", 1), "a repeat's email has no reminder").toBeNull();
  });

  it("lists every kind the outside watch and the recorded errors can raise", () => {
    const watch = [`${DB_MISS} (fetch failed)`, "the server's disk is 93% full", "the server has never written its health report"];
    for (const reason of watch) expect(routeOf(routeOfReason(reason)), reason).toBeDefined();
    for (const k of [errorRoute("boom", false), errorRoute("libsql HTTP 502 Bad Gateway", false), errorRoute("boom", true)]) {
      expect(routeOf(k), k).toBeDefined();
    }
    expect(routeOf("watch.blip")?.channel).toBe("admin");
  });
});
