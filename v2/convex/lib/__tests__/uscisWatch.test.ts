/**
 * The tracking beta's pure rules (convex/lib/uscisWatch.ts): what a watchable receipt is, how the checker's
 * results are read, and the line a watched receipt shows on the preference page.
 */
import { describe, expect, it } from "vitest";

import { uscisCheckedNote } from "../mailKinds";
import {
  bearerToken,
  groupTone,
  isFinalGroup,
  parseResults,
  receiptBlockUrl,
  receiptPageUrl,
  RESULTS_PER_CALL_MAX,
  USCIS_GROUPS,
  watchableReceipt,
} from "../uscisWatch";

const NOW = Date.UTC(2026, 10, 25, 15, 0);
const ok = { receipt: "IOE0000000001", status: "Case Was Received", group: "waiting", form: "I-485", checkedAt: "2026-11-25T09:58:00-05:00" };

function parsed(results: unknown[]) {
  return parseResults({ results }, NOW);
}

describe("watchableReceipt", () => {
  it("reads a receipt the way people type it", () => {
    expect(watchableReceipt("ioe-0000-000001")).toBe("IOE0000000001");
    expect(watchableReceipt(" EAC 35 000 00303 ")).toBe("EAC3500000303");
    // A number pasted from a PDF carries an en dash or an em dash.
    expect(watchableReceipt("EAC–35—00000303")).toBe("EAC3500000303");
  });

  it("refuses a masked receipt, a short one and a long paste", () => {
    expect(watchableReceipt("IOE*090000010")).toBeNull();
    expect(watchableReceipt("IOE00000001")).toBeNull();
    expect(watchableReceipt("G-100-26125-868956")).toBeNull();
    expect(watchableReceipt(`IOE0000000001${" ".repeat(40)}`)).toBeNull();
  });
});

describe("parseResults", () => {
  it("reads a good post, upper-casing the receipt and the form", () => {
    const r = parsed([{ ...ok, receipt: "ioe0000000001", form: "i-485" }]);
    expect(r).toEqual({
      ok: true,
      results: [{ receipt: "IOE0000000001", status: "Case Was Received", group: "waiting", form: "I-485", checkedAt: Date.parse(ok.checkedAt) }],
    });
  });

  it("takes every group the contract names, a null form, and an empty status only for none", () => {
    for (const group of USCIS_GROUPS) expect(parsed([{ ...ok, group }]).ok, group).toBe(true);
    expect(parsed([{ ...ok, form: null }])).toMatchObject({ ok: true, results: [{ form: null }] });
    expect(parsed([{ ...ok, status: "", group: "none" }]).ok).toBe(true);
    expect(parsed([{ ...ok, status: "", group: "waiting" }]).ok).toBe(false);
  });

  it("refuses each bad field by name", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...ok, receipt: 13 }, /results\[0\]\.receipt/],
      [{ ...ok, receipt: "IOE0000000001XXXXXXXX" }, /results\[0\]\.receipt/],
      [{ ...ok, group: "Approved" }, /results\[0\]\.group/],
      [{ ...ok, status: "x".repeat(201) }, /results\[0\]\.status/],
      [{ ...ok, status: "Case\u0000Was" }, /control character/],
      [{ ...ok, form: "I485" }, /results\[0\]\.form/],
      [{ ...ok, form: 485 }, /results\[0\]\.form/],
      [{ ...ok, checkedAt: "2026-11-25T09:58:00" }, /checkedAt/],
      [{ ...ok, checkedAt: "2026-13-45T09:58:00Z" }, /checkedAt/],
      [{ ...ok, checkedAt: "2025-06-01T09:58:00Z" }, /checkedAt/],
      [{ ...ok, checkedAt: "2026-11-25T18:00:00Z" }, /future/],
      [{ ...ok, checkedAt: `2026-11-25T09:58:00Z${" ".repeat(40)}` }, /checkedAt/],
    ];
    for (const [item, message] of cases) {
      const r = parsed([item]);
      expect(r.ok, JSON.stringify(item).slice(0, 60)).toBe(false);
      if (!r.ok) expect(r.message).toMatch(message);
    }
  });

  it("refuses a body that isn't the contract's shape, and more than the cap", () => {
    expect(parseResults([], NOW).ok).toBe(false);
    expect(parseResults({ results: {} }, NOW).ok).toBe(false);
    expect(parseResults(null, NOW).ok).toBe(false);
    expect(parsed(Array.from({ length: RESULTS_PER_CALL_MAX }, () => ok)).ok).toBe(true);
    expect(parsed(Array.from({ length: RESULTS_PER_CALL_MAX + 1 }, () => ok)).ok).toBe(false);
    expect(parsed([]).ok).toBe(true);
  });
});

describe("the rest", () => {
  it("reads a Bearer header and nothing else", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer abc123")).toBe("abc123");
    expect(bearerToken("abc123")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(`Bearer ${"a".repeat(700)}`)).toBeNull();
  });

  it("links a receipt's page, and an online receipt's own block", () => {
    expect(receiptPageUrl("IOE0000000001")).toBe("https://permtracker.app/uscis-case-status?receipt=IOE0000000001");
    expect(receiptBlockUrl("IOE0000000001")).toBe("https://permtracker.app/uscis-receipt-blocks/IOE00000");
    expect(receiptBlockUrl("EAC3500000303")).toBe("https://permtracker.app/uscis-receipt-blocks");
  });

  it("calls the decided groups final, and the rest not", () => {
    expect(["approved", "denied", "withdrawn", "closed", "revoked", "rejected", "decided"].every(isFinalGroup)).toBe(true);
    expect(["rfe", "waiting", "other", "none", undefined].some(isFinalGroup)).toBe(false);
    expect(groupTone("approved")).toBe("good");
    expect(groupTone("denied")).toBe("bad");
    expect(groupTone("waiting")).toBe("neutral");
  });

  it("says when the checker looked, in Eastern time, and never that nothing changed", () => {
    const at = Date.UTC(2026, 10, 22, 21, 5);
    expect(uscisCheckedNote({ status: null, checkedAt: null, notFound: false })).toBe("Not checked yet.");
    expect(uscisCheckedNote({ status: "Case Was Received", checkedAt: at, notFound: false })).toBe(
      "USCIS showed “Case Was Received” when we checked, at 4:05 PM ET, Nov 22.",
    );
    expect(uscisCheckedNote({ status: "Case Was Received", checkedAt: at, notFound: true })).toMatch(/^USCIS showed no case under it/);
    expect(uscisCheckedNote({ status: "Case Was Received", checkedAt: at, notFound: false })).not.toMatch(/no change/i);
  });
});
