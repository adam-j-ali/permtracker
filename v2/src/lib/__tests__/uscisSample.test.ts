/**
 * The USCIS sample's block figures, read for the receipt-block pages (Batch 3): which block a typed receipt or block
 * name means, each block's forms and approval share with its margin, the series a chart draws, and where approvals stop.
 */
import { describe, expect, it } from "vitest";
import { approvalsStopAfter, blockForms, blockFromInput, countedExactly, blockSeries, blocksInMonth, decidedThrough, neighbours, type SampleBlocksDoc } from "../uscisSample";

const g = (count: number, share: number, low: number, high: number) => ({ count, estimated: count, share, low, high });
const form = (counted: number, approved: number) => ({
  counted, walked_cases: 0, drawn_cases: counted, rest_unknown: false, rest_share: 1,
  groups: {
    approved: g(approved, approved / counted, Math.max(0, approved / counted - 0.2), Math.min(1, approved / counted + 0.2)),
    denied: g(0, 0, 0, 0.1), withdrawn: g(0, 0, 0, 0.1), closed: g(0, 0, 0, 0.1), revoked: g(0, 0, 0, 0.1),
    rfe: g(0, 0, 0, 0.1), waiting: g(counted - approved, 1 - approved / counted, 0, 1),
  },
});
const DOC: SampleBlocksDoc = {
  as_of: "2026-11-25",
  groups: ["approved", "denied", "withdrawn", "closed", "revoked", "rfe", "waiting"],
  by_block: {
    IOE09364: { _skipped: 0, _walked_share: 0, _draws: 50, "I-485": form(10, 5), "I-765": form(20, 18) },
    IOE09365: { _skipped: 0, _walked_share: 0, _draws: 50, "I-485": form(8, 1) },
    IOE09366: { _skipped: 0, _walked_share: 0, _draws: 50, "I-485": form(14, 0), "I-130": form(3, 0) },
    IOE09367: { _skipped: 0, _walked_share: 0, _draws: 40 },
    IOE90184: {},
  },
};

describe("blockFromInput", () => {
  it("reads a block name, a whole receipt and the ways people type them", () => {
    expect(blockFromInput("IOE09366")).toBe("IOE09366");
    expect(blockFromInput(" ioe 09366 ")).toBe("IOE09366");
    expect(blockFromInput("IOE0000000000")).toBe("IOE00000");
    expect(blockFromInput("ioe-0000-000000")).toBe("IOE00000");
  });
  it("gives no block for a service-center number or anything else", () => {
    expect(blockFromInput("EAC3512345678")).toBeNull();
    expect(blockFromInput("IOE093")).toBeNull();
    expect(blockFromInput("hello")).toBeNull();
  });
});

describe("blockForms", () => {
  it("lists a block's forms, most counted first, with the approved share and its margin", () => {
    const forms = blockForms(DOC.by_block.IOE09364!);
    expect(forms.map((f) => f.form)).toEqual(["I-765", "I-485"]);
    expect(forms[1]).toMatchObject({ form: "I-485", counted: 10, approved: { count: 5, share: 0.5 } });
  });
  it("is empty for a block with no cases", () => {
    expect(blockForms(DOC.by_block.IOE09367!)).toEqual([]);
  });
});

describe("blockSeries and approvalsStopAfter", () => {
  it("draws one point per block holding the form, in block order", () => {
    expect(blockSeries(DOC, "I-485").map((p) => p.block)).toEqual(["IOE09364", "IOE09365", "IOE09366"]);
  });
  it("marks the last block with an approval in the sample", () => {
    expect(approvalsStopAfter(blockSeries(DOC, "I-485"))).toBe("IOE09365");
    expect(approvalsStopAfter(blockSeries(DOC, "I-130"))).toBeNull();
  });
});

describe("neighbours", () => {
  it("names the blocks either side that hold cases, skipping empty ones", () => {
    expect(neighbours(DOC, "IOE09365")).toEqual({ before: "IOE09364", after: "IOE09366" });
    expect(neighbours(DOC, "IOE09366")).toEqual({ before: "IOE09365", after: null });
  });
});

describe("topForms and chartSeries", () => {
  it("ranks forms by sampled cases and leads the chart with the I-485", async () => {
    const { chartSeries, topForms } = await import("../uscisSample");
    expect(topForms(DOC, 2)).toEqual(["I-485", "I-765"]);
    const series = chartSeries(DOC, ["I-765", "I-485"]);
    expect(series.map((s) => s.form)).toEqual(["I-485", "I-765"]);
    expect(series[0]).toMatchObject({ stopAfter: "IOE09365" });
    expect(series[0]!.points[0]).toEqual({ block: "IOE09364", counted: 10, count: 5, share: 0.5, low: 0.3, high: 0.7 });
  });
});

describe("monthRows", () => {
  it("lists the months holding a form, newest first, with the walked flag", async () => {
    const { monthRows } = await import("../uscisSample");
    const doc = {
      as_of: "2026-11-25",
      groups: [],
      by_month: {
        "2026-09": { _skipped: 0, _walked_share: 0, _draws: 10, "I-485": form(10, 4) },
        "2026-10": { _skipped: 0, _walked_share: 0.05, _draws: 10, "I-485": form(20, 2), "I-765": form(5, 5) },
        "2026-11": { _skipped: 0, _walked_share: 0, _draws: 10, "I-765": form(3, 0) },
      },
    };
    const rows = monthRows(doc, "I-485");
    expect(rows.map((r) => r.month)).toEqual(["2026-10", "2026-09"]);
    expect(rows[0]).toMatchObject({ counted: 20, walked: true, approved: { count: 2 } });
    expect(rows[1]!.walked).toBe(false);
  });
});

describe("newestCompleteMonths", () => {
  const doc = {
    as_of: "2026-11-25",
    groups: [],
    by_month: {
      "2026-06": { "I-485": form(40, 30) },
      "2026-07": { "I-485": form(25, 10) },
      "2026-08": { "I-485": form(19, 9) },
      "2026-09": { "I-485": form(60, 6) },
      "2026-10": { "I-485": form(4000, 0), "I-765": form(500, 90) },
      "2026-11": { "I-485": form(40000, 0) },
    },
  };

  it("leaves out the month the sample is dated in, which is still filling, and gives the newest three after it", async () => {
    const { newestCompleteMonths } = await import("../uscisSample");
    expect(newestCompleteMonths(doc, "I-485").map((m) => m.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("keeps a month with few cases, with its count and margin, and carries each month's figures", async () => {
    const { newestCompleteMonths } = await import("../uscisSample");
    const [oct, sep, aug] = newestCompleteMonths(doc, "I-485");
    expect(oct).toMatchObject({ month: "2026-10", counted: 4000, approved: { count: 0, share: 0 } });
    expect(aug).toMatchObject({ month: "2026-08", counted: 19, approved: { count: 9 } });
    expect(sep!.approved.low).toBeLessThan(sep!.approved.share);
    expect(newestCompleteMonths(doc, "I-485", 5).map((m) => m.month)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"]);
  });

  it("gives nothing for a form the sample doesn't hold", async () => {
    const { newestCompleteMonths } = await import("../uscisSample");
    expect(newestCompleteMonths(doc, "I-129F")).toEqual([]);
    expect(newestCompleteMonths(doc, "I-765").map((m) => m.month)).toEqual(["2026-10"]);
  });
});

describe("pendingEstimate (Batch 3: pending by month, Nov 25 2026)", () => {
  const g = (estimated: number, share: number, low: number, high: number) => ({ count: 0, estimated, share, low, high });
  const figure = {
    counted: 400, walked_cases: 0, drawn_cases: 400, rest_unknown: false, rest_share: null,
    groups: {
      approved: g(6000, 0.6, 0.55, 0.65), denied: g(200, 0.02, 0.01, 0.03), withdrawn: g(0, 0, 0, 0.01),
      closed: g(0, 0, 0, 0.01), revoked: g(0, 0, 0, 0.01), rfe: g(800, 0.08, 0.06, 0.1), waiting: g(3000, 0.3, 0.26, 0.34),
    },
  };
  it("is the waiting group's estimated count, its range the margin applied to all the month's cases", async () => {
    const { pendingEstimate } = await import("../uscisSample");
    expect(pendingEstimate(figure as never)).toEqual({ estimated: 3000, low: 2600, high: 3400 });
  });
  it("says nothing for a month with no estimated cases", async () => {
    const { pendingEstimate } = await import("../uscisSample");
    const empty = { ...figure, groups: Object.fromEntries(Object.keys(figure.groups).map((k) => [k, g(0, 0, 0, 0)])) };
    expect(pendingEstimate(empty as never)).toBeNull();
  });
});

describe("which receipt month USCIS has reached", () => {
  const m = (month: string, counted: number, decided: number) => ({ month, counted, decided, low: decided - 0.02, high: decided + 0.02 });
  const doc = {
    as_of: "2026-11-26",
    forms: { "I-485": [m("2026-02", 400, 0.8), m("2026-03", 13371, 0.51), m("2026-04", 9000, 0.34), m("2026-05", 20, 0.9)] },
  };

  it("is the newest month at least half decided, with enough cases, and the month after it", () => {
    const r = decidedThrough(doc, "I-485");
    expect(r?.reached.month).toBe("2026-03");
    expect(r?.reached.decided).toBeCloseTo(0.51);
    expect(r?.next?.month).toBe("2026-04");
  });

  it("has no answer for a form the sample hasn't seen half decided", () => {
    expect(decidedThrough(doc, "I-130")).toBeNull();
  });

  it("finds the blocks whose cases were received in a month", () => {
    const blocks = {
      by_block: {
        IOE09358: { _received_from: "2026-02-27", _received_to: "2026-03-05" },
        IOE09360: { _received_from: "2026-03-13", _received_to: "2026-03-20" },
        IOE09364: { _received_from: "2026-04-02", _received_to: "2026-04-09" },
      },
    } as never;
    expect(blocksInMonth(blocks, "2026-03")).toEqual(["IOE09358", "IOE09360"]);
    expect(blocksInMonth(blocks, "2026-08")).toBeNull();
  });
});


describe("countedExactly", () => {
  const g = (low: number, high: number) => ({ count: 0, estimated: 0, share: 0, low, high });
  it("a block with every number checked is counted exactly, whatever the range says", () => {
    // Nov 27 2026: IOE09391 read every number checked yet "0 of 15,441 sampled, likely between 0% and 7%".
    expect(countedExactly(g(0, 0.0699), true)).toBe(true);
  });
  it("a share with no range is counted exactly", () => {
    expect(countedExactly(g(0.12, 0.12), false)).toBe(true);
  });
  it("a share estimated from draws keeps its range", () => {
    expect(countedExactly(g(0.04, 0.09), false)).toBe(false);
  });
});
