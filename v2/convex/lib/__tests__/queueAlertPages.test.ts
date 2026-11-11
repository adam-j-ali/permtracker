import { describe, expect, it } from "vitest";

import { QUEUE_CANCEL_ASK, QUEUE_CONFIRM_ASK, queueConfirmedWords } from "../queueAlertPages";

describe("the pages a queue alert's links open", () => {
  it("names the wage queue for a wage request's alert, never the PERM queue", () => {
    const words = queueConfirmedWords("pwd-oews", "2026-07", false);
    expect(words).toContain("prevailing-wage queue (OEWS)");
    expect(words).not.toContain("PERM");
  });

  it("names the PERM queue for a PERM alert", () => {
    expect(queueConfirmedWords("perm", "2025-06", false)).toContain("PERM analyst-review queue reaches June 2025");
  });

  it("prints the month in words, in both states", () => {
    for (const reached of [true, false]) {
      const words = queueConfirmedWords("perm", "2025-06", reached);
      expect(words).toContain("June 2025");
      expect(words).not.toMatch(/\d{4}-\d{2}/);
    }
    expect(queueConfirmedWords("pwd-nonoews", "2026-01", true)).toContain("has already reached January 2026");
  });

  it("names no queue on the pages that only hold the address", () => {
    for (const words of [QUEUE_CONFIRM_ASK, QUEUE_CANCEL_ASK]) {
      expect(words).not.toContain("PERM");
      expect(words).not.toContain("wage");
    }
  });
});
