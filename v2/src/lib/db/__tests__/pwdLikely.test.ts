import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rows = vi.fn();
const cityGeo = vi.fn();
const wageLevelsForArea = vi.fn();
const getSocTitle = vi.fn();
vi.mock("../client", () => ({ rows: (...a: unknown[]) => rows(...a) }));
vi.mock("../reference", () => ({ cityGeo: (k: string) => cityGeo(k), wageLevelsForArea: (a: string, c: string[]) => wageLevelsForArea(a, c) }));
vi.mock("../socTitles", () => ({ getSocTitle: (k: string) => getSocTitle(k) }));

const { cityKey, getPwdLikely } = await import("../pwdLikely");

const past = (city: string, state: string, soc = "11-3021", level = "IV") => ({
  case_number: `P-100-${city}`, determined_on: "2026-06-24", decision_date: "2026-06-24", soc_code: soc,
  soc_title: "Computer and Information Systems Managers", wage_level: level, wage: 238285, wage_unit: "YEAR",
  worksite_city: city, worksite_state: state, req_education: "Bachelor's", req_experience_months: "72",
});

describe("getPwdLikely", () => {
  beforeEach(() => {
    rows.mockReset();
    cityGeo.mockReset();
    wageLevelsForArea.mockReset();
    getSocTitle.mockReset();
  });

  it("takes the code from the employer's own determinations for the title, and the area they name most", async () => {
    rows.mockResolvedValue([past("Westlake", "TX"), past("Boston", "MA"), past("Boston", "MA")]);
    cityGeo.mockResolvedValue({ wageArea: "71654", wageAreaName: "Boston-Cambridge-Newton, MA NECTA Division" });
    wageLevelsForArea.mockResolvedValue([{ soc: "11-3021", wageYear: 2026, yearly: [150000, 180000, 210000, 240000], levels: [0, 0, 0, 0], annual: false, label: null }]);
    const got = await getPwdLikely("fmr-llc", "Director, Full Stack Engineering", "2026-11-20");
    expect(got?.soc).toMatchObject({ code: "11-3021", basis: "employer" });
    expect(cityGeo).toHaveBeenCalledWith("BOSTON|MA");
    expect(got?.area).toMatchObject({ code: "71654", city: "Boston, MA", jobs: 2 });
    expect(got?.levels?.yearly[3]).toBe(240000);
    expect(got?.past[0]).toMatchObject({ education: "Bachelor's", experienceMonths: 72 });
    expect(getSocTitle).not.toHaveBeenCalled();
  });

  it("falls back to the code employers file the title under most, when the employer has none", async () => {
    rows.mockResolvedValue([]);
    getSocTitle.mockResolvedValue({ codes: [{ soc: "15-1252", codeTitle: "Software Developers", filings: 900, share: 0.6 }, { soc: "15-1253", codeTitle: "QA", filings: 100, share: 0.07 }] });
    const got = await getPwdLikely("new-co", "Software Engineer", "2026-11-01");
    expect(got?.soc).toMatchObject({ code: "15-1252", basis: "title" });
    expect(got?.area).toBeNull();
  });

  it("says nothing without a title, and nothing when no evidence exists", async () => {
    expect(await getPwdLikely("x", "  ", null)).toBeNull();
    rows.mockResolvedValue([]);
    getSocTitle.mockResolvedValue(null);
    expect(await getPwdLikely("x", "Unheard Of Title", null)).toBeNull();
  });

  it("keys a city the way the geography table does", () => {
    expect(cityKey("St. Louis", "mo")).toBe("ST LOUIS|MO");
    expect(cityKey(null, "MO")).toBeNull();
  });
});
