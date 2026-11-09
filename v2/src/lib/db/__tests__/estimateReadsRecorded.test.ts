import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The estimate's inputs (the decision pace, the sweep's coverage, the range's measured coverage, the straggler rates,
 * the stage ages and a case's RFI day) each read one row and answer null when it's missing or stale. A failed read
 * answers the same null, so the estimate quietly changes model: it must at least be recorded, or the weaker estimate
 * on every case page is invisible. The callers' own softFail never sees the error, because the reader caught it first.
 */
const one = vi.fn();
const rows = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("../client", () => ({ one: (...a: unknown[]) => one(...a), rows: (...a: unknown[]) => rows(...a) }));

const { getDecisionPace } = await import("../decisionPace");
const { getSweepCoverage } = await import("../sweepCoverage");
const { getRangeCoverage } = await import("../rangeCoverage");
const { getStragglerRates } = await import("../stragglers");
const { getStageStats } = await import("../stageStats");
const { rfiEnteredOn } = await import("../rfiClock");

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  one.mockReset().mockRejectedValue(new Error("SERVER_ERROR: database is locked"));
  rows.mockReset().mockRejectedValue(new Error("SERVER_ERROR: database is locked"));
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const logged = () => warn.mock.calls.map((c: unknown[]) => String(c[0]));

describe("an estimate input that can't be read", () => {
  it.each([
    ["decisionPace.rows", () => getDecisionPace()],
    ["sweepCoverage.one", () => getSweepCoverage()],
    ["rangeCoverage.one", () => getRangeCoverage()],
    ["stragglers.one", () => getStragglerRates()],
    ["stageStats.one", () => getStageStats()],
    ["rfiClock.rfiEnteredOn", () => rfiEnteredOn("G-100-25001-123456")],
  ])("%s keeps its null and is recorded", async (label, read) => {
    await expect(read()).resolves.toBeNull();
    expect(logged().some((m) => m.includes(`[soft-read] ${label} failed`) && m.includes("database is locked"))).toBe(true);
  });

  it("records nothing when the row is simply missing", async () => {
    one.mockReset().mockResolvedValue(null);
    rows.mockReset().mockResolvedValue([]);
    await expect(getStragglerRates()).resolves.toBeNull();
    await expect(getDecisionPace()).resolves.toBeNull();
    expect(logged().filter((m) => m.includes("[soft-read]"))).toEqual([]);
  });
});
