// @vitest-environment jsdom
/**
 * A typed receipt's last status from the sample says when the sample first saw it, never that USCIS has shown it since
 * then: the sample's first sighting can be later than USCIS's change.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/uscisSample", () => ({
  getReceiptLastStatus: async () => ({
    form: "I-485",
    grp: "approved",
    status: "Case Was Approved",
    checked_on: "2026-11-24",
    since_on: "2026-11-20",
  }),
}));
vi.mock("@/lib/uscisSample", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uscisSample")>()),
  RECEIPT_LAST_STATUS_SHOWN: true,
}));

const { ReceiptSampleNote } = await import("../ReceiptSampleNote");

describe("a typed receipt's last status from the sample", () => {
  it("dates the status by when the sample first saw it", async () => {
    const { container } = render(await ReceiptSampleNote({ receipt: "IOE0000000012" }));
    const text = container.textContent ?? "";
    expect(text).toContain("on November 24, 2026, USCIS showed Case Was Approved for an I-485.");
    expect(text).toContain("Our sample first saw that status on November 20, 2026; USCIS may have shown it earlier.");
    expect(text).not.toContain("held since");
  });
});
