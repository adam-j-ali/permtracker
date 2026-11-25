import { describe, expect, it } from "vitest";

import { buildStepFigures } from "../caseStepFigures";
import type { UscisPosted } from "../uscisPosted";
import type { SampleMonthsDoc } from "../uscisSample";
import type { ReportedSummary, StepFigure } from "../reportedSummary";

/**
 * The three kinds of figure behind the green card tab's per-step estimates, built from the readers the public pages
 * use: USCIS's posted times (getUscisPosted), our receipt sample by the month USCIS received each case
 * (getSampleMonths), and the cases people reported (getReportedSummary). Aggregates only.
 */

const row = (form: string, subtype: string, office: string, posted: number | null, label: string, officeLabel?: string) => ({
  form, subtype, office, posted, postedText: posted === null ? "See the notes below" : `${posted} Months`, requestDate: null, label, officeLabel: officeLabel ?? null,
});

const POSTED: UscisPosted = {
  published: "2026-11-03",
  postings: ["2026-10-01", "2026-11-03"],
  newest: [
    row("I-485", "131A", "ATL", 9.5, "Employment-based adjustment applications"),
    row("I-485", "131A", "NYC", 24, "Employment-based adjustment applications"),
    row("I-485", "131A", "SEA", null, "Employment-based adjustment applications"),
    row("I-485", "131B", "ATL", 14, "Family-based adjustment applications"),
    row("I-765", "765C9", "NBC", 12, "Based on a pending I-485 adjustment application (c)(9)", "National Benefits Center"),
  ],
  series: [],
  longestGapDays: 40,
  project: "",
};

const group = (share: number, count: number) => ({ count, estimated: count, share, low: share - 0.05, high: share + 0.05 });
const form = (approved: number, counted: number) => ({
  counted,
  walked_cases: 0,
  drawn_cases: counted,
  rest_unknown: false,
  rest_share: null,
  groups: {
    approved: group(approved, Math.round(approved * counted)),
    denied: group(0, 0),
    withdrawn: group(0, 0),
    closed: group(0, 0),
    revoked: group(0, 0),
    rfe: group(0.05, 2),
    waiting: group(1 - approved - 0.05, counted),
  },
});

const SAMPLE: SampleMonthsDoc = {
  as_of: "2026-11-24",
  groups: [],
  by_month: {
    "2026-11": { "I-485": form(0.01, 40) },
    "2026-08": { "I-485": form(0.31, 120), "I-765": form(0.6, 300) },
    "2026-07": { "I-485": form(0.4, 110) },
  },
};

const step = (id: string, median: number | null, n: number): StepFigure => ({
  id, label: id, group: "i485", verified: false, n, windowDays: median === null ? null : 365, median,
  p25: median === null ? null : median - 50, p75: median === null ? null : median + 60, before: null, allTime: n, months: [],
});

const SUMMARY = { steps: [step("i485-gc", 410, 37), step("i485-ead", null, 3), step("i485-bio", 40, 90)] } as unknown as ReportedSummary;

describe("buildStepFigures", () => {
  const built = buildStepFigures({ posted: POSTED, sample: SAMPLE, summary: SUMMARY, today: "2026-11-25" });

  it("takes USCIS's employment-based I-485 time across its field offices, and the (c)(9) work permit's", () => {
    expect(built.steps.i485.official).toEqual({ min: 9.5, max: 24, postedOn: "2026-11-03", where: "field offices" });
    expect(built.steps.ead.official).toEqual({ min: 12, max: 12, postedOn: "2026-11-03", where: "National Benefits Center" });
  });

  it("gives the sample's share approved by receipt month, newest first, leaving out the month still filling", () => {
    expect(built.steps.i485.measured?.asOf).toBe("2026-11-24");
    expect(built.steps.i485.measured?.months.map((m) => m.month)).toEqual(["2026-08", "2026-07"]);
    expect(built.steps.i485.measured?.months[0]).toMatchObject({ counted: 120, share: 0.31 });
    expect(built.steps.ead.measured?.months.map((m) => m.month)).toEqual(["2026-08"]);
  });

  it("carries people's reports for each step, a step with too few kept with its count", () => {
    expect(built.steps.i485.community).toEqual({ median: 410, p25: 360, p75: 470, n: 37, windowDays: 365 });
    expect(built.steps.ead.community).toEqual({ median: null, p25: null, p75: null, n: 3, windowDays: null });
  });

  it("drops USCIS's figures once its newest posting is too old to stand for now", () => {
    const stale = buildStepFigures({ posted: POSTED, sample: SAMPLE, summary: SUMMARY, today: "2027-06-01" });
    expect(stale.steps.i485.official).toBeNull();
    expect(stale.steps.ead.official).toBeNull();
  });

  it("leaves a source it couldn't read as null, never an empty figure", () => {
    const none = buildStepFigures({ posted: null, sample: null, summary: null, today: "2026-11-25" });
    expect(none.steps.i485).toEqual({ official: null, measured: null, community: null });
  });

  it("holds no receipt number", () => {
    expect(JSON.stringify(built)).not.toMatch(/[A-Za-z]{3}\d{10}/);
  });
});
