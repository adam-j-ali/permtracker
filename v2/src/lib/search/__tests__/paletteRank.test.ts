import { describe, expect, it } from "vitest";

import { MATCH, matchScore, rankGroups, type RankGroup, type Rankable } from "../paletteRank";

/**
 * The search palette's order, worked out in React (D14): cmdk 1.1.1 couldn't move a group whose name has a space,
 * so a page named exactly as typed could sit sixth. A row's score is its band (an exact name, the words at a word's
 * start, the words inside a word, the words only in its keywords, a near spelling) plus how close it is within the
 * band; a group goes where its best row puts it.
 */

const row = (name: string, extra: Partial<Rankable> = {}): Rankable => ({ name, ...extra });
const band = (s: number) => Math.floor(s);

describe("matchScore", () => {
  it("puts an exact name above every other kind of match", () => {
    expect(band(matchScore("visa bulletin", row("Visa bulletin")))).toBe(MATCH.exact);
    expect(matchScore("Visa Bulletin!", row("visa bulletin"))).toBe(matchScore("visa bulletin", row("Visa bulletin")));
  });

  it("reads the typed words at the start of the name, then at a word's start, then inside a word", () => {
    const start = matchScore("tampa", row("Tampa field office: I-485 numbers"));
    const later = matchScore("field office", row("Tampa field office: I-485 numbers"));
    const words = matchScore("office tampa", row("Tampa field office: I-485 numbers"));
    const inside = matchScore("ampa", row("Tampa field office: I-485 numbers"));
    expect(band(start)).toBe(MATCH.phrase);
    expect(band(later)).toBe(MATCH.phrase);
    expect(start).toBeGreaterThan(later);
    expect(band(words)).toBe(MATCH.words);
    expect(band(inside)).toBe(MATCH.inside);
  });

  it("counts a plural as the same word", () => {
    expect(band(matchScore("i-140 times", row("I-140 processing time")))).toBe(MATCH.words);
    expect(band(matchScore("receipt block", row("USCIS receipt blocks")))).toBe(MATCH.phrase);
  });

  it("reads a form or program name typed without its hyphen", () => {
    expect(band(matchScore("i140", row("I-140 processing time")))).toBe(MATCH.phrase);
    expect(band(matchScore("h1b employers", row("H-1B employers")))).toBe(MATCH.phrase);
  });

  it("prefers the shorter of two names the words open", () => {
    expect(matchScore("tampa", row("Tampa, FL"))).toBeGreaterThan(matchScore("tampa", row("Tampa General Hospital")));
  });

  it("reads a question the page answers like its name", () => {
    const page = row("USCIS receipt blocks", { aliases: ["Which receipt block is USCIS processing?"] });
    expect(band(matchScore("which receipt block", page))).toBe(MATCH.phrase);
    expect(band(matchScore("which receipt block", row("USCIS receipt blocks")))).toBeLessThan(MATCH.phrase);
  });

  it("ranks words found only in the keywords below any match on the name", () => {
    const keyed = matchScore("microsoft", row("PERM layoff disclosures", { keywords: "layoff microsoft" }));
    expect(band(keyed)).toBe(MATCH.keywords);
    expect(keyed).toBeLessThan(matchScore("microsoft", row("Microsoft Corporation")));
  });

  it("still finds a swapped or missing letter, below every exact kind of match", () => {
    const typo = matchScore("proecssing times", row("PERM processing times"));
    expect(typo).toBeGreaterThan(0);
    expect(typo).toBeLessThan(MATCH.keywords);
  });

  it("scores nothing for a row the words don't reach, and nothing for no words", () => {
    expect(matchScore("zzqx", row("Tampa, FL"))).toBe(0);
    expect(matchScore("   ", row("Tampa, FL"))).toBe(0);
  });
});

interface Row extends Rankable {
  id: string;
}
const r = (id: string, name: string, extra: Partial<Rankable> = {}): Row => ({ id, name, ...extra });
const ids = (groups: { rows: readonly Row[] }[]) => groups.map((g) => g.rows.map((x) => x.id));

describe("rankGroups", () => {
  const groups: RankGroup<Row>[] = [
    { heading: "Go to", priority: 4, rows: [r("blocks", "USCIS receipt blocks"), r("status", "USCIS case status", { keywords: "receipt" })] },
    { heading: "USCIS offices", priority: 4, rows: [r("tpa-fo", "Tampa field office: I-485 numbers")] },
    { heading: "Cities", priority: 2, limit: 2, rows: [r("nyc", "New York, NY"), r("tpa", "Tampa, FL"), r("tpe", "Tempe, AZ")] },
    { heading: "Articles", priority: 1, rows: [r("a1", "How to read a USCIS receipt number")] },
  ];

  it("orders groups by their best row, and rows by their score", () => {
    const out = rankGroups("receipt block", groups);
    expect(out[0]!.heading).toBe("Go to");
    expect(out[0]!.rows[0]!.id).toBe("blocks");
  });

  it("breaks a tie between equally good matches by the group's priority: the site's own pages first", () => {
    const out = rankGroups("tampa", groups);
    expect(out.map((g) => g.heading)).toEqual(["USCIS offices", "Cities"]);
  });

  it("drops groups and rows that match nothing, and cuts a group to its limit", () => {
    const out = rankGroups("new york", groups);
    expect(out.map((g) => g.heading)).toEqual(["Cities"]);
    expect(ids(rankGroups("ne", [{ heading: "Cities", priority: 2, limit: 1, rows: groups[2]!.rows }]))).toEqual([["nyc"]]);
  });

  it("keeps rows chosen elsewhere in their order and shows each, scored or not", () => {
    const given: RankGroup<Row> = {
      heading: "In the data",
      priority: 3,
      given: true,
      rows: [r("e2", "Tampa General Hospital"), r("e1", "Moffitt Cancer Center"), r("more", "Every employer matching tampa", { unranked: true })],
    };
    const out = rankGroups("tampa", [given]);
    expect(ids(out)).toEqual([["e2", "e1", "more"]]);
    // The "every match" row says the query back, so it never lifts its group.
    expect(out[0]!.best).toBe(matchScore("tampa", given.rows[0]!));
    // The same rows no longer given (the answer to an older query): only those that still match, and never the
    // row that names the older query.
    expect(ids(rankGroups("tampa", [{ ...given, given: false }]))).toEqual([["e2"]]);
  });

  it("counts names the server chose as a match on a name, above pages that only mention the words", () => {
    const guesses: RankGroup<Row> = { heading: "Did you mean", priority: 0, given: true, rows: [r("ms", "Microsoft Corporation")] };
    const mention: RankGroup<Row> = { heading: "Go to", priority: 4, rows: [r("layoffs", "PERM layoff disclosures", { keywords: "microsfot" })] };
    const named: RankGroup<Row> = { heading: "Go to", priority: 4, rows: [r("ms-page", "Microsfot tracker")] };
    expect(rankGroups("microsfot", [mention, guesses]).map((g) => g.heading)).toEqual(["Did you mean", "Go to"]);
    expect(rankGroups("microsfot", [guesses, named]).map((g) => g.rows[0]!.id)).toEqual(["ms-page", "ms"]);
  });

  it("lists a long list's near spellings only when nothing in it matches better", () => {
    const cities: RankGroup<Row> = {
      heading: "Cities",
      priority: 2,
      longList: true,
      rows: [r("nampa", "Nampa, ID"), r("tpa", "Tampa, FL"), r("sea", "Seattle, WA")],
    };
    expect(ids(rankGroups("tampa", [cities]))).toEqual([["tpa"]]);
    expect(ids(rankGroups("tampa", [{ ...cities, longList: false }]))).toEqual([["tpa", "nampa"]]);
    // A typo with no exact match still finds the city, through the list's letter index, under every exact match.
    const typo = rankGroups("seatle", [cities]);
    expect(ids(typo)).toEqual([["sea"]]);
    expect(typo[0]!.best).toBeGreaterThan(0);
    expect(typo[0]!.best).toBeLessThan(MATCH.keywords);
  });

  it("keeps the input order between rows that score the same", () => {
    const same: RankGroup<Row> = { heading: "Consulates", priority: 4, rows: [r("b", "Mumbai: visas"), r("a", "Mumbai: visas")] };
    expect(ids(rankGroups("mumbai", [same]))).toEqual([["b", "a"]]);
  });

  it("returns nothing for an empty query", () => {
    expect(rankGroups("  ", groups)).toEqual([]);
  });
});
