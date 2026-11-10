import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const one = vi.fn<(sql: string, args?: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/db/client", () => ({ one, rows: vi.fn(), exec: vi.fn() }));

const { getScorecard } = await import("../scorecard");
const { PREDICTIONS } = await import("@/lib/predictionLedger");

/**
 * Each recorded prediction against DOL's record. A case the record hasn't seen decide is pending; a record that
 * can't be read is a failure, and the read throws, so the scorecard never prints a decided case as still pending.
 */
describe("getScorecard", () => {
  beforeEach(() => {
    one.mockReset();
  });

  it("scores a prediction from the day the record first saw the case decided", async () => {
    one.mockImplementation(async (sql: string) =>
      sql.includes("perm_case_status") ? { current_status: "CERTIFIED" } : { changed_at: Date.UTC(2026, 10, 20, 15, 0) },
    );
    const [first] = await getScorecard();
    expect(first!.prediction).toBe(PREDICTIONS[0]);
    expect(first!.status).toBe("CERTIFIED");
    expect(first!.decidedOn).toBe("2026-11-20");
    expect(first!.score).not.toBeNull();
  });

  it("leaves a case pending when the record holds no decision for it", async () => {
    one.mockImplementation(async (sql: string) => (sql.includes("perm_case_status") ? { current_status: "ANALYST REVIEW" } : null));
    const all = await getScorecard();
    expect(all).toHaveLength(PREDICTIONS.length);
    expect(all.every((s) => s.decidedOn === null && s.score === null)).toBe(true);
    expect(all[0]!.status).toBe("ANALYST REVIEW");
  });

  it("throws when the record can't be read, on either read", async () => {
    one.mockRejectedValue(new Error("database query deadline"));
    await expect(getScorecard()).rejects.toThrow("database query deadline");
    one.mockReset();
    one.mockImplementation(async (sql: string) => {
      if (sql.includes("perm_case_status")) return { current_status: "CERTIFIED" };
      throw new Error("fetch failed");
    });
    await expect(getScorecard()).rejects.toThrow("fetch failed");
  });
});
