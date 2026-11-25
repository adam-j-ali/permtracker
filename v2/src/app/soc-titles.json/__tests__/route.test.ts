import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/socTitles", () => ({ getSocTitlePages: vi.fn() }));

import { getSocTitlePages } from "@/lib/db/socTitles";

import * as route from "../route";

/**
 * /soc-titles.json: every job title with a page of its own, for the site search. Each carries its title, the code
 * filed most for it and its page, busiest first, and the list is bounded.
 */
function page(slug: string, title: string, filings: number, topSoc: string | null) {
  return { slug, title, filings, topSoc, topFilings: filings };
}

describe("/soc-titles.json", () => {
  beforeEach(() => {
    vi.mocked(getSocTitlePages).mockReset();
  });

  it("lists each title with its code and page, busiest first", async () => {
    vi.mocked(getSocTitlePages).mockResolvedValue({
      pageMin: 50,
      pages: [page("ward-clerk", "Ward Clerk", 60, null), page("software-engineer", "Software Engineer", 224039, "15-1252")],
    });
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await res.json()).toEqual([
      { title: "Software Engineer", code: "15-1252", href: "/soc-codes/software-engineer" },
      { title: "Ward Clerk", code: null, href: "/soc-codes/ward-clerk" },
    ]);
  });

  it("keeps the busiest 4,000 titles at most", async () => {
    const pages = Array.from({ length: 4100 }, (_, i) => page(`t-${i}`, `Title ${i}`, 10_000 - i, "15-1252"));
    vi.mocked(getSocTitlePages).mockResolvedValue({ pageMin: 50, pages });
    const list = (await (await route.GET()).json()) as { href: string }[];
    expect(list).toHaveLength(4000);
    expect(list[0]!.href).toBe("/soc-codes/t-0");
    expect(list.at(-1)!.href).toBe("/soc-codes/t-3999");
  });

  it("answers an empty list when the titles haven't been built, and 503 when they can't be read", async () => {
    vi.mocked(getSocTitlePages).mockResolvedValue(null);
    expect(await (await route.GET()).json()).toEqual([]);
    vi.mocked(getSocTitlePages).mockRejectedValue(new Error("down"));
    expect((await route.GET()).status).toBe(503);
  });

  it("exports its handler and its refresh setting only", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "revalidate"]);
  });
});
