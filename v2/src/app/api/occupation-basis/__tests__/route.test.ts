import { beforeEach, describe, expect, it, vi } from "vitest";

const occupationsForSoc = vi.fn();
vi.mock("@/lib/db/reference", () => ({ occupationsForSoc }));

const { GET } = await import("../route");
const get = (qs: string) => GET(new Request(`https://permtracker.app/api/occupation-basis?${qs}`));

describe("GET /api/occupation-basis", () => {
  beforeEach(() => {
    occupationsForSoc.mockReset();
  });

  it("refuses a malformed code before reading anything", async () => {
    for (const qs of ["", "soc=abc", "soc=15"]) expect((await get(qs)).status, qs).toBe(400);
    expect(occupationsForSoc).not.toHaveBeenCalled();
  });

  it("returns each occupation with its Job Zone and education read as a degree, cached a day", async () => {
    occupationsForSoc.mockResolvedValue({
      wageYear: 2026,
      occupations: [
        { onetCode: "15-1211.00", title: "Computer Systems Analysts", jobZone: 4, education: "Bachelor's degree", appendixA: true },
        { onetCode: "15-1211.01", title: "Health Informatics Specialists", jobZone: 5, education: "Bachelor's degree", appendixA: true },
      ],
    });
    const res = await get("soc=15-1211");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400");
    const body = (await res.json()) as { occupations: { jobZone: number; education: string; usable: boolean }[]; wageYear: number };
    expect(body.wageYear).toBe(2026);
    expect(body.occupations.map((o) => [o.jobZone, o.education, o.usable])).toEqual([[4, "bachelor", true], [5, "bachelor", true]]);
  });

  it("marks an occupation DOL's table leaves blank as unusable rather than guessing", async () => {
    occupationsForSoc.mockResolvedValue({ wageYear: 2026, occupations: [{ onetCode: "99-9999.00", title: "X", jobZone: null, education: "Something new", appendixA: false }] });
    const body = (await (await get("soc=99-9999")).json()) as { occupations: { usable: boolean; education: string | null }[] };
    expect(body.occupations[0]).toMatchObject({ usable: false, education: null });
  });

  it("says the table couldn't be read when the read fails, uncached", async () => {
    occupationsForSoc.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await get("soc=15-1252");
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
