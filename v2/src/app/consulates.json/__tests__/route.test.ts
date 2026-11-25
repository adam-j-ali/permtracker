import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/consularPosts", () => ({ getConsularIndex: vi.fn() }));

import { getConsularIndex } from "@/lib/db/consularPosts";

import * as route from "../route";

/**
 * /consulates.json: every consulate with a page, for the site search (Batch 5, Nov 25 2026). Each is named by its
 * page's own heading, so the search and the page say the same thing, and the busiest employment posts come first.
 */
function post(slug: string, name: string, employment: number | null) {
  return { key: slug, slug, name, now: null, issued: null, employment };
}

describe("/consulates.json", () => {
  beforeEach(() => {
    vi.mocked(getConsularIndex).mockReset();
  });

  it("lists each consulate under its page's heading, busiest first, with the words people type", async () => {
    vi.mocked(getConsularIndex).mockResolvedValue({
      asOf: "2026-11-20", readings: [], issuedFrom: null, issuedTo: null,
      posts: [post("montreal", "Montreal", 120), post("mumbai", "Mumbai", 9000), post("ciudad-juarez", "Ciudad Juarez", null)],
    });
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    const list = (await res.json()) as { label: string; href: string; keywords: string }[];
    expect(list.map((c) => c.href)).toEqual(["/consular-posts/mumbai", "/consular-posts/montreal", "/consular-posts/ciudad-juarez"]);
    expect(list[0]!.label).toBe("Mumbai: immigrant visas");
    expect(list[0]!.keywords).toMatch(/consulate/);
    expect(list[0]!.keywords).toMatch(/embassy/);
  });

  it("answers 503 when the consulates can't be read, never an empty list", async () => {
    vi.mocked(getConsularIndex).mockImplementation(async () => {
      throw new Error("down");
    });
    const res = await route.GET();
    expect(res.status).toBe(503);
  });

  it("exports its handler and its refresh setting only", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "revalidate"]);
  });
});
