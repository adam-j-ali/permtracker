import { describe, expect, it } from "vitest";

import { TITLE_LIMIT, TITLE_SUFFIX, fitTitle, metadataTitle, renderedTitle } from "@/lib/pageTitle";

/**
 * One rule fits every dynamic page title to what a search result shows: the brand first, then a
 * qualifier, then the name cut at a word. Ahrefs' Nov 21 2026 crawl reported 24 titles over the line,
 * job-title and industry pages, which the static title gate can't see because one generateMetadata
 * serves every slug. These are the longest real names those pages read.
 */

const socFrame = [(n: string) => `SOC Code for ${n}`];

describe("fitTitle", () => {
  it("keeps the brand when the whole title fits with it", () => {
    const t = fitTitle("Data Scientist", socFrame);
    expect(t).toEqual({ title: "SOC Code for Data Scientist", absolute: false, cut: false });
    expect(renderedTitle(t)).toBe(`SOC Code for Data Scientist${TITLE_SUFFIX}`);
  });

  it("drops a qualifier before the brand, the way the consulate pages read", () => {
    const frames = [(n: string) => `${n} Immigrant Visa Interview Wait Times`, (n: string) => `${n} Visa Interview Wait Times`];
    expect(renderedTitle(fitTitle("Lagos", frames))).toBe("Lagos Immigrant Visa Interview Wait Times | PERM Tracker");
    expect(renderedTitle(fitTitle("Ho Chi Minh City", frames))).toBe("Ho Chi Minh City Visa Interview Wait Times | PERM Tracker");
  });

  it("drops the brand before it cuts the name", () => {
    // 53 characters: over the line with the brand, inside it without.
    const t = fitTitle("Vice President, Quantitative Engineering", socFrame);
    expect(t).toEqual({ title: "SOC Code for Vice President, Quantitative Engineering", absolute: true, cut: false });
  });

  it("cuts the longest job titles at a word, never inside one", () => {
    for (const name of [
      "Senior Associate JC60 -Computer Systems Engineers/Architects",
      "Business Consulting, Risk - Technology Risk (Fait) (Manager)",
      "Landscaping and Groundskeeping Workers (General Landscapers)",
      "35-3023.00 Fast Food & Counter Workers – Mobile Food Concess",
    ]) {
      const t = fitTitle(name, socFrame);
      const shown = renderedTitle(t);
      expect(shown.length, shown).toBeLessThanOrEqual(TITLE_LIMIT);
      expect(t.cut).toBe(true);
      expect(shown.startsWith("SOC Code for ")).toBe(true);
      expect(shown.endsWith("…")).toBe(true);
      // Every word kept is a whole word of the name, in order.
      const kept = shown.slice("SOC Code for ".length, -1).split(" ");
      expect(name.split(" ").slice(0, kept.length)).toEqual(kept);
    }
  });

  it("never leaves a dangling joiner or mark before the cut", () => {
    const shown = renderedTitle(fitTitle("Landscaping and Groundskeeping Workers (General Landscapers)", socFrame));
    expect(shown).toBe("SOC Code for Landscaping and Groundskeeping Workers…");
    const amp = renderedTitle(fitTitle("Software Quality Assurance Engineers & Testers, Mobile and Cloud", socFrame));
    expect(amp).not.toMatch(/(?:\s(?:and|or|of|for|the|in|with|to|&)|[,;:\-–(/])…$/);
  });

  it("keeps the key term whole: the NAICS code of an industry is never cut", () => {
    const frames = [
      (n: string) => `PERM in ${n}, NAICS 541611`,
      (n: string) => `NAICS 541611 PERM Filings: ${n}`,
    ];
    const t = fitTitle("Administrative Management and General Management Consulting Services", frames);
    expect(renderedTitle(t)).toBe("NAICS 541611 PERM Filings: Administrative Management…");
    expect(renderedTitle(t).length).toBeLessThanOrEqual(TITLE_LIMIT);
  });

  it("keeps a first word too long to fit whole rather than cut it", () => {
    const t = fitTitle("Supercalifragilisticexpialidociousnessmanagementconsultancyservices Inc", socFrame);
    expect(t.title).toBe("SOC Code for Supercalifragilisticexpialidociousnessmanagementconsultancyservices…");
  });

  it("writes the metadata title Next renders: a plain title takes the template, a fitted one doesn't", () => {
    expect(metadataTitle(fitTitle("Data Scientist", socFrame))).toBe("SOC Code for Data Scientist");
    expect(metadataTitle(fitTitle("Vice President, Quantitative Engineering", socFrame))).toEqual({
      absolute: "SOC Code for Vice President, Quantitative Engineering",
    });
  });

  it("matches the root layout's template", () => {
    expect(TITLE_SUFFIX).toBe(" | PERM Tracker");
    expect(TITLE_LIMIT).toBe(60);
  });
});
