import { describe, expect, it } from "vitest";

import { NEWS_LINES_MAX, newsBody, newsSubject, readNews } from "./newsworthyEmail";

describe("the evening newsworthy email", () => {
  const line =
    'OIRA finished its review of "A PERM rule" on Oct 23, 2026. Its decision: "Consistent with Change". Source: OIRA\'s review lists on reginfo.gov.';

  it("reads the hand-over, dropping anything that isn't a line", () => {
    expect(readNews({ day: "2026-10-27", items: [line, 4, "", null] })).toEqual({ day: "2026-10-27", lines: [line] });
    expect(readNews({ day: "Oct 27", items: [line] })).toBeNull();
    expect(readNews("nope")).toBeNull();
    expect(readNews({ day: "2026-10-27", items: Array.from({ length: 40 }, () => line) })?.lines).toHaveLength(NEWS_LINES_MAX);
  });

  it("says how many things moved, on which day", () => {
    expect(newsSubject({ day: "2026-10-27", lines: [line] })).toBe("Newsworthy, Tue Oct 27: 1 thing moved");
    expect(newsSubject({ day: "2026-10-27", lines: [line, line] })).toBe("Newsworthy, Tue Oct 27: 2 things moved");
  });

  it("lists every line with its source, and nothing else invented", () => {
    const body = newsBody({ day: "2026-10-27", lines: [line] });
    expect(body).toContain(`- ${line}`);
    expect(body).toContain("https://permtracker.app/policy-changes#pipeline");
  });

  it("points at the rules page only when a rule is what moved", () => {
    // An evening with one employer's batch and nothing about a rule ended "Every rule on its way, step by step",
    // a link to a page the notice had nothing to do with (Nov 12 2026).
    const employer =
      "DOL certified 103 of AMAZON DEV CENTER U.S., INC.'s PERM cases in one day, Nov 12, 2026. Source: DOL's case-status search, read by this site's sweep.";
    const register =
      'DOL published "A wage rule" in the Federal Register on Nov 12, 2026 (final rule). Source: the Federal Register.';

    const alone = newsBody({ day: "2026-11-12", lines: [employer] });
    expect(alone).toContain(`- ${employer}`);
    expect(alone).not.toContain("policy-changes");
    expect(alone.endsWith("\n")).toBe(false);

    expect(newsBody({ day: "2026-11-12", lines: [employer, register] })).toContain("https://permtracker.app/policy-changes#pipeline");
    expect(newsBody({ day: "2026-11-12", lines: [employer, line] })).toContain("https://permtracker.app/policy-changes#pipeline");
  });
});
