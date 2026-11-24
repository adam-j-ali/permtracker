import { describe, expect, it } from "vitest";

import { ALERT_ROUTES, routeOf } from "@convex/lib/alertRoutes";
import { type AlertLatest, alertState } from "../alertRouteState";

/**
 * The admin page lists every kind in the routing list with its latest state where it's already recorded: the
 * outside watch's row, the newest recorded error of each kind, the newest morning report's sections.
 */
const NOW = 1_796_043_600_000; // Mon Nov 30 2026, 8:00 AM EST
const need = (id: string) => {
  const r = routeOf(id);
  if (!r) throw new Error(`${id} isn't in the routing list`);
  return r;
};
const empty: AlertLatest = { watch: null, errors: [], report: null };

describe("each alert kind's latest state", () => {
  it("says a watch kind is on, with since when, only when the watch is down for that reason", () => {
    // Arrange
    const latest: AlertLatest = {
      ...empty,
      watch: { down: true, since: NOW, reason: "the server's disk is 93% full", blips: [] },
    };
    // Act
    const disk = alertState(need("watch.disk"), latest);
    const quiet = alertState(need("watch.quiet"), latest);
    // Assert
    expect(disk).toEqual({ tone: "on", text: "On since Mon Nov 30, 8:00 AM EST: the server's disk is 93% full." });
    expect(quiet.tone).toBe("clear");
  });

  it("counts the outside watch's single database misses", () => {
    const latest: AlertLatest = { ...empty, watch: { down: false, since: NOW, reason: "", blips: [NOW - 60_000, NOW] } };
    expect(alertState(need("watch.blip"), latest)).toEqual({
      tone: "seen",
      text: "2 times in the last day, the newest Mon Nov 30, 8:00 AM EST.",
    });
  });

  it("names the newest recorded error of each kind", () => {
    const latest: AlertLatest = { ...empty, errors: [{ route: "errors.repeat", at: NOW, operation: "pwdSweep.run" }] };
    expect(alertState(need("errors.repeat"), latest).text).toBe("Last Mon Nov 30, 8:00 AM EST: pwdSweep.run.");
    expect(alertState(need("errors.once"), latest).tone).toBe("clear");
  });

  it("reads a reported kind from its section in the newest report", () => {
    const latest: AlertLatest = {
      ...empty,
      report: { day: "2026-11-30", sections: [{ key: "github", status: "warn", summary: "1 workflow's newest run failed" }] },
    };
    const got = alertState(need("report.github-red"), latest);
    expect(got.tone).toBe("seen");
    expect(got.text).toMatch(/^Watch in the .+ report: 1 workflow's newest run failed$/);
  });

  it("says what it can for every kind in the list, with nothing recorded yet", () => {
    for (const r of ALERT_ROUTES) {
      const s = alertState(r, empty);
      expect(s.text.length, r.id).toBeGreaterThan(0);
      expect(s.text, r.id).not.toMatch(/undefined|NaN/);
    }
  });
});
