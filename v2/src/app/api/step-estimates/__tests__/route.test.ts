import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/step-estimates: the three kinds of figure for the I-485 and the work permit, for the case page's green card
 * tab. It takes no case data. A source that fails is named in `unreadable` and the rest still answer; all three failed
 * is a 503 that says so.
 */

const getUscisPosted = vi.fn();
const getSampleMonths = vi.fn();
const getReportedSummary = vi.fn();
vi.mock("@/lib/db/uscisPosted", () => ({ getUscisPosted }));
vi.mock("@/lib/db/uscisSample", () => ({ getSampleMonths }));
vi.mock("@/lib/db/reportedSummary", () => ({ getReportedSummary }));

const { GET } = await import("../route");

const SUMMARY = {
  steps: [
    { id: "i485-gc", label: "", group: "i485", verified: false, n: 37, windowDays: 365, median: 410, p25: 360, p75: 470, before: null, allTime: 37, months: [] },
  ],
};

describe("GET /api/step-estimates", () => {
  beforeEach(() => {
    getUscisPosted.mockReset().mockResolvedValue(null);
    getSampleMonths.mockReset().mockResolvedValue(null);
    getReportedSummary.mockReset().mockResolvedValue(SUMMARY);
  });

  it("answers both steps, cached for a while, from the readers the public pages use", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/max-age/);
    const body = await res.json();
    expect(body.steps.i485.community).toMatchObject({ median: 410, n: 37 });
    expect(body.steps.ead).toEqual({ official: null, measured: null, community: null });
    expect(body.unreadable).toEqual([]);
  });

  it("names a source it couldn't read and still answers the rest", async () => {
    getSampleMonths.mockRejectedValue(new Error("db down"));
    const body = await (await GET()).json();
    expect(body.unreadable).toEqual(["sample"]);
    expect(body.steps.i485.community).not.toBeNull();
  });

  it("is a 503 when nothing could be read", async () => {
    getUscisPosted.mockRejectedValue(new Error("db down"));
    getSampleMonths.mockRejectedValue(new Error("db down"));
    getReportedSummary.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
