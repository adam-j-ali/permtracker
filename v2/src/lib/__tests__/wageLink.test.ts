import { describe, expect, it } from "vitest";

import { mostLikelyOf, narrowWageCandidates, topRightRate, TYPICAL_GAP_DAYS, usesBefore, type WageCandidate } from "@/lib/wageLink";

/**
 * Which of an employer's same-title wage requests a PERM case rests on (N24-W, Nov 24 2026). DOL's published file
 * names it once the case is decided; until then the case page lists the candidates, narrowed by every rule we know and
 * ranked, and names one "most likely" only where the backtest on decided cases (scripts/backtest_wage_links.ts)
 * measured that the top one is right.
 */

const PERM = { caseNumber: "G-100-26000-000001", filed: "2026-03-15" };
const cand = (caseNumber: string, decided: string | null, namedCount = 0, namedRecent = 0): WageCandidate => ({
  caseNumber,
  received: decided ? `${decided.slice(0, 4)}-01-01` : null,
  decided,
  namedCount,
  namedRecent,
});

describe("narrowWageCandidates", () => {
  it("drops a wage DOL decided after the PERM was filed: a 9089 is filed on a wage already issued", () => {
    const r = narrowWageCandidates([cand("P-100-1", "2026-03-20"), cand("P-100-2", "2025-10-01")], PERM);
    expect(r.kept.map((c) => c.caseNumber)).toEqual(["P-100-2"]);
    expect(r.dropped).toEqual([{ caseNumber: "P-100-1", why: "decided after the case was filed" }]);
  });

  it("drops a wage that expired more than 180 days before filing (recruitment can't have begun inside it)", () => {
    // Decided 2024-08-01, so valid to 2025-06-30; 2025-06-30 + 180 days = 2025-12-27, before the 2026-03-15 filing.
    const r = narrowWageCandidates([cand("P-100-old", "2024-08-01"), cand("P-100-ok", "2025-08-01")], PERM);
    expect(r.kept.map((c) => c.caseNumber)).toEqual(["P-100-ok"]);
    expect(r.dropped[0]).toEqual({ caseNumber: "P-100-old", why: "expired too long before the case was filed" });
  });

  it("keeps a wage that expired less than 180 days before filing: recruitment may have begun inside it", () => {
    // Decided 2025-02-01, so valid to 2025-06-30; filed 2025-11-01 is within 180 days of that.
    const r = narrowWageCandidates([cand("P-100-edge", "2025-02-01")], { caseNumber: "G-100-x", filed: "2025-11-01" });
    expect(r.kept.map((c) => c.caseNumber)).toEqual(["P-100-edge"]);
  });

  it("never drops a wage other cases named: employers reuse one for several workers, and reuse ranks it first", () => {
    const r = narrowWageCandidates([cand("P-100-fresh", "2025-09-25"), cand("P-100-reused", "2025-07-15", 3, 2)], PERM);
    expect(r.dropped).toEqual([]);
    expect(r.kept.map((c) => c.caseNumber)).toEqual(["P-100-reused", "P-100-fresh"]);
  });

  it("counts only the other uses decided before the filing, and the recent ones within 120 days", () => {
    expect(usesBefore(["2026-03-01", "2025-10-01", "2026-03-20", "2026-03-15"], "2026-03-15")).toEqual({ namedCount: 2, namedRecent: 1 });
    expect(usesBefore(undefined, "2026-03-15")).toEqual({ namedCount: 0, namedRecent: 0 });
  });

  it("calls the top one most likely only when one is left, as the backtest measured", () => {
    const one = narrowWageCandidates([cand("P-100-only", "2025-09-25")], PERM).kept;
    const two = narrowWageCandidates([cand("P-100-a", "2025-09-25"), cand("P-100-b", "2025-07-01")], PERM).kept;
    expect(mostLikelyOf(one)).toBe("P-100-only");
    expect(mostLikelyOf(two)).toBeNull();
    expect(topRightRate(1)).toBeGreaterThanOrEqual(0.8);
    expect(topRightRate(2)).toBeLessThan(0.8);
    expect(topRightRate(9)).toBe(topRightRate(6));
  });

  it("ranks the rest by how close their gap to filing is to the typical one", () => {
    // Filed 2026-03-15: a wage decided TYPICAL_GAP_DAYS before ranks first, then the nearer of the others.
    const typical = new Date(Date.UTC(2026, 2, 15) - TYPICAL_GAP_DAYS * 86_400_000).toISOString().slice(0, 10);
    const r = narrowWageCandidates([cand("P-100-far", "2025-08-01"), cand("P-100-typ", typical), cand("P-100-near", "2026-03-01")], PERM);
    expect(r.kept[0]!.caseNumber).toBe("P-100-typ");
    expect(r.kept[0]!.gapDays).toBe(TYPICAL_GAP_DAYS);
  });

  it("keeps a candidate whose decision day isn't known yet, last, since its gap can't be judged", () => {
    const r = narrowWageCandidates([cand("P-100-unknown", null), cand("P-100-known", "2025-10-01")], PERM);
    expect(r.kept.map((c) => c.caseNumber)).toEqual(["P-100-known", "P-100-unknown"]);
    expect(r.kept[1]!.gapDays).toBeNull();
  });

  it("returns nothing to rank when nothing is left, and never throws on an unreadable day", () => {
    const r = narrowWageCandidates([cand("P-100-bad", "2025-13-45")], PERM);
    expect(r.kept.map((c) => c.caseNumber)).toEqual(["P-100-bad"]);
    expect(narrowWageCandidates([], PERM)).toEqual({ kept: [], dropped: [] });
  });
});
