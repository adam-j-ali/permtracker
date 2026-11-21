import { describe, expect, it } from "vitest";

import knownRoutes from "../../../../scripts/known-routes.json";
import { AUDIT_BUDGET, FIXED_ROUTES, pickAuditPaths, routeShape, splitPages } from "../audit";

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}/${i + 1}`);

describe("routeShape", () => {
  it("names the template a path renders", () => {
    expect(routeShape("/")).toBe("/");
    expect(routeShape("/about")).toBe("/about");
    expect(routeShape("/soc-codes/software-engineer")).toBe("/soc-codes/:slug");
    expect(routeShape("/visa-bulletin/categories/eb1-india")).toBe("/visa-bulletin/categories/:slug");
  });
});

describe("splitPages", () => {
  const paths = [
    "/",
    "/about",
    "/guides/a",
    "/guides/b",
    "/guides/c",
    "/guides/d",
    "/tools/x",
    "/perm-employers/browse",
    "/perm-employers/under-review",
    ...range("/soc-codes", 50),
  ];
  const { fixed, families } = splitPages(paths);

  it("lists every hand-built page, article and tool", () => {
    expect(fixed).toEqual(
      expect.arrayContaining(["/", "/about", "/guides/a", "/guides/d", "/tools/x", "/perm-employers/browse", "/perm-employers/under-review"]),
    );
  });

  it("treats a large shape outside the articles as a template", () => {
    expect(fixed).not.toContain("/soc-codes/1");
    expect(families).toEqual([{ name: "/soc-codes/:slug", paths: range("/soc-codes", 50) }]);
  });

  // A page with its own route can share its address's shape with a family: /soc-codes/browse with 3,888 job title
  // pages, /visa-bulletin/family with the bulletin months. Measured Nov 21 2026: three of 251 fixed pages were left out
  // of the live audit list that way. The route list says which are fixed, whatever the shape.
  it("lists a page with its own route even when its address looks like a family's", () => {
    const got = splitPages(["/soc-codes/browse", ...range("/soc-codes", 50), "/visa-bulletin/family", ...range("/visa-bulletin", 30)], new Set(["/soc-codes/browse", "/visa-bulletin/family"]));
    expect(got.fixed).toEqual(expect.arrayContaining(["/soc-codes/browse", "/visa-bulletin/family"]));
    expect(got.families.flatMap((f) => f.paths)).not.toContain("/soc-codes/browse");
    expect(got.families.find((f) => f.name === "/soc-codes/:slug")?.paths).toEqual(range("/soc-codes", 50));
  });

  it("takes the fixed routes from the site's route list, the three missed ones included", () => {
    expect(FIXED_ROUTES.size).toBe(knownRoutes.length);
    for (const p of ["/soc-codes/browse", "/visa-bulletin/categories", "/visa-bulletin/family", "/about", "/"]) {
      if ((knownRoutes as string[]).includes(p)) expect(FIXED_ROUTES.has(p)).toBe(true);
    }
    expect(FIXED_ROUTES.has("/soc-codes/browse")).toBe(true);
  });
});

describe("pickAuditPaths", () => {
  const fixed = ["/", "/about", "/guides/a"];
  const families = [
    { name: "/soc-codes/:slug", paths: range("/soc-codes", 400) },
    { name: "/perm-cities/:slug", paths: range("/perm-cities", 5000) },
    { name: "/perm-queue/:slug", paths: range("/perm-queue", 10) },
  ];

  it("never passes the budget, and lists no page twice", () => {
    for (const budget of [20, 100, 1000]) {
      const list = pickAuditPaths(fixed, families, budget);
      expect(list.length).toBe(Math.min(budget, 3 + 400 + 5000 + 10));
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("keeps a weekly crawl inside the free 5,000 credits a month, five Fridays included", () => {
    // Ahrefs gives a verified project 5,000 crawl credits a month (help.ahrefs.com, article 3119402), and a month
    // can hold five weekly crawls. A list of 4,500 would be crawled once and the next three refused.
    expect(AUDIT_BUDGET * 5).toBeLessThanOrEqual(5000);
    expect(AUDIT_BUDGET).toBeLessThanOrEqual(4500);
  });

  it("lists the hand-built pages and one page of every template", () => {
    const list = pickAuditPaths(fixed, families, 100);
    expect(list).toEqual(expect.arrayContaining([...fixed, "/soc-codes/1", "/perm-cities/1", "/perm-queue/1"]));
  });

  it("gives a small template all its pages, and what it leaves to the bigger ones", () => {
    const list = pickAuditPaths(fixed, families, 100);
    expect(list.filter((p) => p.startsWith("/perm-queue/")).length).toBe(10);
    const soc = list.filter((p) => p.startsWith("/soc-codes/")).length;
    const cities = list.filter((p) => p.startsWith("/perm-cities/")).length;
    // 100 - 3 fixed - 3 first pages - 9 queue pages = 85 for the two big ones.
    expect(soc + cities).toBe(85 + 2);
    expect(Math.abs(soc - cities)).toBeLessThanOrEqual(1);
  });

  it("takes each template's pages from the top, the order its sitemap gives (the busiest first)", () => {
    const list = pickAuditPaths(fixed, families, 100);
    const soc = list.filter((p) => p.startsWith("/soc-codes/"));
    expect(soc).toEqual(range("/soc-codes", soc.length));
    expect(list).not.toContain("/perm-cities/4000");
  });

  it("is the same list every time it's asked, so one week's crawl compares with the last", () => {
    const first = pickAuditPaths(fixed, families, 100);
    for (let i = 0; i < 3; i += 1) expect(pickAuditPaths(fixed, families, 100)).toEqual(first);
  });

  it("cuts to the budget when the hand-built pages alone pass it", () => {
    const many = range("/guides", 50);
    expect(pickAuditPaths(many, families, 20)).toEqual(many.slice(0, 20));
  });
});
