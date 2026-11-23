import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The source line reads the freshness registry (an async server part); its own tests cover it.
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
vi.mock("@/lib/convexStatic", () => ({ queryStatic: vi.fn() }));
vi.mock("@/lib/db/uscisPosted", () => ({ getUscisPosted: vi.fn(async () => null) }));
vi.mock("@/lib/db/reportedSummary", () => ({ getReportedSummary: vi.fn(async () => null) }));
vi.mock("@/lib/db/communityReports", () => ({ getReportedOverview: vi.fn(async () => null) }));

import { queryStatic } from "@/lib/convexStatic";
import { getReportedSummary } from "@/lib/db/reportedSummary";
import { getUscisPosted } from "@/lib/db/uscisPosted";
import type { ReportedSummary, StepFigure } from "@/lib/reportedSummary";
import { BOARD_OPENS_AT, OFFICE_LIST_OPENS_AT, computeMetrics, summarizeRfes, toBoardRow, whoIsWaiting, type TimelineRecord } from "@/lib/communityTimeline";
import Page from "../(site)/(public)/green-card-timelines/page";

/**
 * The public board page. What must hold: nothing that identifies a case
 * reaches the markup, the board stays shut below its threshold and says why,
 * every stage says whether it is DOL's record or self-reported, and a Convex
 * outage renders a sentence, not a crash.
 */

const rec = (i: number, over: Partial<TimelineRecord> = {}): TimelineRecord => ({
  public: true,
  updatedAt: Date.UTC(2026, 8, 1),
  permFiledOn: "2025-06-17",
  permCertifiedOn: "2026-04-02",
  permCertifiedSource: "disclosure",
  category: "eb3",
  country: "india",
  route: "adjustment",
  premium: true,
  i140FiledOn: "2026-04-10",
  i140ApprovedOn: `2026-04-${String(18 + (i % 5)).padStart(2, "0")}`,
  rfeForm: i === 0 ? "i140" : undefined,
  rfeReason: i === 0 ? "ability-to-pay" : undefined,
  rfeOutcome: i === 0 ? "approved" : undefined,
  ...over,
});

function boardOf(records: TimelineRecord[], opensAt = 25) {
  const shared = records.filter((r) => r.public);
  return {
    total: records.length,
    shared: shared.length,
    opensAt,
    open: shared.length >= opensAt,
    metrics: computeMetrics(records),
    rfe: summarizeRfes(records),
    rows: shared.length >= opensAt ? shared.map(toBoardRow) : [],
    waiting: whoIsWaiting(records),
  };
}

async function html() {
  return renderToStaticMarkup(await Page());
}

beforeEach(() => {
  vi.mocked(queryStatic).mockReset();
  // The shared timelines alone, unless a test gives every source's figures.
  vi.mocked(getReportedSummary).mockReset().mockResolvedValue(null);
});

describe("/green-card-timelines", () => {
  it("keeps the board shut below the threshold and says how many are shared", async () => {
    vi.mocked(queryStatic).mockResolvedValue(boardOf(Array.from({ length: 6 }, (_, i) => rec(i))) as never);
    const out = await html();
    expect(out).toContain("Opens at 25 shared timelines. 6 so far.");
    expect(out).not.toContain("<table");
  });

  it("opens with rows at the threshold and prints no exact PERM date", async () => {
    vi.mocked(queryStatic).mockResolvedValue(boardOf(Array.from({ length: 25 }, (_, i) => rec(i))) as never);
    const out = await html();
    expect(out).toContain("<table");
    expect(out).not.toContain("2025-06-17");
    expect(out).not.toContain("2026-04-02");
    expect(out).not.toMatch(/G-\d{3}-\d{5}/);
  });

  it("gives USCIS's own work permit and advance parole times beside the reports", async () => {
    vi.mocked(queryStatic).mockResolvedValue(boardOf(Array.from({ length: 6 }, (_, i) => rec(i))) as never);
    vi.mocked(getUscisPosted).mockResolvedValueOnce({
      published: "2026-10-19",
      postings: ["2026-10-19"],
      series: [],
      longestGapDays: 34,
      project: "x",
      newest: [
        { form: "I-765", subtype: "147-C9", office: "NBC", posted: 12, postedText: null, requestDate: null, label: "Based on a pending I-485 adjustment application [(c)(9)]", officeLabel: "National Benefits Center" },
        { form: "I-131", subtype: "141B-OTH", office: "SCD", posted: 26.5, postedText: null, requestDate: null, label: "Advance parole", officeLabel: "Service Center Operations (SCOPS)" },
      ],
    });
    const out = (await html()).replace(/\s+/g, " ");
    expect(out).toContain("USCIS&#x27;s own posted times, as of its October 19, 2026 posting: 12 months for a work permit based on a pending I-485, at the National Benefits Center, and 26.5 months for advance parole.");
  });

  it("labels each stage with whose record it is and prints a median only with enough timelines", async () => {
    vi.mocked(queryStatic).mockResolvedValue(boardOf(Array.from({ length: 6 }, (_, i) => rec(i))) as never);
    const out = await html();
    expect(out).toMatch(/PERM filed to certified.*?DOL&#x27;s record/s);
    expect(out).toMatch(/I-140 to approved, premium.*?self-reported/s);
    expect(out).toContain("Median 289 days");
    expect(out).toContain("a median needs 5, and this stage has 0");
  });

  it("shows who's waiting where once the board opens, and keeps it shut below", async () => {
    vi.mocked(queryStatic).mockResolvedValue(boardOf(Array.from({ length: 25 }, (_, i) => rec(i))) as never);
    expect(await html()).not.toContain("Opens at 25 timelines, like the board.");
    vi.mocked(queryStatic).mockResolvedValue(boardOf(Array.from({ length: 6 }, (_, i) => rec(i))) as never);
    expect(await html()).toContain("Opens at 25 timelines, like the board. 6 so far.");
  });

  it("renders against a backend older than the who's-waiting field", async () => {
    // Deploy skew: the page can reach a Convex deployment that sends no `waiting`.
    const { waiting: _w, ...older } = boardOf(Array.from({ length: 25 }, (_, i) => rec(i)));
    void _w;
    vi.mocked(queryStatic).mockResolvedValue(older as never);
    const out = await html();
    expect(out).toContain("<table");
    expect(out).toContain("Who&#x27;s waiting, and where");
  });

  it("links each office whose own list is open, and names a row's office when the backend sends it", async () => {
    const records = Array.from({ length: BOARD_OPENS_AT }, (_, i) => rec(i, { fieldOffice: "HAR" }));
    const board = { ...boardOf(records, BOARD_OPENS_AT), offices: [{ code: "HAR", shared: BOARD_OPENS_AT }] };
    board.rows = records.map((r) => toBoardRow(r, true));
    vi.mocked(queryStatic).mockResolvedValue(board as never);
    const out = await html();
    expect(out).toContain('href="/i485-by-field-office/hartford-connecticut#timelines"');
    expect(out).toMatch(/By USCIS office:.*Hartford/s);
    expect(out).toContain("I-485 at Hartford");
    expect(out).toContain(`which opens at ${OFFICE_LIST_OPENS_AT} shared timelines from that office`);
  });

  it("renders against a backend older than the office fields", async () => {
    // Deploy skew: no `offices`, and rows with no `office`.
    const older = boardOf(Array.from({ length: 25 }, (_, i) => rec(i)));
    vi.mocked(queryStatic).mockResolvedValue(older as never);
    const out = await html();
    expect(out).toContain("<table");
    expect(out).not.toContain("By USCIS office:");
    expect(out).toContain('href="/i485-by-field-office"');
  });

  it("answers the questions people ask, in the page and in its structured data, with the floors the backend holds", async () => {
    vi.mocked(queryStatic).mockResolvedValue(boardOf([rec(0)]) as never);
    const out = await html();
    expect(out).toContain("FAQPage");
    expect(out).toContain("Are these USCIS&#x27;s processing times?");
    expect(out).toContain(`only once ${BOARD_OPENS_AT} people have shared (${OFFICE_LIST_OPENS_AT} for one office&#x27;s list)`);
    expect(out).toContain("It needs no account and no case number.");
  });

  describe("the first screen, with every source's figures", () => {
    const step = (id: string, label: string, group: StepFigure["group"], median: number): StepFigure => ({
      id, label, group, verified: false, n: 120, windowDays: 183, median, p25: median - 30, p75: median + 30,
      before: { median: median - 8, n: 100 }, allTime: 400, months: [],
    });
    const summary: ReportedSummary = {
      today: "2026-11-23",
      headline: { cases: 23717, heard: 5200, heardDays: 365, greenCards30: 412, i140s30: 1203, perm30: 3100 },
      week: { from: "2026-11-17", through: "2026-11-23", steps: [{ id: "gc", label: "Green cards", count: 61 }] },
      steps: [
        step("i485-gc", "I-485 filed to green card", "i485", 290),
        step("perm", "PERM filed to decided", "perm", 480),
        step("i140-premium", "I-140 with premium processing", "i140", 12),
      ],
      waiting: { open: false, heardDays: 365, heard: 0, byStage: [], lines: [], unlisted: 0 },
      i140: [],
    };

    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
      vi.mocked(getReportedSummary).mockResolvedValue(summary);
      vi.mocked(queryStatic).mockResolvedValue(boardOf(Array.from({ length: 6 }, (_, i) => rec(i))) as never);
    });
    afterEach(() => vi.unstubAllEnvs());

    it("keeps the count of cases in a two-line lede and out of the figures, which are the three step durations", async () => {
      const out = (await html()).replace(/\s+/g, " ");
      expect(out).toContain(
        "How long each step took, from 23,717 cases people reported, each person once. Self-reported, because USCIS doesn&#x27;t publish it case by case.",
      );
      expect(out).not.toContain("Cases people reported");
      for (const label of ["I-485 filed to green card", "PERM filed to decided", "I-140 with premium processing"]) {
        expect(out).toContain(label);
      }
    });

    it("puts the way to add your dates right under the lede, before the figures", async () => {
      const out = await html();
      const lede = out.indexOf("How long each step took");
      // The form's own fold, drawn by the server so it doesn't push the figures down when the scripts start.
      const form = out.indexOf('id="share"');
      // The fold's own words, after the sentence above it that says them too.
      const add = out.indexOf("Add your dates", form);
      const figures = out.indexOf("I-485 filed to green card");
      expect(lede).toBeGreaterThan(-1);
      expect(form).toBeGreaterThan(lede);
      expect(add).toBeGreaterThan(form);
      expect(add).toBeLessThan(figures);
    });

    it("gives the last 30 days' green cards in the week's approvals, not as a fourth figure", async () => {
      // The words as read, without the tags around the figure.
      const out = (await html()).replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
      const week = out.indexOf("Approvals reported this week");
      const month = out.indexOf("In the last 30 days:");
      expect(week).toBeGreaterThan(-1);
      expect(month).toBeGreaterThan(week);
      expect(out).toContain("In the last 30 days: 412 green cards, with 1,203 I-140 and 3,100 PERM decisions, reported by the people who got them.");
    });
  });

  it("lists RFE reasons, and renders a sentence when Convex can't be reached", async () => {
    vi.mocked(queryStatic).mockResolvedValue(boardOf([rec(0)]) as never);
    expect(await html()).toContain("The employer&#x27;s ability to pay the wage");
    vi.mocked(queryStatic).mockRejectedValue(new Error("down"));
    expect(await html()).toContain("can&#x27;t be read right now");
  });
});
