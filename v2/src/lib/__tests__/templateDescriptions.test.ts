import { describe, expect, it } from "vitest";

import { consularDescription } from "@/lib/consular/describe";
import { groupDescription, h1bCityDescription } from "@/lib/groupDescription";
import { titleLetterDescription } from "@/lib/socTitleBrowse";
import { socTitleDescription, type SocTitleFacts } from "@/lib/socTitleDescription";

/**
 * The search descriptions the dynamic templates build hold to 110 to 160 characters for the shortest and the
 * longest real inputs. Ahrefs' Nov 21 2026 crawl found 659 job-title pages at about 83 characters ("Vice
 * President, Quantitative Engineering: SOC code 13-2099 in 87% of DOL's filings.") and the Ho Chi Minh City
 * consulate at 161. Bing reports under 150 or so as short, Google cuts near 155; the static gate
 * (page-description-length.test.ts) can't see these because one generateMetadata serves every slug.
 */
const MIN = 110;
const MAX = 160;

function inWindow(text: string): void {
  expect(text.length, `${text.length}: ${text}`).toBeGreaterThanOrEqual(MIN);
  expect(text.length, `${text.length}: ${text}`).toBeLessThanOrEqual(MAX);
}

const code = (soc: string, codeTitle: string, filings: number) => ({ soc, codeTitle, filings });

// Real titles from soc_title_pages (Nov 20 2026): the four 60-character ones, the shortest, and the task's example.
const LONG_CODE_TITLE = "Secretaries and Administrative Assistants, Except Legal, Medical, and Executive";
const SOC_CASES: Array<[string, SocTitleFacts]> = [
  ["the Ahrefs example", { title: "Vice President, Quantitative Engineering", total: 87, codes: [code("13-2099", "Financial Specialists, All Other", 76), code("15-2041", "Statisticians", 11)], pay: 81_000 }],
  ["a 60-character title", { title: "Senior Associate JC60 -Computer Systems Engineers/Architects", total: 5603, codes: [code("15-1299", "Computer Occupations, All Other", 5602)], pay: 106_000 }],
  ["a 60-character title on a long code", { title: "Landscaping and Groundskeeping Workers (General Landscapers)", total: 67, codes: [code("43-6014", LONG_CODE_TITLE, 60), code("37-3011", "Landscaping and Groundskeeping Workers", 7)], pay: null }],
  ["a two-letter title", { title: "RN", total: 70, codes: [code("29-1141", "Registered Nurses", 67)], pay: null }],
  ["a three-letter title, no pay", { title: "CEO", total: 51, codes: [code("11-1011", "Chief Executives", 40), code("11-1021", "General and Operations Managers", 8), code("11-9199", "Managers, All Other", 3)], pay: null }],
  ["the busiest title", { title: "Software Engineer", total: 211_337, codes: [code("15-1252", "Software Developers", 190_000), code("15-1132", "Software Developers, Applications", 12_000), code("15-1299", "Computer Occupations, All Other", 5_000)], pay: 133_080 }],
  ["a title with no filed code", { title: "RN", total: 70, codes: [], pay: null }],
];

describe("job title descriptions", () => {
  for (const [name, facts] of SOC_CASES) {
    it(`fits the window: ${name}`, () => inWindow(socTitleDescription(facts)));
  }

  it("aims for 120 or more where the page has the figures to say it", () => {
    for (const [, facts] of SOC_CASES.slice(0, 6)) expect(socTitleDescription(facts).length).toBeGreaterThanOrEqual(120);
  });

  it("says only figures the page shows: the code, its share, the filings and the pay", () => {
    const d = socTitleDescription(SOC_CASES[0]![1]);
    expect(d).toContain("Vice President, Quantitative Engineering");
    expect(d).toContain("13-2099");
    expect(d).toContain("87%");
    expect(d).toContain("87 ");
    // No pay was given, so none is printed.
    expect(socTitleDescription(SOC_CASES[3]![1])).not.toMatch(/\$/);
  });

  it("would have caught the 83-character description that shipped (control)", () => {
    expect("Vice President, Quantitative Engineering: SOC code 13-2099 in 87% of DOL's filings.".length).toBeLessThan(MIN);
  });
});

// Census titles run to 126 characters; cities and countries are short.
const INDUSTRY_LONG = "Instruments and Related Products Manufacturing for Measuring, Displaying, and Controlling Industrial Process Variables";
const GROUP_CASES = [
  { name: "the longest industry", kind: "industry" as const, label: INDUSTRY_LONG, key: "334513", total: 2_310, fyFrom: 2016, fyTo: 2026 },
  { name: "the Ahrefs industry", kind: "industry" as const, label: "Administrative Management and General Management Consulting Services", key: "541611", total: 14_056, fyFrom: 2016, fyTo: 2026 },
  { name: "a short industry, one decision, no years", kind: "industry" as const, label: "Wineries", key: "312130", total: 1, fyFrom: null, fyTo: null },
  { name: "a short city", kind: "city" as const, label: "Ada, OK", key: "ada-ok", total: 21, fyFrom: 2016, fyTo: 2026 },
  { name: "a short city, no years", kind: "city" as const, label: "Ada, OK", key: "ada-ok", total: 21, fyFrom: null, fyTo: null },
  { name: "a long country", kind: "country" as const, label: "Saint Vincent and the Grenadines", key: "saint-vincent", total: 230, fyFrom: 2016, fyTo: 2024 },
  { name: "a short country", kind: "country" as const, label: "Chad", key: "chad", total: 21, fyFrom: 2016, fyTo: 2024 },
];

describe("city, industry and country descriptions", () => {
  for (const c of GROUP_CASES) {
    it(`fits the window: ${c.name}`, () => inWindow(groupDescription(c)));
  }

  it("names the industry's code", () => {
    for (const c of GROUP_CASES.filter((g) => g.kind === "industry")) expect(groupDescription(c)).toContain(c.key);
  });
});

describe("H-1B-only city descriptions", () => {
  it("fits the window for a small town and a long name", () => {
    inWindow(h1bCityDescription({ label: "Ada, OK", total: 21, certified: 20, fyFrom: 2024, fyTo: 2026 }));
    inWindow(h1bCityDescription({ label: "Ada, OK", total: 21, certified: 20, fyFrom: null, fyTo: null }));
    inWindow(h1bCityDescription({ label: "Winston-Salem, NC", total: 12_450, certified: 12_001, fyFrom: 2024, fyTo: 2026 }));
  });

  it("promises employers and jobs only when the page lists them", () => {
    // A city whose LCAs are all in DOL's FY2008 to FY2019 files (or older than the newest three years) lists none.
    const none = { employers: [], occupations: [] };
    for (const c of [
      { label: "Ada, OK", total: 21, certified: 20, fyFrom: 2010, fyTo: 2012, ...none },
      { label: "Ada, OK", total: 21, certified: 20, fyFrom: null, fyTo: null, ...none },
      { label: "Winston-Salem, NC", total: 12_450, certified: 12_001, fyFrom: 2008, fyTo: 2019, ...none },
    ]) {
      const text = h1bCityDescription(c);
      inWindow(text);
      expect(text).not.toMatch(/employers|jobs behind/);
    }
    const listed = { employers: [{ slug: null, name: "Acme", n: 3 }], occupations: [] };
    expect(h1bCityDescription({ label: "Ada, OK", total: 21, certified: 20, fyFrom: 2024, fyTo: 2026, ...listed })).toMatch(
      /with the employers and jobs behind them/,
    );
  });
});

describe("job title A to Z letter descriptions", () => {
  it("fits the window for an empty letter, a single title, the biggest letter and the digits", () => {
    for (const [n, phrase] of [[0, "X"], [1, "Y"], [568, "S"], [2, "a number"], [12_345, "a number"]] as const) {
      inWindow(titleLetterDescription(n, phrase));
    }
  });
});

describe("consulate descriptions", () => {
  it("fits the window for the longest and shortest post names", () => {
    // 89 posts on the live index (Nov 20 2026): Ho Chi Minh City is the longest, Oslo among the shortest.
    for (const name of ["Ho Chi Minh City", "Port-au-Prince", "Rio de Janeiro", "Oslo", "Rome"]) inWindow(consularDescription(name));
  });

  it("would have caught the 161-character Ho Chi Minh City description (control)", () => {
    const shipped =
      "Where the US consulate in Ho Chi Minh City stands: the month NVC is scheduling for interviews, the immigrant visas it issued each month, and the interview pause.";
    expect(shipped.length).toBeGreaterThan(155);
    expect(consularDescription("Ho Chi Minh City").length).toBeLessThanOrEqual(155);
  });
});
