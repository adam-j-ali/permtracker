import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A share of counts prints through `formatShareOf`, which never rounds to a clean 0% or 100% the counts don't have:
 * a filing month 99.6% decided with 41 cases still waiting showed "100%" decided beside "41", and a category under
 * half a percent of USCIS's backlog read "0% of every I-140".
 *
 * These are the components found printing shares by hand; each now goes through the one rule. Others still round
 * by hand where the figure isn't a share of two counts or hasn't been reviewed yet; they're listed in the review.
 */
const CONVERTED = [
  "src/components/queue/BacklogWall.tsx",
  "src/components/tools/QueueMonthChart.tsx",
  "src/components/tools/I140QueueEstimator.tsx",
  "src/components/groups/CityH1b.tsx",
  "src/components/entities/FirmPrograms.tsx",
  "src/components/entities/FilingMakeup.tsx",
  "src/components/entities/LiveQueueBand.tsx",
  "src/components/entities/UnpublishedEmployer.tsx",
  "src/components/entities/CapExemptNote.tsx",
  "src/components/h1b/H1bEmployerRanks.tsx",
];

const BY_HAND = /toFixed\(0\)\}?\)?%|Math\.round\([^;{}]*?\*\s*100\)\}?%|formatShare\(\s*[\w.]+\s*\/\s*[\w.]+\s*\)/g;

function byHand(source: string): string[] {
  return [...source.matchAll(BY_HAND)].map((m) => `line ${source.slice(0, m.index).split("\n").length}: ${m[0]}`);
}

describe("shares never round to a whole the counts don't have", () => {
  it("finds a share rounded by hand, shaped like the queue wall's", () => {
    // Arrange, Act, Assert
    expect(byHand("<span>{pct.toFixed(0)}%</span>")).toHaveLength(1);
    expect(byHand("{Math.round(estimate.shareOfAllPending * 100)}% of every I-140")).toHaveLength(1);
    expect(byHand("{formatShare(city.certified / city.total)}")).toHaveLength(1);
    expect(byHand("{formatShareOf(month.decided, month.total)}")).toHaveLength(0);
  });

  it.each(CONVERTED)("%s prints its shares through formatShareOf", (path) => {
    expect(byHand(readFileSync(path, "utf8"))).toEqual([]);
  });
});
