import { describe, expect, it } from "vitest";

import {
  NATION,
  certifiedShare,
  filingSplit,
  firmRanksAsOf,
  firstRankedYear,
  lastYearWords,
  ordinal,
  rankedPlaces,
  rankedStates,
  shownYear,
  type FirmRanksSummary,
} from "@/lib/firmRanks";

const t = (filings: number) => ({ filings, firms: 3, top10: filings, unnamed: 1 });

const summary: FirmRanksSummary = {
  programs: {
    perm: {
      years: {
        "2024": { through: "2024-09-30", places: { US: t(10), CA: t(4) } },
        "2025": { through: "2025-09-30", places: { US: t(12), TX: t(5), CA: t(3) } },
        // DOL's newest file runs to June: the year isn't finished.
        "2026": { through: "2026-06-30", places: { US: t(9), NY: t(2) } },
      },
    },
    lca: {
      years: {
        "2025": { through: "2025-09-29", places: { US: t(30), WA: t(8) } },
      },
    },
  },
};

describe("firstRankedYear", () => {
  it("is the first fiscal year that ranks any firm in the country, never a year whose files name none", () => {
    const withOld: FirmRanksSummary = {
      programs: {
        // DOL's PERM files name no law firm before FY2015, so those years rank nobody.
        perm: {
          years: {
            "2008": { through: "2008-09-30", places: { US: { filings: 0, firms: 0, top10: 0, unnamed: 900 } } },
            "2015": { through: "2015-09-30", places: { US: t(20) } },
            ...summary.programs.perm.years,
          },
        },
        lca: summary.programs.lca,
      },
    };
    expect(firstRankedYear(withOld, "perm")).toBe(2015);
    expect(firstRankedYear(withOld, "lca")).toBe(2025);
    expect(firstRankedYear({ programs: { perm: { years: {} }, lca: { years: {} } } }, "perm")).toBeNull();
  });
});

describe("shownYear", () => {
  it("shows the newest fiscal year whose decisions run to its last week, not one still loading", () => {
    expect(shownYear(summary, "perm")).toBe(2025);
    expect(shownYear(summary, "lca")).toBe(2025);
  });

  it("falls back to the newest year when none is finished", () => {
    const s: FirmRanksSummary = {
      programs: { perm: { years: { "2026": { through: "2026-06-30", places: {} } } }, lca: { years: {} } },
    };
    expect(shownYear(s, "perm")).toBe(2026);
    expect(shownYear(s, "lca")).toBeNull();
  });
});

describe("places", () => {
  it("lists the country first, then states by code", () => {
    expect(rankedPlaces(summary, "perm", 2025)).toEqual([NATION, "CA", "TX"]);
  });

  it("gives a page to every state either program's shown year ranks, and only those", () => {
    // NY is ranked only in the unfinished FY2026, so it has no page yet.
    expect(rankedStates(summary)).toEqual(["CA", "TX", "WA"]);
  });
});

describe("the page's date", () => {
  it("is the newest decision day either shown year holds", () => {
    expect(firmRanksAsOf(summary)).toBe("2025-09-30");
    expect(firmRanksAsOf(null)).toBeNull();
  });
});

describe("a row in words", () => {
  it("orders like English", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th",
    ]);
  });

  it("says where a firm stood the year before, or that it had no filings", () => {
    expect(lastYearWords(3)).toBe("3rd the year before");
    expect(lastYearWords(null)).toBe("no filings the year before");
  });

  it("leaves withdrawals out of the certified share, and has none with nothing decided", () => {
    expect(certifiedShare({ certified: 9, denied: 1 })).toBe(0.9);
    expect(certifiedShare({ certified: 0, denied: 0 })).toBeNull();
  });
});

describe("filingSplit", () => {
  it("splits every filing into the ten busiest, every other firm and no firm, adding up", () => {
    const s = filingSplit({ filings: 100, firms: 40, top10: 60, unnamed: 25 });
    expect(s).toEqual({ top10: 60, others: 40, unnamed: 25, all: 125 });
    expect(s.top10 + s.others + s.unnamed).toBe(s.all);
  });

  it("gives a place with under ten firms nothing for every other firm", () => {
    expect(filingSplit({ filings: 7, firms: 2, top10: 7, unnamed: 0 })).toEqual({ top10: 7, others: 0, unnamed: 0, all: 7 });
  });
});
