import { beforeEach, describe, expect, it, vi } from "vitest";

/** One job's wage levels by year in one area: a checked code, and a failed read said as one and logged. */

const wageLevelHistory = vi.fn();
const marketPayIn = vi.fn();
vi.mock("@/lib/db/reference", () => ({
  wageLevelHistory: (...a: unknown[]) => wageLevelHistory(...a),
  marketPayIn: (...a: unknown[]) => marketPayIn(...a),
}));

const { GET } = await import("../route");
const get = (qs: string) => GET(new Request(`https://permtracker.app/api/wage-levels/history?${qs}`));

describe("GET /api/wage-levels/history", () => {
  beforeEach(() => {
    wageLevelHistory.mockReset();
    marketPayIn.mockReset();
  });

  it("refuses a missing job or area before reading anything", async () => {
    expect((await get("soc=15-1252")).status).toBe(400);
    expect(wageLevelHistory).not.toHaveBeenCalled();
  });

  it("says the tables couldn't be read when a read fails, and logs why", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    wageLevelHistory.mockRejectedValue(new Error("database down"));
    marketPayIn.mockResolvedValue([]);
    const res = await get("soc=15-1252&area=42660");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[wage-levels/history]"), expect.objectContaining({ message: "database down" }));
    logged.mockRestore();
  });
});
