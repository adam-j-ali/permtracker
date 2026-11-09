import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Each seasonal prediction is recorded once and graded once, so one failed read during either is permanent: a case
 * DOL's file settled would be graded with its pending word ("IN PROCESS"), which the scorecard never counts, and a
 * case recorded without its first day of work stays dated by the wrong clock. A failed read skips the step for the
 * day instead; the next run does it with the record in hand.
 */
vi.mock("server-only", () => ({}));
const rows = vi.fn();
const one = vi.fn();
const exec = vi.fn();
vi.mock("../client", () => ({ rows, one, exec }));
vi.mock("../seasonalTiming", () => ({ getSeasonalTiming: vi.fn(async () => ({})), getSeasonalCheck: vi.fn(async () => null) }));
// Any case gets a date, so the only thing that can stop a prediction is the input read.
vi.mock("@/lib/seasonalTiming", () => ({
  timingView: vi.fn(() => ({ visa: "H-2A", basis: "filed", season: false, group: null })),
  viewEstimate: vi.fn(() => ({ predicted: "2026-12-01", early: "2026-11-20", late: "2026-12-10" })),
}));

const { gradeOpenPredictions, predictSeasonal } = await import("../predictions");

const CASE = "H-300-26001-000001";

beforeEach(() => {
  rows.mockReset();
  one.mockReset().mockResolvedValue(null);
  exec.mockReset().mockResolvedValue(1);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("grading a seasonal case when DOL's file can't be read", () => {
  beforeEach(() => {
    rows.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM estimate_predictions WHERE outcome IS NULL")) return [{ id: "s", program: "seasonal", case_number: CASE }];
      // Settled by DOL's file: final, under a pending word, with no final event.
      if (sql.includes("FROM seasonal_case_status")) return [{ case_number: CASE, current_status: "IN PROCESS", fetched_at: Date.UTC(2026, 9, 20) }];
      if (sql.includes("FROM seasonal_case_events")) return [];
      if (sql.includes("FROM seasonal_cases")) throw new Error("SERVER_ERROR: database is locked");
      return [];
    });
  });

  it("leaves the case open for the next run, never graded with its pending word", async () => {
    await gradeOpenPredictions();
    const graded = exec.mock.calls.filter(([sql, args]) => String(sql).includes("UPDATE estimate_predictions SET decided_on") && (args as unknown[]).includes(CASE));
    expect(graded).toEqual([]);
  });
});

describe("recording seasonal predictions when an input can't be read", () => {
  // The day's pick, one H-2A case (the pick runs once per form).
  const picks = (sql: string, args?: unknown[]) => sql.includes("FROM seasonal_case_status s") && args?.[0] === "H-300-";

  it("records a case when its inputs read", async () => {
    rows.mockImplementation(async (sql: string, args?: unknown[]) => (picks(sql, args) ? [{ case_number: CASE, filed: "2026-11-02" }] : []));
    expect((await predictSeasonal("2026-11-09")).map((p) => p.caseNumber)).toEqual([CASE]);
  });

  it("records none that day rather than dating them without their first day of work", async () => {
    rows.mockImplementation(async (sql: string, args?: unknown[]) => {
      if (picks(sql, args)) return [{ case_number: CASE, filed: "2026-11-02" }];
      if (sql.includes("FROM seasonal_postings")) throw new Error("SERVER_ERROR: database is locked");
      return [];
    });
    await expect(predictSeasonal("2026-11-09")).resolves.toEqual([]);
  });
});
