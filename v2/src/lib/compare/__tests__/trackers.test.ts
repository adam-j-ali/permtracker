import { describe, expect, it } from "vitest";

import { RIVALS } from "../rivals";
import { checkedPhrase, compareFaq, GROUPS, nameList, namesWhere, PERM_TRACKER, ROWS } from "../trackers";

/**
 * The comparison names other sites, so every mark on one of them has to be
 * something a reader can check: where it was read, in its own words or with
 * what was looked at, on the day the page says.
 */

const words = (s: string) => s.trim().split(/\s+/).length;

describe("the PERM tracker comparison", () => {
  it("fills every question for every site", () => {
    for (const t of [PERM_TRACKER, ...RIVALS]) {
      for (const r of ROWS) expect(t.cells[r.key], `${t.slug} ${r.key}`).toBeDefined();
    }
  });

  it("dates every site to a real day, which the page names", () => {
    const phrase = checkedPhrase(RIVALS.map((t) => t.checkedOn));
    for (const t of [PERM_TRACKER, ...RIVALS]) {
      expect(t.checkedOn, t.slug).toMatch(/^2\d{3}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${t.checkedOn}T12:00:00Z`)), t.slug).toBe(false);
    }
    for (const day of new Set(RIVALS.map((t) => t.checkedOn))) {
      expect(phrase, day).toContain(String(Number(day.slice(8, 10))));
    }
  });

  it("words the reading days plainly", () => {
    expect(checkedPhrase(["2026-10-27"])).toBe("October 27, 2026");
    expect(checkedPhrase(["2026-10-28", "2026-10-27", "2026-10-27"])).toBe("October 27 and 28, 2026");
    expect(checkedPhrase(["2026-10-27", "2026-10-28", "2026-10-30"])).toBe("October 27, 28 and 30, 2026");
    expect(checkedPhrase(["2026-10-31", "2026-11-02"])).toBe("October 31, 2026 and November 2, 2026");
  });

  it("puts every site in one of the page's lists, this one among the PERM trackers", () => {
    const keys = GROUPS.map((g) => g.key) as string[];
    for (const t of [PERM_TRACKER, ...RIVALS]) expect(keys, t.slug).toContain(t.group);
    expect(PERM_TRACKER.group).toBe("perm");
    // A list's columns sit together, so the grid's header over each list is one span.
    const order = RIVALS.map((t) => t.group);
    expect(order.filter((g, i) => i > 0 && g !== order[i - 1]).length, order.join(",")).toBeLessThan(GROUPS.length);
  });

  it("names each site once", () => {
    const slugs = [PERM_TRACKER, ...RIVALS].map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("rests every mark on a rival on a page, with its words or what was checked", () => {
    for (const t of RIVALS) {
      for (const r of ROWS) {
        const c = t.cells[r.key];
        if (c.mark === "unknown") continue;
        expect(c.evidence?.url, `${t.slug} ${r.key}`).toMatch(/^https:\/\//);
        expect(Boolean(c.evidence?.quote || c.note), `${t.slug} ${r.key}: a quote or a note`).toBe(true);
        if (c.mark === "no" && !c.evidence?.quote) expect(c.note, `${t.slug} ${r.key}: what was checked`).toBeTruthy();
      }
    }
  });

  it("keeps every quote short, and never a link to our own site", () => {
    for (const t of RIVALS) {
      for (const r of ROWS) {
        const q = t.cells[r.key].evidence?.quote;
        if (q) expect(words(q), `${t.slug} ${r.key}`).toBeLessThanOrEqual(25);
        expect(t.cells[r.key].evidence?.url ?? "").not.toMatch(/permtracker\.app/);
      }
    }
  });

  it("dates each rival's newest data from its own stamp", () => {
    for (const t of RIVALS) {
      if (!t.newestData.day) continue;
      expect(t.newestData.day <= t.checkedOn, t.slug).toBe(true);
      expect(t.newestData.evidence?.quote, t.slug).toBeTruthy();
    }
  });

  it("claims nothing for this site it can't link", () => {
    for (const r of ROWS) {
      const c = PERM_TRACKER.cells[r.key];
      expect(c.mark, r.key).not.toBe("unknown");
    }
  });

  it("says who each site suits and where its data comes from, in one short line each", () => {
    for (const t of [PERM_TRACKER, ...RIVALS]) {
      expect(t.bestFor.length, `${t.slug} bestFor`).toBeGreaterThan(10);
      expect(t.bestFor.length, `${t.slug} bestFor`).toBeLessThanOrEqual(100);
      expect(t.dataFrom.length, `${t.slug} dataFrom`).toBeGreaterThan(10);
      expect(t.dataFrom.length, `${t.slug} dataFrom`).toBeLessThanOrEqual(90);
    }
    // Our own entry never claims to beat ourselves.
    expect(PERM_TRACKER.beatsUs).toEqual([]);
  });

  // Two of the names here are two letters apart, and a search engine's AI answered that they were one site
  // (Nov 10 2026). The page that lists both says plainly that they aren't, as a question a machine reads too.
  it("says in plain words that a site with a similar name is another site, by its own address", () => {
    const all = [PERM_TRACKER, ...RIVALS];
    const same = compareFaq(all).find((f) => f.q === "Is PERM Tracker the same site as PermTrack?");
    expect(same).toBeDefined();
    expect(same!.a.startsWith("No.")).toBe(true);
    expect(same!.a).toContain("permtracker.app");
    expect(same!.a).toContain("permtrack.app");
    expect(same!.a).toMatch(/Neither is affiliated with the other\.$/);
    // Which came first is said as two dates from the registry's record, and in no other words.
    expect(same!.a).toContain("permtracker.app registered on November 25, 2025, and permtrack.app on March 22, 2026.");
    expect(same!.a).not.toMatch(/original|older|newer|better|first/i);
    // Only while that site is on the page: the question is about a name the reader can see beside ours.
    expect(compareFaq(all.filter((t) => t.slug !== "permtrack")).some((f) => /same site/.test(f.q))).toBe(false);
  });

  it("answers the choosing questions from the marks themselves", () => {
    const all = [PERM_TRACKER, ...RIVALS];
    const faq = compareFaq(all);
    expect(faq.length).toBeGreaterThanOrEqual(5);
    for (const f of faq) {
      expect(f.a.trim().endsWith("."), f.q).toBe(true);
      expect(f.a.charAt(0), f.q).toMatch(/[A-Z]/);
    }
    // A site marked free with no ads is named under that answer, and one with ads isn't.
    const free = faq.find((f) => f.q.startsWith("Which are free"))!.a;
    const clean = all.filter((t) => t.cells.free.mark === "yes" && t.cells.noAds.mark === "yes");
    const withAds = all.filter((t) => t.cells.free.mark === "yes" && t.cells.noAds.mark !== "yes");
    expect(free.split("Free with ads")[0]).toContain(nameList(namesWhere(clean, "free", ["yes"])));
    for (const t of withAds) expect(free.split("Free with ads")[0], t.slug).not.toContain(`${t.name},`);
    // A free site with no ad code yet (a "partial" mark) is named in its own sentence, never under "Free with ads".
    const later = all.filter((t) => t.cells.free.mark === "yes" && t.cells.noAds.mark === "partial");
    const adsLine = free.split(". ").find((x) => x.startsWith("Free with ads")) ?? "";
    for (const t of later) {
      expect(free, t.slug).toContain("ads named in their policy or planned");
      expect(adsLine, t.slug).not.toContain(t.name);
    }
  });

  it("lists names in a sentence the plain way", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["A"])).toBe("A");
    expect(nameList(["A", "B"])).toBe("A and B");
    expect(nameList(["A", "B", "C"])).toBe("A, B and C");
  });
});

