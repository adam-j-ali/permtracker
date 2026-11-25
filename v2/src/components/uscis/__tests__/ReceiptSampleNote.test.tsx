// @vitest-environment jsdom
/**
 * A typed receipt's note from the sample: its own last status, dated by when the sample first saw it (the sample's
 * first sighting can be later than USCIS's change); the checked numbers around it, counted and the nearest listed;
 * and the links to its block and to every number checked in the block, at the page that holds this one.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const around = vi.hoisted(() => ({ rows: [] as Array<Record<string, string | null>> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/uscisSample", () => ({
  getReceiptLastStatus: async () => ({
    form: "I-485",
    grp: "approved",
    status: "Case Was Approved",
    checked_on: "2026-11-24",
    since_on: "2026-11-20",
  }),
  getCasesAround: async () => around.rows,
  blockPlace: async () => 60,
}));
vi.mock("@/lib/uscisSample", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uscisSample")>()),
  RECEIPT_LAST_STATUS_SHOWN: true,
}));

const { ReceiptSampleNote } = await import("../ReceiptSampleNote");

const row = (n: number, grp: string) => ({
  receipt: `IOE00000000${String(n).padStart(2, "0")}`,
  form: "I-485",
  grp,
  status: grp === "approved" ? "Case Was Approved" : "Case Is Being Actively Reviewed By USCIS",
  checked_on: "2026-11-24",
  since_on: "2026-11-20",
});

describe("a typed receipt's note from the sample", () => {
  it("dates the status by when the sample first saw it", async () => {
    around.rows = [];
    const { container } = render(await ReceiptSampleNote({ receipt: "IOE0000000012" }));
    const text = container.textContent ?? "";
    expect(text).toContain("on November 24, 2026, USCIS showed Case Was Approved for an I-485.");
    expect(text).toContain("Our sample first saw that status on November 20, 2026. USCIS may have shown it earlier, and its own page has today's.");
    expect(text).not.toContain("Cases around yours");
  });

  it("counts the numbers around it, lists the nearest ten each side, and links the block's list at this number's page", async () => {
    around.rows = [
      ...Array.from({ length: 15 }, (_, i) => row(10 + i, i % 3 ? "waiting" : "approved")),
      ...Array.from({ length: 15 }, (_, i) => row(40 + i, "waiting")),
    ];
    const { container } = render(await ReceiptSampleNote({ receipt: "IOE0000000030" }));
    const text = container.textContent ?? "";
    expect(text).toContain("our sample checked 30: 5 approved, 25 waiting. The nearest 20 are below.");
    const listed = [...container.querySelectorAll("tbody th")].map((th) => th.textContent?.trim());
    expect(listed).toHaveLength(20);
    expect(listed[0]).toBe("IOE0000000015");
    expect(listed[19]).toBe("IOE0000000049");
    const link = container.querySelector('a[href^="/uscis-receipt-blocks/IOE00000/numbers"]');
    expect(link?.getAttribute("href")).toBe("/uscis-receipt-blocks/IOE00000/numbers?page=3&at=IOE0000000030");
  });
});
