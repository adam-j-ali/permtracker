import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BROWSE_BUCKETS } from "@/lib/entityBrowse";

/**
 * /soc-codes carries the job title A to Z's TitleLetterStrip: a real link to every letter a title begins with, so
 * each letter page is one link from the finder and each title two. A letter with nothing under it is plain text.
 */

vi.mock("server-only", () => ({}));
const pages = [
  { slug: "software-engineer", title: "Software Engineer", filings: 211_337, topSoc: "15-1252", topFilings: 190_000 },
  { slug: "associate-jc60-computer-systems-engineers-architects", title: "Senior Associate JC60 -Computer Systems Engineers/Architects", filings: 5603, topSoc: "15-1299", topFilings: 5602 },
  { slug: "35-3023-00-fast-food-and-counter-workers", title: "35-3023.00 Fast Food & Counter Workers", filings: 50, topSoc: "35-3023", topFilings: 22 },
  { slug: "data-scientist", title: "Data Scientist", filings: 24_660, topSoc: "15-2051", topFilings: 21_247 },
];
vi.mock("@/lib/db/socTitles", () => ({ getSocTitlePages: async () => ({ pageMin: 50, pages }) }));

const { TitleLetterStrip } = await import("../TitleBrowse");

describe("TitleLetterStrip", () => {
  it("links every letter a title begins with, and the index, and no empty letter", async () => {
    const { container } = render(await TitleLetterStrip({}));
    const hrefs = new Set([...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
    for (const b of ["s", "d", "0-9"]) expect(hrefs.has(`/soc-codes/browse/${b}`), b).toBe(true);
    expect(hrefs.has("/soc-codes/browse")).toBe(true);
    const empty = BROWSE_BUCKETS.filter((b) => !["s", "d", "0-9"].includes(b));
    expect(empty.filter((b) => hrefs.has(`/soc-codes/browse/${b}`))).toEqual([]);
  });
});
