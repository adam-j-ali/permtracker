import { beforeEach, describe, expect, it, vi } from "vitest";

const getReportedSummary = vi.fn();
vi.mock("@/lib/db/reportedSummary", () => ({ getReportedSummary }));
const { GET } = await import("../route");

const ROW = { category: "EB-3", premium: "with filing", reported: 40, decidedAllTime: 60, windowDays: 183, decided: 30, approvedShare: 0.9, medianDays: 21, rfeShare: 0.1 };

describe("GET /api/reported-i140", () => {
  beforeEach(() => {
    getReportedSummary.mockReset();
  });

  it("returns the I-140 figures alone, cached ten minutes", async () => {
    getReportedSummary.mockResolvedValue({ today: "2026-11-20", i140: [ROW], steps: [{ id: "x" }], waiting: {} });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, today: "2026-11-20", i140: [ROW] });
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=600");
  });

  it("says the figures aren't built yet, uncached, before the first build", async () => {
    getReportedSummary.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("says the figures couldn't be read when the read fails, uncached", async () => {
    getReportedSummary.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
