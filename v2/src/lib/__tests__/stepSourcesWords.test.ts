import { describe, expect, it } from "vitest";

import { figuresLinkText, sourcesLede } from "@/lib/stepSources";

/**
 * D3's first slice (Nov 25 2026): the two-sources box named every step's figure "the agency's", while the PERM, wage
 * request and LCA figures are our own daily count of DOL's records (their kind is "measured" since D1). The words now
 * follow each figure's kind; the figures themselves don't change.
 */
describe("the words around a step's figures", () => {
  it("links an agency's figure as the agency's, and our count as ours", () => {
    expect(figuresLinkText("i140", "official")).toBe("The I-140: the agency's figures");
    expect(figuresLinkText("perm", "measured")).toBe("PERM: our daily count");
    expect(figuresLinkText("pwd", "measured")).toBe("The wage request: our daily count");
  });

  it("says whose figures the section holds", () => {
    expect(sourcesLede(["official"], true)).toBe(
      "The agency's own count, beside how long the cases people reported to us took. Each names where it comes from and when it was true.",
    );
    expect(sourcesLede(["measured"], true)).toBe(
      "Our own daily count of the agency's records, beside how long the cases people reported to us took. Each names where it comes from and when it was true.",
    );
    expect(sourcesLede(["measured", "official"], true)).toMatch(/^The agency's figures and our own daily count of its records, beside/);
    expect(sourcesLede(["official"], false)).toBe(
      "The agency's own count for each step, dated, beside the reported steps on this page.",
    );
    expect(sourcesLede(["measured", "official"], false)).toBe(
      "The agency's figures and our own daily count of its records for each step, dated, beside the reported steps on this page.",
    );
  });
});
