import { describe, expect, it } from "vitest";

import { ACCOUNT_CODES } from "@/lib/communityTimeline";
import { ACCOUNT_CODE_INFO, EVIDENCE_WORDS } from "@/lib/uscis/accountCodes";

/**
 * What's known about each account code: one entry for every code the timeline form lists, in the form's order, each
 * saying where its reading comes from. USCIS publishes no meanings, so a "documented" code quotes a government list.
 */
describe("the account codes' readings", () => {
  it("covers exactly the codes the timeline form offers, in its order", () => {
    expect(ACCOUNT_CODE_INFO.map((c) => c.code)).toEqual([...ACCOUNT_CODES]);
  });

  it("quotes a government list for a documented code, and none for the rest", () => {
    for (const c of ACCOUNT_CODE_INFO) {
      if (c.evidence === "documented") {
        expect(c.government, c.code).toMatch(/^[A-Z0-9 /]+$/);
        expect(c.source, c.code).not.toBeNull();
      } else {
        expect(c.government, c.code).toBeNull();
        expect(c.source, c.code).toBeNull();
      }
      expect(c.filers.length, c.code).toBeGreaterThan(10);
      // A reported or unsettled code's short label says so, so a list line never reads as USCIS's own wording.
      if (c.evidence === "reported") expect(c.short, c.code).toMatch(/^Filers|Filers see/);
      if (c.evidence === "unknown") expect(c.short, c.code).toBe("No settled reading");
      expect(EVIDENCE_WORDS[c.evidence]).toBeTruthy();
    }
  });

  it("never calls a code a decision", () => {
    for (const c of ACCOUNT_CODE_INFO) expect(`${c.filers} ${c.caution ?? ""}`, c.code).not.toMatch(/\bmeans (you|your case) (is|was|will be) approved\b/i);
  });
});
