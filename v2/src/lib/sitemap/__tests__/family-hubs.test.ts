import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FAMILY_HUBS, UNLISTED_FAMILIES } from "@/lib/sitemap/familyHubs";

/**
 * Every family of generated pages names the page that links all of it.
 *
 * A sitemap gets a page discovered; a link is how a crawler reaches it and what tells it the page matters. On Nov 21
 * 2026 Ahrefs found 3,713 of the 3,726 job title pages linked from nowhere it crawled: the family was in the sitemap
 * and had no hub. So each [param] route under (public) is either in FAMILY_HUBS, with its hub and the test that
 * proves the hub links every page (or what the hub still owes), or in UNLISTED_FAMILIES with why the sitemap leaves
 * it out. A new family fails here until it says which.
 */

const V2 = join(__dirname, "..", "..", "..", "..");
const PUBLIC = join(V2, "src", "app", "(site)", "(public)");

/** Every public route, as its URL template ("/soc-codes/[title]"), from the page files. */
function routes(): string[] {
  return (readdirSync(PUBLIC, { recursive: true }) as string[])
    .filter((f) => f.endsWith("page.tsx"))
    .map((f) => {
      const segs = relative(PUBLIC, join(PUBLIC, f)).split(/[\\/]/).slice(0, -1);
      return `/${segs.filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/")}`.replace(/\/$/, "") || "/";
    });
}

const all = routes();
const families = all.filter((r) => r.includes("["));
const statics = new Set(all.filter((r) => !r.includes("[")));
const SITEMAP = readFileSync(join(V2, "src", "lib", "sitemap", "build.ts"), "utf8");

describe("every family of generated pages names its hub", () => {
  it("found the families (a path typo would find none and pass)", () => {
    expect(families.length).toBeGreaterThan(20);
    expect(families).toContain("/soc-codes/[title]");
  });

  it("classifies every [param] route: a hub, or why the sitemap leaves it out", () => {
    const unnamed = families.filter((f) => !(f in FAMILY_HUBS) && !(f in UNLISTED_FAMILIES));
    expect(unnamed).toEqual([]);
  });

  it("names no family that no longer exists", () => {
    const known = new Set(families);
    expect([...Object.keys(FAMILY_HUBS), ...Object.keys(UNLISTED_FAMILIES)].filter((f) => !known.has(f))).toEqual([]);
  });

  it("leaves out of the sitemap only the families it says it does", () => {
    for (const f of Object.keys(UNLISTED_FAMILIES)) expect(SITEMAP, f).not.toContain(`"${f}"`);
  });

  it("points every family at a hub that exists and reaches a fixed page", () => {
    for (const [family, { hub }] of Object.entries(FAMILY_HUBS)) {
      const seen = new Set<string>([family]);
      let at = hub;
      // A hub may itself be a family (a title's letter page), so follow the chain to a page of fixed address.
      while (!statics.has(at)) {
        expect(at in FAMILY_HUBS, `${family}: hub ${at} is neither a page nor a family with a hub`).toBe(true);
        expect(seen.has(at), `${family}: hubs loop at ${at}`).toBe(false);
        seen.add(at);
        at = FAMILY_HUBS[at]!.hub;
      }
    }
  });

  it("backs every hub with a test that proves it links every page, or says what it still owes", () => {
    for (const [family, h] of Object.entries(FAMILY_HUBS)) {
      expect(Boolean(h.proof) || Boolean(h.owed), family).toBe(true);
      if (!h.proof) continue;
      const file = join(V2, h.proof.test);
      expect(existsSync(file), `${family}: ${h.proof.test}`).toBe(true);
      expect(readFileSync(file, "utf8"), `${family}: ${h.proof.test} must test ${h.proof.mark}`).toContain(h.proof.mark);
    }
  });
});
