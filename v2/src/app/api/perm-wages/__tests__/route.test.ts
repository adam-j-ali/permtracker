import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The salary explorer route's city and industry narrowings.
 *
 * Neither column is indexed on `perm_cases`, so each is accepted only on top
 * of a slice an index serves: a city inside a state, an industry inside a
 * state or an occupation. Alone, either would walk the whole table on every
 * uncached request, and that must be a 400, never a slow 200.
 */

const getWageSelection = vi.fn();
const getWageHistogram = vi.fn();
const getWageByState = vi.fn();
vi.mock("@/lib/db/publicData", () => ({ getWageSelection, getWageHistogram, getWageByState }));
const permHistoryYear = vi.fn(async (fy: string) => Number(fy) < 2024);
vi.mock("@/lib/db/wageViews", () => ({ permHistoryYear }));

const { GET } = await import("../route");

const call = (qs: string) => GET(new Request(`https://permtracker.app/api/perm-wages?${qs}`));

beforeEach(() => {
  getWageSelection.mockReset();
  getWageHistogram.mockReset();
  getWageByState.mockReset();
  // Below the median floor, so the route answers from the stats alone.
  getWageSelection.mockResolvedValue({
    stats: { n: 3, avg: null, p5: null, p25: null, p50: null, p75: null, p95: null },
    earlierCodes: [],
    earlierNote: null,
  });
});

describe("GET /api/perm-wages city and industry", () => {
  it("refuses a city without a state, and reads nothing", async () => {
    const r = await call("city=Seattle");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/city filter needs a state/);
    expect(getWageSelection).not.toHaveBeenCalled();
  });

  it("refuses an industry with neither a state nor an occupation", async () => {
    const r = await call("sector=51");
    expect(r.status).toBe(400);
    expect(getWageSelection).not.toHaveBeenCalled();
  });

  it("refuses a sector it doesn't know, and a city longer than any DOL prints", async () => {
    expect((await call("state=WA&sector=99")).status).toBe(400);
    expect((await call(`state=WA&city=${"x".repeat(61)}`)).status).toBe(400);
    expect(getWageSelection).not.toHaveBeenCalled();
  });

  it("passes a city inside its state, spaces collapsed", async () => {
    const r = await call("state=WA&city=%20Seattle%20%20");
    expect(r.status).toBe(200);
    expect(getWageSelection).toHaveBeenCalledWith(expect.objectContaining({ state: "WA", city: "Seattle" }));
  });

  it("passes every code of a sector that spans several", async () => {
    const r = await call("soc=15-1252&sector=31");
    expect(r.status).toBe(200);
    expect(getWageSelection).toHaveBeenCalledWith(
      expect.objectContaining({ socCode: "15-1252", sectorCodes: ["31", "32", "33"] }),
    );
  });
});

describe("GET /api/perm-wages for a year from DOL's older files", () => {
  // Their selections are precomputed by occupation and state only, and the live query reads FY2024 on.
  it("refuses a city or an industry, and reads no wages", async () => {
    const city = await call("state=WA&city=Seattle&fy=2015");
    expect(city.status).toBe(400);
    expect((await city.json()).error).toMatch(/older files/);
    expect((await call("soc=15-1132&sector=51&fy=2015")).status).toBe(400);
    expect(getWageSelection).not.toHaveBeenCalled();
  });

  it("passes a city in a current year", async () => {
    expect((await call("state=WA&city=Seattle&fy=2025")).status).toBe(200);
  });

  it("asks whether the year is an older one only when a city or industry would narrow it", async () => {
    permHistoryYear.mockClear();
    await call("state=WA&fy=2015");
    await call("state=WA&city=Seattle");
    expect(permHistoryYear).not.toHaveBeenCalled();
  });

  // Those files carry BLS's 2010 job codes: software developers were 15-1132 and 15-1133 before 15-1252.
  const EARLIER = [
    { code: "15-1132", title: "Software Developers, Applications", n: 8_100 },
    { code: "15-1133", title: "Software Developers, Systems Software", n: 1_900 },
  ];
  const NOTE = "15-1132 and 15-1133 also covered 15-1253 (Software Quality Assurance Analysts and Testers).";

  it("names a renumbered job's 2010 codes when the year has none of its cases under the new one", async () => {
    getWageSelection.mockResolvedValue({
      stats: { n: 0, avg: null, p5: null, p25: null, p50: null, p75: null, p95: null },
      earlierCodes: EARLIER,
      earlierNote: NOTE,
    });
    const body = await (await call("soc=15-1252&fy=2015")).json();
    expect(body.earlierCodes).toEqual(EARLIER);
    expect(body.earlierNote).toBe(NOTE);
  });

  it("names them beside the figures when the year has some under each", async () => {
    getWageSelection.mockResolvedValue({
      stats: { n: 400, avg: 1, p5: 90_000, p25: 1, p50: 1, p75: 1, p95: 150_000 },
      earlierCodes: EARLIER,
      earlierNote: NOTE,
    });
    getWageHistogram.mockResolvedValue([]);
    getWageByState.mockResolvedValue([]);
    const body = await (await call("soc=15-1252&fy=2022")).json();
    expect(body.stats.n).toBe(400);
    expect(body.earlierCodes).toEqual(EARLIER);
  });
});
