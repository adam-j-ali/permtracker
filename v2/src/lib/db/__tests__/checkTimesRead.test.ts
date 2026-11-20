import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The times a page prints: the newest check of DOL's record (perm_docs['latest_check'], stamped by every pass) and the
 * last complete read (perm_docs['sweep_coverage']). The pages had printed only the second, under figures the 15-minute
 * daytime pass had already rewritten (Nov 20 2026: "checked 10:55 AM" read at 12:51 PM).
 */

const one = vi.fn();
vi.mock("../client", () => ({ one: (...a: unknown[]) => one(...a) }));

const NOW = Date.parse("2026-11-20T12:51:00-05:00");
const FULL = Date.parse("2026-11-20T10:55:00-05:00");
const ACTIVE = Date.parse("2026-11-20T12:45:00-05:00");

function store(docs: Record<string, { json?: string; computed_at: number | string } | null>) {
  one.mockImplementation(async (_sql: string, args: unknown[]) => docs[String(args[0])] ?? null);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  one.mockReset();
});

const coverage = { json: JSON.stringify({ finishedOn: "2026-11-20", mode: "pending", asked: 1, answered: 1 }), computed_at: FULL };

describe("getCheckTimes", () => {
  it("prints the daytime pass's check as the newest, with the complete read beside it", async () => {
    store({ sweep_coverage: coverage, latest_check: { computed_at: String(ACTIVE) } });
    const { getCheckTimes } = await import("../sweepCoverage");

    expect(await getCheckTimes()).toEqual({ newest: ACTIVE, full: FULL });
  });

  it("falls back to the complete read when no pass has stamped its check, or the stamp is over eight days old", async () => {
    store({ sweep_coverage: coverage, latest_check: null });
    let mod = await import("../sweepCoverage");
    expect(await mod.getCheckTimes()).toEqual({ newest: FULL, full: FULL });

    vi.resetModules();
    store({ sweep_coverage: coverage, latest_check: { computed_at: NOW - 9 * 86_400_000 } });
    mod = await import("../sweepCoverage");
    expect(await mod.getCheckTimes()).toEqual({ newest: FULL, full: FULL });
  });

  it("is null when neither record can be read", async () => {
    one.mockRejectedValue(new Error("database down"));
    const { getCheckTimes } = await import("../sweepCoverage");

    expect(await getCheckTimes()).toBeNull();
  });
});
