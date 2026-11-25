import { afterEach, describe, expect, it, vi } from "vitest";

import { loadCities, resetCityList } from "../cityList";
import { loadSocTitles, resetSocTitleList, socTitleLabel } from "../socTitleList";

/** The job titles and the cities in the site search: each list fetched once per visit, from its own route. */

const titles = [{ title: "Software Engineer", code: "15-1252", href: "/soc-codes/software-engineer" }];
const cities = [{ label: "Tampa, FL", href: "/perm-cities/tampa-fl", keywords: "Florida" }];

afterEach(() => {
  resetSocTitleList();
  resetCityList();
  vi.unstubAllGlobals();
});

describe.each([
  ["job titles", "/soc-titles.json", titles, loadSocTitles],
  ["cities", "/cities.json", cities, loadCities],
] as const)("the %s list for search", (_name, url, list, load) => {
  it(`is fetched once from ${url} however many ask`, async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(list)));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([load(), load()]);
    expect(a).toEqual(list);
    expect(b).toEqual(list);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(url);
  });

  it("refuses a failed answer, and tries again next time", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(list)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(load()).rejects.toThrow("503");
    expect(await load()).toEqual(list);
  });
});

describe("socTitleLabel", () => {
  it("names a title with the code filed most for it, and alone when none was filed", () => {
    expect(socTitleLabel(titles[0]!)).toBe("Software Engineer (15-1252)");
    expect(socTitleLabel({ title: "Ward Clerk", code: null, href: "/soc-codes/ward-clerk" })).toBe("Ward Clerk");
  });
});
