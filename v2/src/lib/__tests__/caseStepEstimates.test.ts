import { describe, expect, it } from "vitest";

import { KIND_LABELS, stepEstimates, type StepFiguresPayload } from "../caseStepEstimates";

/**
 * The green card tab's per-step estimates, worked out in the browser from the case's own dates and the three kinds of
 * figure (/api/step-estimates): the agency's posted time, our count of the receipts we check, and people's reports.
 * Each figure says which kind it is, in the words the site's sources switch uses.
 */

const FIGURES: StepFiguresPayload = {
  steps: {
    i485: {
      official: { min: 9.5, max: 24, postedOn: "2026-11-03", where: "field offices" },
      measured: {
        asOf: "2026-11-24",
        months: [
          { month: "2026-08", counted: 120, share: 0.31, low: 0.26, high: 0.36 },
          { month: "2026-07", counted: 110, share: 0.4, low: 0.35, high: 0.45 },
        ],
      },
      community: { median: 410, p25: 360, p75: 470, n: 37, windowDays: 365 },
    },
    ead: {
      official: { min: 12, max: 12, postedOn: "2026-11-03", where: "National Benefits Center" },
      measured: { asOf: "2026-11-24", months: [{ month: "2026-08", counted: 300, share: 0.6, low: 0.55, high: 0.65 }] },
      community: { median: null, p25: null, p75: null, n: 3, windowDays: null },
    },
  },
  unreadable: [],
};

describe("stepEstimates", () => {
  it("labels the three kinds the way the sources switch does", () => {
    expect(KIND_LABELS).toEqual({ official: "The agency", measured: "Our count", community: "People's reports" });
    const i485 = stepEstimates("i485", FIGURES, {});
    expect(i485.map((f) => [f.kind, f.label])).toEqual([
      ["official", "The agency"],
      ["measured", "Our count"],
      ["community", "People's reports"],
    ]);
  });

  it("reads each figure for a pending I-485 against its own filing date", () => {
    const [official, measured, community] = stepEstimates("i485", FIGURES, { i485FilingDate: "2026-07-15" });
    expect(official!.value).toBe("9.5 to 24 months");
    expect(official!.note).toMatch(/employment-based I-485s/);
    expect(official!.note).toMatch(/Posted November 3, 2026/);
    expect(official!.note).toMatch(/Counted from your filing on Jul 15, 2026/);
    // The sample's month is the one USCIS received the case: July for a July filing.
    expect(measured!.value).toBe("40%");
    expect(measured!.note).toMatch(/received in July 2026, the month yours was/);
    expect(measured!.note).toMatch(/Margin 35% to 45%, from 110 cases checked/);
    expect(community!.value).toBe("410 days");
    expect(community!.note).toMatch(/middle half 360 to 470 days, 37 cases finished in the last 12 months/);
    expect(community!.note).toMatch(/At the median, yours would be approved around Aug 29, 2027/);
  });

  it("uses the newest month the sample holds when the case's month isn't there, and says nothing about yours", () => {
    const [, measured] = stepEstimates("i485", FIGURES, { i485FilingDate: "2025-01-02" });
    expect(measured!.value).toBe("31%");
    expect(measured!.note).toMatch(/received in August 2026, approved so far/);
    expect(measured!.note).not.toMatch(/yours/);
  });

  it("drops the case's own dates once the step is decided", () => {
    const figures = stepEstimates("i485", FIGURES, { i485FilingDate: "2026-07-15", i485DenialDate: "2026-10-01" });
    for (const f of figures) expect(f.note).not.toMatch(/your filing|yours would/);
  });

  it("says when a kind has too few cases, never a figure from them", () => {
    const [, , community] = stepEstimates("ead", FIGURES, { i485FilingDate: "2026-07-15", eadFilingDate: "2026-07-15" });
    expect(community!.value).toBe("Too few yet");
    expect(community!.note).toMatch(/3 cases reported in the last 12 months\. A figure needs 5/);
  });

  it("says a source can't be read rather than leaving it out", () => {
    const blank: StepFiguresPayload = {
      steps: { i485: { official: null, measured: null, community: null }, ead: { official: null, measured: null, community: null } },
      unreadable: ["posted", "sample", "reported"],
    };
    const figures = stepEstimates("i485", blank, {});
    expect(figures.map((f) => f.value)).toEqual(["Not available", "Not available", "Not available"]);
  });

  it("reads the work permit from its own filing and the I-485's", () => {
    const [official, measured] = stepEstimates("ead", FIGURES, { i485FilingDate: "2026-08-03", eadFilingDate: "2026-08-03" });
    expect(official!.value).toBe("12 months");
    expect(official!.note).toMatch(/\(c\)\(9\)/);
    expect(official!.note).toMatch(/National Benefits Center/);
    expect(official!.note).toMatch(/that's Aug 3, 2027/);
    expect(measured!.note).toMatch(/I-765, every category/);
    expect(measured!.note).toMatch(/the month yours was/);
  });
});
