// @vitest-environment jsdom
/**
 * The receipt blocks page's "now" cards: receipts issued a day shows only once the census's runs cover a full week,
 * and names the week's last day and the forms with the most cases.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssuedRun } from "@/lib/uscisIssued";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/data/DataProvenance", () => ({ DataProvenance: () => null }));
vi.mock("@/components/uscis/BlockSearch", () => ({ BlockSearch: () => null }));
vi.mock("@/components/uscis/BlockApprovalChart", () => ({ BlockApprovalChart: () => null }));
const getSampleIssued = vi.fn(async () => [] as IssuedRun[]);
const getSampleBlocks = vi.fn(async () => ({ as_of: "2026-11-29", groups: [] as string[], by_block: {} as Record<string, Record<string, number>> }));
const getBlockMixes = vi.fn(async () => ({}) as Record<string, { grp: string; status: string; n: number }[]>);
vi.mock("@/lib/db/uscisSample", () => ({
  getSampleMeta: async () => ({ as_of: "2026-11-29", cases: 52_000 }),
  getSampleBlocks,
  getSampleMonths: async () => null,
  getSampleIssued,
  getBlockMixes,
}));

const { default: UscisReceiptBlocksPage } = await import("../page");

const day = (d: number, byForm: Record<string, number>): IssuedRun => {
  const issued = Object.values(byForm).reduce((a, b) => a + b, 0);
  return { day: `2026-11-${d}`, block: "IOE09", issued, hours: 24, per_day: issued, by_form: byForm };
};

describe("/uscis-receipt-blocks: receipts issued a day", () => {
  beforeEach(() => getSampleIssued.mockReset());

  it("leaves the card out until a full week of runs exists", async () => {
    getSampleIssued.mockResolvedValue([day(28, { "I-765": 9_000 }), day(29, { "I-765": 9_000 })]);
    const { container } = render(await UscisReceiptBlocksPage());
    expect(container.textContent).not.toContain("Online receipts issued a day");
  });

  it("shows the week's rate, its last day and the top forms", async () => {
    getSampleIssued.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => day(23 + i, { "I-765": 9_000, "I-485": 4_000, "I-131": 2_000, "I-140": 1_000 })),
    );
    const { container } = render(await UscisReceiptBlocksPage());
    const text = container.textContent ?? "";
    expect(text).toContain("Online receipts issued a day");
    expect(text).toContain("16,000");
    expect(text).toContain("issued in the week to Nov 29, most for the I-765, I-485 and I-131.");
  });
});

describe("/uscis-receipt-blocks: blocks with every number checked", () => {
  beforeEach(() => {
    getSampleIssued.mockReset();
    getSampleIssued.mockResolvedValue([]);
  });

  it("lists only the blocks the census walked whole, newest first, each linking to its card", async () => {
    getSampleBlocks.mockResolvedValue({
      as_of: "2026-11-29",
      groups: [],
      by_block: { IOE09376: { _walked_share: 1 }, IOE09377: { _walked_share: 1 }, IOE09360: { _walked_share: 0 } },
    });
    getBlockMixes.mockResolvedValue({
      IOE09376: [{ grp: "approved", status: "", n: 30 }, { grp: "waiting", status: "", n: 70 }],
      IOE09377: [{ grp: "approved", status: "", n: 34 }, { grp: "waiting", status: "", n: 62 }, { grp: "denied", status: "", n: 4 }],
    });
    const { container } = render(await UscisReceiptBlocksPage());
    expect(getBlockMixes).toHaveBeenCalledWith(["IOE09377", "IOE09376"]);
    const links = [...container.querySelectorAll('a[href^="/uscis-receipt-blocks/IOE"]')].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/uscis-receipt-blocks/IOE09377", "/uscis-receipt-blocks/IOE09376"]);
    expect(container.textContent).toContain("34% approved, 62% waiting");
    expect(container.textContent).not.toContain("IOE09360");
  });

  it("leaves the list out before any block is walked whole", async () => {
    getSampleBlocks.mockResolvedValue({ as_of: "2026-11-29", groups: [], by_block: { IOE09360: { _walked_share: 0.2 } } });
    const { container } = render(await UscisReceiptBlocksPage());
    expect(container.textContent).not.toContain("Blocks with every number checked");
  });
});
