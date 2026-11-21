import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CitingCases } from "../CitingCases";

/**
 * A wage request's page links the LCAs and seasonal job orders that cite it (the Nov 20 2026 sweep, item 36):
 * each a link to its own case page, with its program, employer, status and day as plain words.
 */
describe("CitingCases", () => {
  it("links each citing filing to its case page and says what it is", () => {
    const html = renderToStaticMarkup(
      <CitingCases
        citing={[
          { caseNumber: "I-200-21068-132354", kind: "lca", program: "H-1B", employerName: "Michigan State University", status: "CERTIFIED", day: "2021-03-16" },
          { caseNumber: "H-400-24004-617686", kind: "seasonal", program: "H-2B", employerName: "Sadler Racing", status: null, day: "2024-02-14" },
        ]}
      />,
    );
    expect(html).toContain('href="/perm-case-status?case=I-200-21068-132354"');
    expect(html).toContain('href="/perm-case-status?case=H-400-24004-617686"');
    expect(html).toContain("H-1B LCA");
    expect(html).toContain("H-2B job order");
    expect(html).toContain("Michigan State University");
    expect(html).toContain("Certified");
    expect(html).toContain("Filings that cite this wage request");
  });

  it("says one filing in the singular", () => {
    const html = renderToStaticMarkup(
      <CitingCases citing={[{ caseNumber: "I-200-21068-132354", kind: "lca", program: null, employerName: null, status: null, day: null }]} />,
    );
    expect(html).toContain("A filing cites this wage request");
    expect(html).toContain(">LCA<");
  });

  it("renders nothing when nothing cites it", () => {
    expect(renderToStaticMarkup(<CitingCases citing={[]} />)).toBe("");
  });

  it("keeps a space between the link and its words, and every link a 44px target", () => {
    const html = renderToStaticMarkup(
      <CitingCases citing={[{ caseNumber: "I-200-21068-132354", kind: "lca", program: "H-1B", employerName: "Acme", status: null, day: null }]} />,
    );
    expect(html).toMatch(/<\/a> <span/);
    expect(html).toContain("min-h-11");
  });
});
