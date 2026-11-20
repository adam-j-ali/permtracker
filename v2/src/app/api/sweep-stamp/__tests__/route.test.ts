import { beforeEach, describe, expect, it, vi } from "vitest";

/** The stamp an open page polls: when our newest check of DOL's record finished, cached a minute at the edge. */

const getCheckTimes = vi.fn();
vi.mock("@/lib/db/sweepCoverage", () => ({ getCheckTimes }));

const { GET } = await import("../route");

describe("GET /api/sweep-stamp", () => {
  beforeEach(() => {
    getCheckTimes.mockReset();
  });

  it("answers the newest check's finish, so an open page redraws after the daytime pass too", async () => {
    getCheckTimes.mockResolvedValue({ newest: 1795196700000, full: 1795189000000 });
    const res = await GET();
    expect(await res.json()).toEqual({ checkedAt: 1795196700000 });
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
  });

  it("answers null when no recent check is on record or the read fails", async () => {
    getCheckTimes.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ checkedAt: null });
    getCheckTimes.mockImplementation(async () => {
      throw new Error("deadline");
    });
    expect(await (await GET()).json()).toEqual({ checkedAt: null });
  });
});
