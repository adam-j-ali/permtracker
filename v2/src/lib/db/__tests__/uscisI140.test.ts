/**
 * The I-140 quarter comes from the database alone (Nov 25 2026): the Convex copy is written only from GitHub, which
 * USCIS refuses, so it stopped moving, and a failed database read must keep the page's last good render rather than
 * show that frozen quarter.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const doc = vi.fn<(key: string) => Promise<unknown>>();
vi.mock("../publicData", () => ({ doc }));

const QUARTER = {
  sourceFile: "i140_fy2026_q3_v1.xlsx",
  asOfQuarter: "FY2026 Q3",
  computedAt: 1,
  subtypes: [{ code: "EB2", label: "EB-2", received: 10, approved: 5, denied: 1, pending: 20 }],
};

describe("getI140Snapshot", () => {
  beforeEach(() => {
    doc.mockReset();
  });

  it("reads the database's quarter", async () => {
    doc.mockResolvedValue(QUARTER);
    const { getI140Snapshot } = await import("../uscisI140");
    expect((await getI140Snapshot(3600))?.asOfQuarter).toBe("FY2026 Q3");
  });

  it("lets a failed read throw, so the page keeps its last good render", async () => {
    doc.mockRejectedValue(new Error("database unreachable"));
    const { getI140Snapshot } = await import("../uscisI140");
    await expect(getI140Snapshot(3600)).rejects.toThrow("database unreachable");
  });

  it("says nothing when the database has never held a quarter", async () => {
    doc.mockResolvedValue(null);
    const { getI140Snapshot } = await import("../uscisI140");
    expect(await getI140Snapshot(3600)).toBeNull();
  });
});
