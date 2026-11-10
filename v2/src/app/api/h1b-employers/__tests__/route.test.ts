import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The H-1B rankings API tells a failed read from rankings that aren't built: both are 503, each with its own words,
 * and a failure is never kept by a cache. Shape checks answer before anything is read.
 */
const getH1bSummary = vi.fn<() => Promise<unknown>>();
const getH1bView = vi.fn<() => Promise<unknown>>();
vi.mock("@/lib/db/h1bRanks", () => ({
  getH1bSummary: () => getH1bSummary(),
  getH1bView: () => getH1bView(),
}));

const { GET } = await import("../route");
const ask = (query: string) => GET(new Request(`https://permtracker.app/api/h1b-employers?${query}`));

describe("GET /api/h1b-employers", () => {
  beforeEach(() => {
    getH1bSummary.mockReset();
    getH1bView.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("refuses a malformed request before reading anything", async () => {
    const res = await ask("fy=25&state=US");
    expect(res.status).toBe(400);
    expect(getH1bSummary).not.toHaveBeenCalled();
  });

  it("answers 503, uncached, in its own words when the summary can't be read", async () => {
    getH1bSummary.mockRejectedValue(new Error("database query deadline"));
    const res = await ask("fy=2025&state=US");
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error).toBe("The rankings couldn't be read just now. Try again in a minute.");
    expect(getH1bView).not.toHaveBeenCalled();
  });

  it("answers 503 for rankings that aren't built yet", async () => {
    getH1bSummary.mockResolvedValue(null);
    const res = await ask("fy=2025&state=US");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("The rankings aren't built yet.");
  });

  it("names the years it holds when asked for one it doesn't", async () => {
    getH1bSummary.mockResolvedValue({ years: [{ fy: 2024, places: {} }, { fy: 2025, places: {} }] });
    const res = await ask("fy=2019&state=US");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("fy must be one of 2024, 2025");
  });
});
