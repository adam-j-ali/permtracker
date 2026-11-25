import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/groups", () => ({ listGroups: vi.fn() }));

import { listGroups, type GroupSummary } from "@/lib/db/groups";

import * as route from "../route";

/**
 * /cities.json: every city with a PERM page, for the site search. Each is named as its page names it ("Tampa, FL"),
 * with its state spelled out so "tampa florida" finds it, busiest first, and the list is bounded.
 */
function city(slug: string, label: string, key: string, total: number): GroupSummary {
  return { kind: "city", slug, key, label, total, certified: total, denied: 0, withdrawn: 0, medianWage: null, fyFrom: 2016, fyTo: 2026 };
}

describe("/cities.json", () => {
  beforeEach(() => {
    vi.mocked(listGroups).mockReset();
  });

  it("lists each city under its page's name, busiest first, with its state spelled out", async () => {
    vi.mocked(listGroups).mockResolvedValue([city("boise-id", "Boise, ID", "BOISE|ID", 30), city("tampa-fl", "Tampa, FL", "TAMPA|FL", 6526)]);
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(vi.mocked(listGroups)).toHaveBeenCalledWith("city");
    expect(await res.json()).toEqual([
      { label: "Tampa, FL", href: "/perm-cities/tampa-fl", keywords: "Florida" },
      { label: "Boise, ID", href: "/perm-cities/boise-id", keywords: "Idaho" },
    ]);
  });

  it("keeps the busiest 3,500 cities at most", async () => {
    const all = Array.from({ length: 3600 }, (_, i) => city(`c-${i}`, `City ${i}, TX`, `CITY ${i}|TX`, 10_000 - i));
    vi.mocked(listGroups).mockResolvedValue(all);
    const list = (await (await route.GET()).json()) as { href: string }[];
    expect(list).toHaveLength(3500);
    expect(list[0]!.href).toBe("/perm-cities/c-0");
    expect(list.at(-1)!.href).toBe("/perm-cities/c-3499");
  });

  it("answers 503 when the cities can't be read, never an empty list", async () => {
    vi.mocked(listGroups).mockRejectedValue(new Error("down"));
    expect((await route.GET()).status).toBe(503);
  });

  it("exports its handler and its refresh setting only", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "revalidate"]);
  });
});
