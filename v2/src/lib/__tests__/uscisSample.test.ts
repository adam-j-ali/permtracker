/**
 * The USCIS sample's block figures, read for the receipt-block pages (Batch 3): which block a typed receipt or block
 * name means, each block's forms and approval share with its margin, the series a chart draws, and where approvals stop.
 */
import { describe, expect, it } from "vitest";
import { approvalsStopAfter, blockForms, blockFromInput, blockSeries, neighbours, type SampleBlocksDoc } from "../uscisSample";

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
