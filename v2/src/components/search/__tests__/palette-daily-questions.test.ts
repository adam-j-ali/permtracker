import { describe, expect, it } from "vitest";

import { rankFuzzy } from "@/lib/fuzzy";
import { staticIndex } from "@/lib/search/siteIndex";

/**
 * The questions people ask about the day each lead to the one page that answers them, first in the
 * palette's page matches (the same ranking and floor as PageMatches in NameGroups.tsx). Two daily pages
 * exist with distinct jobs: the day's decisions (/perm-updates) and where every step stands (/today).
 */
const first = (q: string) =>
  rankFuzzy(q, staticIndex(), (p) => [p.label, p.keywords], { limit: 3, min: 0.8 })[0]?.item.href;

describe("the palette's answers to the daily questions", () => {
  it.each(["how many decided today", "decided today", "today's decisions", "how many certified today", "perm decisions today"])(
    "%s → the day's decisions",
    (q) => {
      expect(first(q)).toBe("/perm-updates");
    },
  );

  it.each(["where every step stands", "every step today"])("%s → where every step stands", (q) => {
    expect(first(q)).toBe("/today");
  });
});
