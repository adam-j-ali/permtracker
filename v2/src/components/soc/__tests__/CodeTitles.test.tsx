import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An occupation page links every job title page whose main code is its own, not only the dozen busiest titles
 * filed under it: until Nov 2026 those twelve (and the finder's 24) were the only links most title pages had.
 */

vi.mock("server-only", () => ({}));
const titlesForCode = vi.fn();
const titlePagesForCode = vi.fn();
vi.mock("@/lib/db/socTitles", () => ({
  titlesForCode: (...a: unknown[]) => titlesForCode(...a),
  titlePagesForCode: (...a: unknown[]) => titlePagesForCode(...a),
  getSocCodes: async () => ({ pageMin: 50, codes: new Map() }),
}));
// The pager hides rows by a style rule and never removes one; it isn't what decides which titles are linked.
vi.mock("@/components/ui/list-pages", () => ({ ListPages: () => null }));

const { CodeTitles } = await import("../CodeTitles");

const filed = (key: string, filings: number, keyFilings: number) => ({ key, title: key, filings, share: filings / keyFilings, keyFilings });
const titlePage = (slug: string, filings: number) => ({ slug, title: slug.replace(/-/g, " "), filings, topSoc: "15-1252", topFilings: filings });

function hrefs(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a[href^='/soc-codes/']")].map((a) => a.getAttribute("href") ?? "");
}

describe("CodeTitles", () => {
  beforeEach(() => {
    titlesForCode.mockReset();
    titlePagesForCode.mockReset();
  });

  it("links every title page whose main code is this one, beyond the twelve busiest", async () => {
    // The bars: twelve titles, the first two with pages, the rest under the page floor.
    titlesForCode.mockResolvedValue({
      filed: [filed("software engineer", 190_000, 211_337), filed("software developer", 85_000, 90_000), ...Array.from({ length: 10 }, (_, i) => filed(`tiny title ${i}`, 20, 30))],
      onet: [],
    });
    const pages = [titlePage("software-engineer", 211_337), titlePage("software-developer", 90_000), ...Array.from({ length: 60 }, (_, i) => titlePage(`backend-engineer-${i}`, 400 - i))];
    titlePagesForCode.mockResolvedValue(pages);
    const { container } = render(await CodeTitles({ code: "15-1252.00" }));
    const linked = new Set(hrefs(container));
    expect(pages.filter((p) => !linked.has(`/soc-codes/${p.slug}`)).map((p) => p.slug)).toEqual([]);
    expect(titlePagesForCode).toHaveBeenCalledWith("15-1252");
    // A title already linked in the bars isn't listed twice.
    expect(hrefs(container).filter((h) => h === "/soc-codes/software-engineer")).toHaveLength(1);
  });

  it("adds no list when every title page is already a bar", async () => {
    titlesForCode.mockResolvedValue({ filed: [filed("data scientist", 21_000, 24_660)], onet: [] });
    titlePagesForCode.mockResolvedValue([{ ...titlePage("data-scientist", 24_660), topSoc: "15-2051" }]);
    const { container } = render(await CodeTitles({ code: "15-2051" }));
    expect(container.querySelector("#code-title-pages")).toBeNull();
    expect(hrefs(container)).toEqual(["/soc-codes/data-scientist"]);
  });
});
