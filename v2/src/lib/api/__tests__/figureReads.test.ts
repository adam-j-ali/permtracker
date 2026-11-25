/**
 * The figure reads (API 1.2): the receipt-number sample, USCIS's I-140 and I-485 figures, the consulates, the
 * timelines people reported and the estimates' own record. Each answer is held to its published schema, a part that
 * can't be read is named rather than sent as "none", and no answer ever holds a receipt number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSampleBlocks = vi.fn();
const getSampleMeta = vi.fn();
const getSampleMonths = vi.fn();
const getBlockMoves = vi.fn();
vi.mock("@/lib/db/uscisSample", () => ({
  getSampleBlocks: () => getSampleBlocks(),
  getSampleMeta: () => getSampleMeta(),
  getSampleMonths: () => getSampleMonths(),
  getBlockMoves: (...a: unknown[]) => getBlockMoves(...a),
}));
const getI140Snapshot = vi.fn();
vi.mock("@/lib/db/uscisI140", () => ({ getI140Snapshot: (...a: unknown[]) => getI140Snapshot(...a) }));
const getI140Trends = vi.fn();
const getI485Trend = vi.fn();
vi.mock("@/lib/db/publicData", () => ({ getI140Trends: () => getI140Trends(), getI485Trend: () => getI485Trend() }));
const getEbAwaitingVisa = vi.fn();
const getI485Offices = vi.fn();
const getUscisFormMedian = vi.fn();
vi.mock("@/lib/db/uscisQuarterly", () => ({
  getEbAwaitingVisa: () => getEbAwaitingVisa(),
  getI485Offices: () => getI485Offices(),
  getUscisFormMedian: (...a: unknown[]) => getUscisFormMedian(...a),
}));
const getUscisPosted = vi.fn();
vi.mock("@/lib/db/uscisPosted", () => ({ getUscisPosted: () => getUscisPosted() }));
const getConsularIndex = vi.fn();
const getPostDetail = vi.fn();
vi.mock("@/lib/db/consularPosts", () => ({
  getConsularIndex: () => getConsularIndex(),
  getPostDetail: (...a: unknown[]) => getPostDetail(...a),
}));
const getReportedSummary = vi.fn();
const getOfficeSummary = vi.fn();
const getPostSummary = vi.fn();
vi.mock("@/lib/db/reportedSummary", () => ({
  getReportedSummary: () => getReportedSummary(),
  getOfficeSummary: (...a: unknown[]) => getOfficeSummary(...a),
  getPostSummary: (...a: unknown[]) => getPostSummary(...a),
}));
const getReportedOverview = vi.fn();
vi.mock("@/lib/db/communityReports", () => ({ getReportedOverview: () => getReportedOverview() }));
const getEstimateChecks = vi.fn();
vi.mock("@/lib/db/estimateChecks", () => ({ getEstimateChecks: () => getEstimateChecks() }));
const getEstimatorBacktest = vi.fn();
const getScorecardSummary = vi.fn();
vi.mock("@/lib/db/predictions", () => ({
  getEstimatorBacktest: () => getEstimatorBacktest(),
  getScorecardSummary: () => getScorecardSummary(),
}));

import { ENDPOINTS } from "../openapi";
import {
  RECEIPT_SHAPE,
  forgetKeptFigures,
  formName,
  noReceipts,
  readAccuracy,
  readConsulate,
  readConsulates,
  readReceiptBlock,
  readReceiptBlocks,
  readReceiptMonths,
  readTimelines,
  readUscisI140,
  readUscisI485,
} from "../figureReads";
import type { ReadResult } from "../reads";

/* ---------------------------------------------------------------- the fixtures */

const g = (count: number, share: number) => ({ count, estimated: count * 10, share, low: Math.max(0, share - 0.2), high: Math.min(1, share + 0.2) });
const form = (counted: number, approved: number) => ({
  counted,
  walked_cases: 0,
  drawn_cases: counted,
  rest_unknown: false,
  rest_share: 1,
  groups: {
    approved: g(approved, approved / counted),
    denied: g(0, 0),
    withdrawn: g(0, 0),
    closed: g(0, 0),
    revoked: g(0, 0),
    rfe: g(0, 0),
    waiting: g(counted - approved, 1 - approved / counted),
  },
});
const BLOCKS = {
  as_of: "2026-11-25",
  groups: ["approved", "denied", "withdrawn", "closed", "revoked", "rfe", "waiting"],
  by_block: {
    IOE09364: { _skipped: 0, _walked_share: 0, _draws: 50, "I-485": form(10, 5), "I-765": form(20, 18) },
    IOE09365: { _skipped: 0, _walked_share: 0, _draws: 50, "I-485": form(8, 1) },
    IOE09366: { _skipped: 0, _walked_share: 0, _draws: 50, "I-485": form(14, 0), "I-130": form(3, 0) },
    IOE09367: { _skipped: 0, _walked_share: 0, _draws: 40 },
  },
};
const MONTHS = {
  as_of: "2026-11-25",
  groups: BLOCKS.groups,
  by_month: {
    "2026-01": { _walked_share: 0.5, "I-485": form(40, 30) },
    "2026-02": { _walked_share: 0, "I-485": form(30, 10), "I-765": form(5, 5) },
  },
};
const MOVES = [{ on_day: "2026-11-24", form: "I-485", to_grp: "approved", n: 2 }];

const office = (code: string, empPending: number | null) => ({
  state: "California", office: "San Fernando Valley", code, suppressed: empPending === null ? 1 : 0,
  famReceived: 1, famApproved: 1, famDenied: 0, famPending: 2,
  empReceived: 10, empApproved: 8, empDenied: 1, empPending,
  humReceived: 0, humApproved: 0, humDenied: 0, humPending: 0,
  othReceived: 0, othApproved: 0, othDenied: 0, othPending: 0,
  allReceived: 11, allApproved: 9, allDenied: 1, allPending: 30,
});
const POSTED = {
  published: "2026-11-20",
  postings: ["2026-11-20"],
  newest: [
    { form: "I-140", subtype: "E21", office: "SCD", posted: 7.5, postedText: "7.5 Months", requestDate: "2026-03-01", label: "Advanced degree", officeLabel: "Service Center Operations" },
    { form: "I-485", subtype: "EB", office: "NBC", posted: 9, postedText: "9 Months", requestDate: null, label: "Employment", officeLabel: "National Benefits Center" },
  ],
  series: [],
  longestGapDays: 40,
  project: "x",
};
const cell = (printed: string, month: string | null) => ({ printed, month });
const POST = {
  key: "mumbai",
  slug: "mumbai",
  name: "Mumbai",
  now: { employment: cell("Sep-2026", "2026-09"), family: cell("Mar-2025", "2025-03"), immediate: cell("N/A", null) },
  issued: 9000,
  employment: 400,
};
const STEP = {
  id: "perm-decision", label: "PERM", group: "perm", verified: false, n: 40, windowDays: 183, median: 480, p25: 450, p75: 510,
  before: { median: 500, n: 30 }, allTime: 900, months: [{ month: "2026-10", n: 12, median: 470 }],
};
const SUMMARY = {
  today: "2026-11-25",
  headline: { cases: 1000, heard: 400, heardDays: 365, greenCards30: 5, i140s30: 6, perm30: 7 },
  week: { from: "2026-11-18", through: "2026-11-24", steps: [{ id: "perm-decision", label: "PERM certified", count: null }] },
  steps: [STEP],
  waiting: { open: true, heardDays: 365, heard: 400, byStage: [{ id: "perm", label: "PERM", count: 150 }], lines: [], unlisted: 400 },
  i140: [{ category: "EB-2", premium: "yes", reported: 40, decidedAllTime: 30, windowDays: 183, decided: 10, approvedShare: 0.9, medianDays: 12, rfeShare: 0.1 }],
};
const OVERVIEW = {
  people: 728, inSeveral: 29, i140s: 448,
  bySource: [{ source: "timeline", cases: 4 }, { source: "reddit", cases: 174 }],
  offices: [{ office: "SFV", cases: 276 }],
};
const cellOf = (graded: number) => ({
  recorded: 400, graded, typicalMissDays: 5, biasDays: 1, inBandShare: 0.8, within14Share: 0.9, settled: 10, settledHitShare: 0.7,
  overdue: 3, overdueDays: 4, missAtLeastDays: 6, biasAtLeastDays: 2,
});
const SCORECARD = {
  perm: { computedOn: "2026-11-25", since: "2026-01-01", bySource: { ours: { all: cellOf(200), current: cellOf(150), byModel: {}, byHorizon: {} } } },
  pwd: { computedOn: "2026-11-25", since: "2026-02-01", bySource: { ours: { all: cellOf(50), byModel: {}, byHorizon: {} } } },
  recent: [{ caseNumber: "G-100-26045-123456", recordedOn: "2026-10-01", predicted: "2026-11-01", decidedOn: "2026-11-03", model: "pace", outcome: "certified" }],
  computedAt: 1,
};
const BACKTEST = {
  t0: "2026-10-01", end: "2026-11-24", pace: 1, pendingAtT0: 1, inLineAtT0: 1,
  current: { cases: 100, decided: 80, typicalMissDays: 3, biasDays: 0, within7Share: 0.8, decidedByEndRight: 0.9 },
  allPending: { cases: 100, decided: 80, typicalMissDays: 3, biasDays: 0, within7Share: 0.8, decidedByEndRight: 0.9 },
  computedAt: 1,
};

const schemaOf = (id: string) => ENDPOINTS.find((e) => e.id === id)!.response.schema;
function fits(id: string, r: ReadResult<unknown>) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) return;
  const parsed = schemaOf(id).safeParse(r.data);
  expect(parsed.success, `${id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
}

beforeEach(() => {
  forgetKeptFigures();
  getSampleBlocks.mockReset().mockResolvedValue(BLOCKS);
  getSampleMeta.mockReset().mockResolvedValue({ as_of: "2026-11-25", cases: 2000 });
  getSampleMonths.mockReset().mockResolvedValue(MONTHS);
  getBlockMoves.mockReset().mockResolvedValue(MOVES);
  getI140Snapshot.mockReset().mockResolvedValue({
    sourceFile: "i140_fy2026_q3.xlsx", asOfQuarter: "FY2026 Q3", computedAt: 1,
    subtypes: [{ code: "E21", label: "Professionals with Advanced Degrees", received: 10, approved: 9, denied: 1, pending: 40 }],
  });
  getI140Trends.mockReset().mockResolvedValue(
    Array.from({ length: 10 }, (_, i) => ({ fiscalYear: 2024 + Math.floor(i / 4), quarter: (i % 4) + 1, category: "E21", categoryLabel: "Advanced", received: i, approved: i, denied: 0, pending: i })),
  );
  getUscisFormMedian.mockReset().mockResolvedValue({ form: "I-140", title: "Immigrant Petition", medianMonths: 6.5, fy: 2026, quarter: 3, quarterEnd: "2026-06-30", pending: 1, completed: 1 });
  getUscisPosted.mockReset().mockResolvedValue(POSTED);
  getEbAwaitingVisa.mockReset().mockResolvedValue({ asOf: "2026-06", sourceFile: "awaiting.xlsx", cells: [{ country: "TOTAL", category: "TOTAL", count: 1_000_000 }], previous: null });
  getI485Offices.mockReset().mockResolvedValue({
    fy: 2026, quarter: 3, quarterEnd: "2026-06-30", sourceFile: "i485.xlsx",
    total: office("ALL", 5000), offices: [office("SFV", 300), office("XYZ", null)],
    previous: { fy: 2026, quarter: 2, empPendingByCode: { ALL: 5200, SFV: 320 } },
  });
  getI485Trend.mockReset().mockResolvedValue([
    { asOf: "2026-08-01", total: 100, available: 40, awaiting: 60 },
    { asOf: "2026-09-01", total: 120, available: 40, awaiting: 80 },
  ]);
  getConsularIndex.mockReset().mockResolvedValue({ asOf: "2026-11-20", readings: ["2026-11-20"], posts: [POST], issuedFrom: "2025-09", issuedTo: "2026-08" });
  getPostDetail.mockReset().mockImplementation(async (slug: string) =>
    slug === "mumbai" ? { ...POST, history: [{ asOf: "2026-11-20", cells: POST.now }], months: [{ month: "2026-08", byCategory: { "EB-2": 30 } }] } : null,
  );
  getReportedSummary.mockReset().mockResolvedValue(SUMMARY);
  getOfficeSummary.mockReset().mockImplementation(async (code: string) => (code === "SFV" ? { today: "2026-11-25", cases: 276, steps: [STEP] } : null));
  getPostSummary.mockReset().mockResolvedValue(null);
  getReportedOverview.mockReset().mockResolvedValue(OVERVIEW);
  getEstimateChecks.mockReset().mockResolvedValue([{ key: "perm-line", estimate: "When DOL decides", result: "3 days typically", basis: "80 cases" }]);
  getEstimatorBacktest.mockReset().mockResolvedValue(BACKTEST);
  getScorecardSummary.mockReset().mockResolvedValue(SCORECARD);
});

/* ---------------------------------------------------------------- the sample */

describe("the receipt-number sample", () => {
  it("gives the I-485's shares in every block it holds, in block order, with where approvals stop", async () => {
    const r = await readReceiptBlocks();
    fits("getReceiptBlocks", r);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ form: "I-485", approvalsSeenUpTo: "IOE09365", casesInSample: 2000 });
    expect((r.data.blocks as { block: string }[]).map((b) => b.block)).toEqual(["IOE09364", "IOE09365", "IOE09366"]);
    expect(r.meta).toMatchObject({ asOf: "2026-11-25", url: "https://permtracker.app/uscis-receipt-blocks" });
    // The list carries the chart's figure, the approved share. Every group is the one-block answer's.
    expect((r.data.blocks as Record<string, unknown>[])[0]).toEqual({ block: "IOE09364", counted: 10, approved: BLOCKS.by_block.IOE09364["I-485"].groups.approved });
  });

  it("keeps the blocks near one when asked, and refuses a near that isn't a block", async () => {
    const r = await readReceiptBlocks("I-485", "ioe09366");
    fits("getReceiptBlocks", r);
    expect(r.ok && r.data.near).toBe("IOE09366");
    expect(await readReceiptBlocks("I-485", "IOE0936612345")).toMatchObject({ ok: false, status: 400 });
  });

  it("reads a form however it's typed, and refuses what isn't one", async () => {
    expect(formName("i765")).toBe("I-765");
    expect(formName(" I-485 ")).toBe("I-485");
    expect(formName("hello world")).toBeNull();
    const r = await readReceiptBlocks("i765");
    expect(r.ok && r.data.form).toBe("I-765");
    expect(await readReceiptBlocks("not a form")).toMatchObject({ ok: false, status: 400 });
    expect(await readReceiptBlocks("N-400")).toMatchObject({ ok: false, status: 404 });
  });

  it("answers one block with its forms, the blocks either side and the newest moves as counts", async () => {
    const r = await readReceiptBlock("ioe09365");
    fits("getReceiptBlock", r);
    expect(r.ok && r.data).toMatchObject({ block: "IOE09365", before: "IOE09364", after: "IOE09366", recentMoves: [{ day: "2026-11-24", movedTo: "approved", cases: 2 }] });
    expect(getBlockMoves).toHaveBeenCalledWith("IOE09365");
  });

  it("still answers a block when its moves can't be read, and names them", async () => {
    getBlockMoves.mockRejectedValue(new Error("no such table: uscis_sample_events"));
    const r = await readReceiptBlock("IOE09365");
    fits("getReceiptBlock", r);
    expect(r.ok && r.data).toMatchObject({ block: "IOE09365", recentMoves: null, unreadable: ["recentMoves"] });
  });

  it("refuses a whole receipt number without repeating it", async () => {
    const r = await readReceiptBlock("IOE0936612345");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(JSON.stringify(r)).not.toMatch(RECEIPT_SHAPE);
    expect(getSampleBlocks).not.toHaveBeenCalled();
  });

  it("names the nearest blocks with cases when asked for one the sample hasn't reached", async () => {
    const r = await readReceiptBlock("IOE09367");
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(r.ok ? "" : r.message).toContain("IOE09366");
  });

  it("gives the shares by receipt month, newest first, saying which months were partly walked", async () => {
    const r = await readReceiptMonths();
    fits("getReceiptMonths", r);
    const months = r.ok ? (r.data.months as { month: string; walked: boolean; approved: { count: number } }[]) : [];
    expect(months.map((m) => [m.month, m.walked, m.approved.count])).toEqual([["2026-02", false, 10], ["2026-01", true, 30]]);
  });

  it("says the sample isn't loaded yet, never that it holds nothing", async () => {
    getSampleBlocks.mockResolvedValue(null);
    expect(await readReceiptBlocks()).toMatchObject({ ok: false, status: 503, code: "unavailable" });
  });

  it("keeps an answer a few minutes rather than reading again", async () => {
    await readReceiptBlocks();
    await readReceiptBlocks();
    expect(getSampleBlocks).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------- USCIS */

describe("USCIS's own figures", () => {
  it("gives the I-140 quarter, the newest eight quarters, both processing times and the visa-number wait", async () => {
    const r = await readUscisI140();
    fits("getUscisPetitions", r);
    if (!r.ok) return;
    expect((r.data.byQuarter as unknown[]).length).toBe(8);
    expect(r.data.processingTimes).toMatchObject({ postedOn: "2026-11-20", rows: [{ subtype: "E21", months: 7.5, inquiryFrom: "2026-03-01" }] });
    expect(r.data.unreadable).toEqual([]);
  });

  it("names a part it couldn't read and sends null for it, never an empty list", async () => {
    getI140Trends.mockRejectedValue(new Error("SQLITE_BUSY"));
    const r = await readUscisI140();
    expect(r.ok && r.data).toMatchObject({ byQuarter: null, unreadable: ["byQuarter"] });
  });

  it("fails the call when every part failed", async () => {
    for (const f of [getI140Snapshot, getI140Trends, getUscisFormMedian, getUscisPosted, getEbAwaitingVisa]) f.mockRejectedValue(new Error("down"));
    await expect(readUscisI140()).rejects.toThrow("down");
  });

  it("gives every office's I-485 counts with last quarter's employment pending, a withheld figure as null", async () => {
    const r = await readUscisI485();
    fits("getUscisAdjustments", r);
    if (!r.ok) return;
    const offices = (r.data.byOffice as { offices: { code: string; withheld: number; employment: Record<string, unknown> }[] }).offices;
    expect(offices[0]).toMatchObject({ code: "SFV", employment: { pending: 300, pendingLastQuarter: 320 } });
    expect(offices[1]).toMatchObject({ code: "XYZ", withheld: 1, employment: { pending: null, pendingLastQuarter: null } });
    expect(r.data.inventory).toMatchObject({ newest: { asOf: "2026-09-01", pending: 120, awaitingVisa: 80 } });
    expect(r.data.processingTimes).toMatchObject({ rows: [{ subtype: "EB", months: 9 }] });
    expect(getUscisFormMedian).toHaveBeenCalledWith("I-485", "Employment");
  });
});

/* ---------------------------------------------------------------- consulates */

describe("the consulates", () => {
  it("lists each consulate's line with how far behind it is, and its year of issuances", async () => {
    const r = await readConsulates();
    fits("listConsulates", r);
    expect(r.ok && r.data.posts).toEqual([
      expect.objectContaining({
        slug: "mumbai",
        scheduling: {
          employment: { asPrinted: "Sep-2026", month: "2026-09", monthsBehind: 2 },
          family: { asPrinted: "Mar-2025", month: "2025-03", monthsBehind: 20 },
          immediate: { asPrinted: "N/A", month: null, monthsBehind: null },
        },
        issuedLast12Months: 9000,
        url: "https://permtracker.app/consular-posts/mumbai",
      }),
    ]);
  });

  it("gives one consulate's history and monthly issuances, and refuses a slug that isn't one", async () => {
    const r = await readConsulate("Mumbai");
    fits("getConsulate", r);
    expect(r.ok && r.data.monthlyIssuances).toEqual([{ month: "2026-08", byCategory: { "EB-2": 30 } }]);
    expect(await readConsulate("no such place")).toMatchObject({ ok: false, status: 400 });
    expect(await readConsulate("atlantis")).toMatchObject({ ok: false, status: 404 });
  });
});

/* ---------------------------------------------------------------- timelines */

describe("the timelines people reported", () => {
  it("gives every step, who's waiting and the merged list, with each source under the name the page shows", async () => {
    const r = await readTimelines();
    fits("getTimelines", r);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ scope: "all", place: null, cases: 1000, steps: [{ id: "perm-decision", medianDays: 480, cases: 40 }] });
    const sources = (r.data.overview as { sources: { name: string }[] }).sources.map((s) => s.name);
    expect(sources).toEqual(["Shared here", "Reddit"]);
    expect(JSON.stringify(r.data)).not.toContain('"timeline"');
  });

  it("gives one office's figures, and says when a place has too few", async () => {
    const r = await readTimelines({ office: "sfv" });
    fits("getTimelines", r);
    expect(r.ok && r.data).toMatchObject({ scope: "office", place: "SFV", cases: 276, overview: null });
    expect(r.ok && r.meta.url).toBe("https://permtracker.app/i485-by-field-office/san-fernando-valley-california");
    expect(await readTimelines({ consulate: "mumbai" })).toMatchObject({ ok: false, status: 404 });
    expect(await readTimelines({ office: "SFV", consulate: "mumbai" })).toMatchObject({ ok: false, status: 400 });
    expect(await readTimelines({ office: "SF" })).toMatchObject({ ok: false, status: 400 });
  });

  it("still answers when the merged list can't be read, and says so", async () => {
    getReportedOverview.mockRejectedValue(new Error("busy"));
    const r = await readTimelines();
    expect(r.ok && r.data).toMatchObject({ overview: null, unreadable: ["overview"] });
  });
});

/* ---------------------------------------------------------------- accuracy */

describe("the estimates' own record", () => {
  it("gives the checks, the backtest and our own daily sample as the case page dates cases now", async () => {
    const r = await readAccuracy();
    fits("getAccuracy", r);
    if (!r.ok) return;
    expect(r.data.permBacktest).toMatchObject({ from: "2026-10-01", to: "2026-11-24", decided: 80, typicalMissDays: 3 });
    expect(r.data.dailySample).toMatchObject({ perm: { graded: 150, since: "2026-01-01" }, pwd: { graded: 50 } });
    expect(r.meta.asOf).toBe("2026-11-25");
  });

  it("leaves out the worked examples' case numbers", async () => {
    const r = await readAccuracy();
    expect(JSON.stringify(r)).not.toContain("G-100-26045-123456");
  });
});

/* ---------------------------------------------------------------- receipts */

describe("no answer holds a receipt number", () => {
  const reads: [string, () => Promise<ReadResult<unknown>>][] = [
    ["getReceiptBlocks", () => readReceiptBlocks()],
    ["getReceiptBlock", () => readReceiptBlock("IOE09364")],
    ["getReceiptMonths", () => readReceiptMonths()],
    ["getUscisPetitions", () => readUscisI140()],
    ["getUscisAdjustments", () => readUscisI485()],
    ["listConsulates", () => readConsulates()],
    ["getConsulate", () => readConsulate("mumbai")],
    ["getTimelines", () => readTimelines()],
    ["getAccuracy", () => readAccuracy()],
  ];

  it("covers every figure operation in the registry", () => {
    const figures = ENDPOINTS.filter((e) => ["USCIS", "Consulates", "Reported timelines", "Accuracy"].includes(e.tag)).map((e) => e.id);
    expect(reads.map(([id]) => id).sort()).toEqual(figures.sort());
  });

  it.each(reads)("%s answers with nothing shaped like a receipt", async (_id, read) => {
    const r = await read();
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(RECEIPT_SHAPE);
  });

  it("holds every documented example and sandbox sample to the same rule", () => {
    for (const e of ENDPOINTS) expect(JSON.stringify(e.response.example), e.id).not.toMatch(RECEIPT_SHAPE);
  });

  it("refuses an answer that would carry one: a stored figure holding a receipt fails the call", async () => {
    // Control: the pattern finds the shapes people type, and the guard throws on them.
    for (const s of ["IOE0912345678", "EAC2412345678", "ioe0912345678"]) expect(s).toMatch(RECEIPT_SHAPE);
    expect(() => noReceipts({ ok: true, data: { note: "IOE0912345678" }, meta: { source: "x", asOf: null, url: "x" } })).toThrow();
    getSampleBlocks.mockResolvedValue({ ...BLOCKS, by_block: { ...BLOCKS.by_block, IOE09364: { ...BLOCKS.by_block.IOE09364, "IOE0912345678": form(3, 1) } } });
    await expect(readReceiptBlock("IOE09364")).rejects.toThrow(/receipt/);
  });
});
