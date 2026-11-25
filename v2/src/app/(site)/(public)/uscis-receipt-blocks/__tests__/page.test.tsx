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
vi.mock("@/lib/db/uscisSample", () => ({
  getSampleMeta: async () => ({ as_of: "2026-11-29", cases: 52_000 }),
  getSampleBlocks: async () => ({ as_of: "2026-11-29", groups: [], by_block: {} }),
  getSampleMonths: async () => null,
  getSampleIssued,
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
