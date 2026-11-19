import { describe, expect, it } from "vitest";

import { fromI140Row, i140Figures, MIN_CASES, PREMIUM_LABELS, type I140Case } from "../reportedI140";

const niw = (n: number, over: Partial<I140Case> = {}): I140Case => ({
  category: "EB-2 NIW",
  premium: "with filing",
  filed: "2026-01-01",
  decision: "approved",
  decided: `2026-02-${String(n + 9).padStart(2, "0")}`,
  rfe: "none",
  ...over,
});

describe("i140Figures", () => {
  it("gives the share approved, the median days and the RFE share once five cases stand behind each", () => {
    const cases = [niw(1), niw(2), niw(3), niw(4, { decision: "denied" }), niw(5, { rfe: "rfe" })];
    const [row] = i140Figures(cases);
    expect(row).toEqual({
      category: "EB-2 NIW", premium: "with filing", reported: 5, decided: 5,
      approvedShare: 4 / 5, medianDays: 42, rfeShare: 1 / 5,
    });
  });

  it("gives no figure from fewer than five, and still counts the cases", () => {
    const [row] = i140Figures([niw(1), niw(2)]);
    expect(MIN_CASES).toBe(5);
    expect(row).toMatchObject({ reported: 2, approvedShare: null, medianDays: null, rfeShare: null });
  });

  it("keeps each kind of premium processing apart, in a fixed order, every kind named", () => {
    const rows = i140Figures([
      niw(1, { premium: "none" }), niw(2, { premium: "after filing" }), niw(3), niw(4, { premium: null }), niw(5, { premium: "yes" }),
    ]);
    expect(rows.map((r) => r.premium)).toEqual(["with filing", "after filing", "yes", "none", "not given"]);
    expect(rows.every((r) => PREMIUM_LABELS[r.premium].length > 0)).toBe(true);
  });

  it("never counts a pending case as decided, a decision dated before its filing, or an RFE nobody mentioned", () => {
    const cases = [
      ...[1, 2, 3, 4, 5].map((n) => niw(n)),
      niw(6, { decision: "pending", decided: null }),
      niw(7, { decided: "2025-12-01" }),
      niw(8, { rfe: null }),
    ];
    const [row] = i140Figures(cases);
    expect(row!.reported).toBe(8);
    expect(row!.decided).toBe(7);
    expect(row!.rfeShare).toBe(0);
  });

  it("counts a notice of intent to deny with the RFEs", () => {
    const [row] = i140Figures([1, 2, 3, 4, 5].map((n) => niw(n, { rfe: n === 1 ? "noid" : "none" })));
    expect(row!.rfeShare).toBe(1 / 5);
  });

  it("orders the categories people file most first, and leaves out a non-I-140 row", () => {
    const rows = i140Figures([niw(1, { category: "EB-1A" }), niw(2), niw(3, { category: "O-1A" })]);
    expect(rows.map((r) => r.category)).toEqual(["EB-2 NIW", "EB-1A"]);
  });
});

describe("a stored row", () => {
  it("reads the I-140's own dates: the filing day, falling back to a self-petition's priority date", () => {
    const c = fromI140Row({ category: "EB-1A", premium: "after filing", i140_receipt: null, priority_date: "2026-01-05",
      i140_decision: "approved", i140_decided: "2026-03-01", i140_rfe: "rfe" });
    expect(c).toEqual({ category: "EB-1A", premium: "after filing", filed: "2026-01-05", decision: "approved", decided: "2026-03-01", rfe: "rfe" });
    expect(fromI140Row({ category: "EB-2", premium: null, i140_receipt: null, priority_date: "2025-01-05", i140_decision: null, i140_decided: null, i140_rfe: null }).filed).toBeNull();
  });
});
