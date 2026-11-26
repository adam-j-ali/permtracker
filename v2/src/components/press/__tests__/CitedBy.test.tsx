/**
 * Press coverage of a page's figures (Nov 26 2026): one plain line near the page's source line naming the outlet, a
 * link to the story itself (never a copy on an aggregator), opening in a new tab, and the day it ran; the page's
 * structured data names the story too.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CitedBy } from "../CitedBy";
import { COVERAGE, coverageOf, coverageSchema } from "@/lib/press/coverage";

describe("CitedBy", () => {
  it("names the outlet, links the story in a new tab, and gives the day it ran", () => {
    const { container } = render(<CitedBy path="/perm-layoff-disclosures" />);
    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toContain("International Business Times used these figures in");
    expect(text).toContain("November 25, 2026");
    const link = screen.getByRole("link", { name: /its story on green card filings at Microsoft/ });
    expect(link.getAttribute("href")).toBe("https://www.ibtimes.com/microsoft-green-card-filings-after-2025-layoffs-3810211");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toContain("(opens in a new tab)");
    // Inside a sentence the link flows with the words: never a flex box that drops the comma onto its own line.
    expect(link.className).not.toMatch(/(^|\s)inline-flex(\s|$)/);
    expect(link.querySelector("svg")?.getAttribute("class")).toMatch(/(^|\s)inline(\s|$)/);
  });

  it("shows nothing on a page no story used", () => {
    const { container } = render(<CitedBy path="/perm-wages" />);
    expect(container.textContent).toBe("");
  });
});

describe("the coverage list", () => {
  const routes = JSON.parse(readFileSync("scripts/known-routes.json", "utf8")) as unknown;
  const known = JSON.stringify(routes);

  it("links each story at its own outlet over https, with an ISO day, on pages the site has", () => {
    for (const c of COVERAGE) {
      expect(c.href.startsWith("https://")).toBe(true);
      expect(c.href).not.toMatch(/inkl\.com|news\.google|msn\.com\/.*\/ar-/);
      expect(c.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const p of c.pages) expect(known).toContain(`"${p}"`);
    }
  });

  it("describes each story for search engines as a news article about the page's data", () => {
    const [c] = coverageOf("/perm-employers/under-review");
    expect(c).toBeTruthy();
    expect(coverageSchema(c!)).toEqual({
      "@type": "NewsArticle",
      headline: c!.story,
      url: c!.href,
      datePublished: "2026-11-25",
      author: { "@type": "NewsMediaOrganization", name: "International Business Times" },
      publisher: { "@type": "NewsMediaOrganization", name: "International Business Times" },
    });
  });
});
