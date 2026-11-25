import { describe, expect, it } from "vitest";

import { nextSteps } from "@convex/lib/mailPages";

/** The rating page's "What comes next" follows the case's own program, not only its status (Nov 2 2026). */
describe("the rating page's next steps", () => {
  it("sends a certified PERM case on to the green card steps", () => {
    const links = nextSteps("CERTIFIED", "G-100-26015-561865");
    const labels = links.map((l) => l.label).join(" | ");
    expect(labels).toMatch(/steps after PERM/);
    // The email's own steps, in its order: the I-140, its receipt, the bulletin, the planner.
    expect(links.slice(0, 4).map((l) => new URL(l.href).pathname)).toEqual([
      "/tools/i140-calculator",
      "/uscis-case-status",
      "/visa-bulletin",
      "/tools/green-card-timeline",
    ]);
  });

  it("gives a denial the employer's options and the guide", () => {
    const hrefs = nextSteps("DENIED", "G-100-26015-561865").map((l) => l.href);
    expect(hrefs).toContain("https://permtracker.app/guides/perm-appeal-reconsideration-balca");
    expect(hrefs).toContain("https://permtracker.app/guides/perm-denied-what-happens-next");
  });

  it("sends a certified LCA on to the H-1B petition, never to PERM's steps", () => {
    const links = nextSteps("CERTIFIED", "I-200-26294-315050");
    const labels = links.map((l) => l.label).join(" | ");
    expect(labels).toMatch(/look up a receipt number/);
    expect(labels).not.toMatch(/PERM|green card line/i);
  });

  it("gives a withdrawn case nothing to add, whatever its program", () => {
    expect(nextSteps("WITHDRAWN", "I-200-26294-315050")).toEqual([]);
    expect(nextSteps("WITHDRAWN", "G-100-26015-561865")).toEqual([]);
  });
});
