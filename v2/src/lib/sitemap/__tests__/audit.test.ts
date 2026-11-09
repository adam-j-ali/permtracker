import { describe, expect, it } from "vitest";

import { AUDIT_BUDGET, auditWeek, pickAuditPaths, routeShape, splitPages } from "../audit";

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}/${i + 1}`);

describe("routeShape", () => {
  it("names the template a path renders", () => {
    expect(routeShape("/")).toBe("/");
    expect(routeShape("/about")).toBe("/about");
    expect(routeShape("/soc-codes/software-engineer")).toBe("/soc-codes/:slug");
    expect(routeShape("/visa-bulletin/categories/eb1-india")).toBe("/visa-bulletin/categories/:slug");
  });
});

describe("auditWeek", () => {
  it("counts weeks from the Monday the rotation starts, and never goes negative", () => {
    expect(auditWeek(Date.UTC(2026, 10, 9))).toBe(0);
    expect(auditWeek(Date.UTC(2026, 10, 15, 23))).toBe(0);
    expect(auditWeek(Date.UTC(2026, 10, 16))).toBe(1);
    expect(auditWeek(Date.UTC(2026, 0, 1))).toBe(0);
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
  const { weekly, families } = splitPages(paths);

  it("crawls every hand-built page, article and tool each week", () => {
    expect(weekly).toEqual(
      expect.arrayContaining(["/", "/about", "/guides/a", "/guides/d", "/tools/x", "/perm-employers/browse", "/perm-employers/under-review"]),
    );
  });

  it("treats a large shape outside the articles as a template", () => {
    expect(weekly).not.toContain("/soc-codes/1");
    expect(families).toEqual([{ name: "/soc-codes/:slug", paths: range("/soc-codes", 50) }]);
  });
});

describe("pickAuditPaths", () => {
  const weekly = ["/", "/about", "/guides/a"];
  const families = [
    { name: "/soc-codes/:slug", paths: range("/soc-codes", 400) },
    { name: "/perm-cities/:slug", paths: range("/perm-cities", 5000) },
    { name: "/perm-queue/:slug", paths: range("/perm-queue", 10) },
  ];

  it("never passes the budget, and lists no page twice", () => {
    for (const week of [0, 1, 7, 300]) {
      const list = pickAuditPaths(weekly, families, week, 100);
      expect(list.length).toBe(100);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("keeps the default budget inside five weekly crawls of the free 5,000 credits", () => {
    expect(AUDIT_BUDGET * 5).toBeLessThanOrEqual(5000);
  });

  it("crawls the weekly pages and one page of every template, every week", () => {
    for (const week of [0, 3, 51]) {
      const list = pickAuditPaths(weekly, families, week, 100);
      expect(list).toEqual(expect.arrayContaining([...weekly, "/soc-codes/1", "/perm-cities/1", "/perm-queue/1"]));
    }
  });

  it("gives a small template all its pages, and what it leaves to the bigger ones", () => {
    const list = pickAuditPaths(weekly, families, 0, 100);
    expect(list.filter((p) => p.startsWith("/perm-queue/")).length).toBe(10);
    const soc = list.filter((p) => p.startsWith("/soc-codes/")).length;
    const cities = list.filter((p) => p.startsWith("/perm-cities/")).length;
    // 100 - 3 weekly - 3 first pages - 9 queue pages = 85 for the two big ones.
    expect(soc + cities).toBe(85 + 2);
    expect(Math.abs(soc - cities)).toBeLessThanOrEqual(1);
  });

  it("moves each template's window every week, and covers it all in turn", () => {
    const seen = new Set<string>();
    const week0 = pickAuditPaths(weekly, families, 0, 100);
    const week1 = pickAuditPaths(weekly, families, 1, 100);
    expect(week1.filter((p) => p.startsWith("/soc-codes/") && p !== "/soc-codes/1")).not.toEqual(
      week0.filter((p) => p.startsWith("/soc-codes/") && p !== "/soc-codes/1"),
    );
    for (let week = 0; week < 400 / 42 + 1; week += 1) {
      for (const p of pickAuditPaths(weekly, families, week, 100)) if (p.startsWith("/soc-codes/")) seen.add(p);
    }
    expect(seen.size).toBe(400);
  });

  it("starts with the top of each template, the order its sitemap gives", () => {
    const list = pickAuditPaths(weekly, families, 0, 100);
    expect(list).toContain("/soc-codes/2");
    expect(list).toContain("/perm-cities/2");
    expect(list).not.toContain("/perm-cities/4000");
  });

  it("cuts to the budget when the weekly pages alone pass it", () => {
    const many = range("/guides", 50);
    expect(pickAuditPaths(many, families, 0, 20)).toEqual(many.slice(0, 20));
  });
});
