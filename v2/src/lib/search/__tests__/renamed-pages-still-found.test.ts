import { describe, expect, it } from "vitest";

import { matchScore } from "@/lib/search/paletteRank";
import { staticIndex } from "@/lib/search/siteIndex";

/**
 * Pages renamed on Nov 25 2026 (one name per page) stay findable by the words people searched under their old names.
 * The palette shows a page when the palette's own matcher scores it above nothing (lib/search/paletteRank.ts), read
 * against its name, its questions and its keywords as SearchPalette builds its rows.
 */
const found = (typed: string) =>
  staticIndex()
    .filter((e) => matchScore(typed, { name: e.label, keywords: e.keywords, ...(e.aliases ? { aliases: e.aliases } : {}) }) > 0)
    .map((e) => e.href);

describe("renamed pages are still found by their old words", () => {
  it.each([
    ["queue backlog", "/perm-queue"],
    ["perm queue", "/perm-queue"],
    ["cspa", "/tools/cspa-age-calculator"],
    ["child age out", "/tools/cspa-age-calculator"],
    ["family cutoffs", "/visa-bulletin/family"],
    ["green card fees", "/tools/green-card-fees"],
    ["rfi deadline", "/tools/rfi-deadline"],
    ["find a sponsor", "/sponsor-finder"],
    ["ead extension", "/tools/ead-extension"],
    ["h1b lottery calculator", "/tools/h1b-lottery-odds-calculator"],
  ])("“%s” finds %s", (typed, href) => {
    expect(found(typed)).toContain(href);
  });
});
