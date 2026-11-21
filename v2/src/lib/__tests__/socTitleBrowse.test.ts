import { describe, expect, it } from "vitest";

import { BROWSE_BUCKETS } from "@/lib/entityBrowse";
import { titleBucketCounts, titleBucketOf, titlesByBucket } from "@/lib/socTitleBrowse";

const page = (slug: string, title: string, filings = 60, topSoc: string | null = "15-1252") => ({ slug, title, filings, topSoc, topFilings: filings });

// Slugs as scripts/build_soc_titles.py writes them: the title key with hyphens, [a-z0-9-] only. The key drops a
// leading seniority word, so a title the files spell "Senior Associate ..." has a slug starting "associate".
const PAGES = [
  page("software-engineer", "Software Engineer", 211_337),
  page("data-scientist", "Data Scientist", 24_660, "15-2051"),
  page("associate-jc60-computer-systems-engineers-architects", "Senior Associate JC60 -Computer Systems Engineers/Architects", 5603, "15-1299"),
  page("35-3023-00-fast-food-and-counter-workers", "35-3023.00 Fast Food & Counter Workers", 50, "35-3023"),
  page("rn", "RN", 70, "29-1141"),
  page("statistician", "statistician", 80, "15-2041"),
  page("store-manager", "Store Manager", 300, "11-1021"),
  page("yoga-instructor", "Yoga Instructor", 51, "39-9031"),
];

describe("the job title A to Z", () => {
  it("puts every title page under exactly one letter, the one the title a reader sees starts with", () => {
    const buckets = titlesByBucket(PAGES);
    const listed = BROWSE_BUCKETS.flatMap((b) => buckets[b].map((p) => p.slug));
    expect(listed.sort()).toEqual(PAGES.map((p) => p.slug).sort());
    for (const b of BROWSE_BUCKETS) for (const p of buckets[b]) expect(titleBucketOf(p.title)).toBe(b);
    // Filed under S, where "Senior Associate ..." is read, though its slug starts with "a".
    expect(buckets.s.map((p) => p.slug)).toContain("associate-jc60-computer-systems-engineers-architects");
    expect(buckets.a).toEqual([]);
  });

  it("reads past marks and accents to the first letter, and files a title with none under 0-9", () => {
    expect(titleBucketOf("(Sr.) Analyst")).toBe("s");
    expect(titleBucketOf("Électricien")).toBe("e");
    expect(titleBucketOf("3D Artist")).toBe("0-9");
    expect(titleBucketOf("")).toBe("0-9");
  });

  it("files a title that starts with a digit under 0-9", () => {
    expect(titlesByBucket(PAGES)["0-9"].map((p) => p.slug)).toEqual(["35-3023-00-fast-food-and-counter-workers"]);
  });

  it("lists a letter alphabetically by the title a reader sees, whatever its case", () => {
    expect(titlesByBucket(PAGES).s.map((p) => p.title)).toEqual([
      "Senior Associate JC60 -Computer Systems Engineers/Architects",
      "Software Engineer",
      "statistician",
      "Store Manager",
    ]);
  });

  it("counts each letter, empty letters included", () => {
    const counts = titleBucketCounts(PAGES);
    expect(counts.s).toBe(4);
    expect(counts.x).toBe(0);
    expect(BROWSE_BUCKETS.reduce((n, b) => n + counts[b], 0)).toBe(PAGES.length);
  });

  it("answers every letter, empty, for no pages", () => {
    const buckets = titlesByBucket([]);
    expect(BROWSE_BUCKETS.every((b) => buckets[b].length === 0)).toBe(true);
  });
});
