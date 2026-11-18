import { describe, expect, it } from "vitest";

import { POLICY_BASELINE_VERSION, POLICY_CHANGE_SUMMARIES, POLICY_CONSENT_VERSION, isPolicyVersion, needsConsent, policyAcceptPurpose } from "./policyConsent";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribeToken";

/** Active consent to a policy change: who must accept, and which link accepts what. */
const SECRET = "test-secret";

describe("who must accept a policy change", () => {
  it("asks nobody today: an absent acceptance is the baseline, and the baseline is current", () => {
    expect(POLICY_CONSENT_VERSION).toBe(POLICY_BASELINE_VERSION);
    expect(needsConsent(undefined)).toBe(false);
    expect(needsConsent(null)).toBe(false);
  });

  it("asks everyone who hasn't accepted a later version, the baseline holders included", () => {
    expect(needsConsent(undefined, "2027-02-01")).toBe(true);
    expect(needsConsent(POLICY_BASELINE_VERSION, "2027-02-01")).toBe(true);
    expect(needsConsent("2027-02-01", "2027-02-01")).toBe(false);
    expect(needsConsent("2027-03-01", "2027-02-01")).toBe(false);
  });

  it("takes only an ISO day as a version", () => {
    expect(isPolicyVersion("2026-11-18")).toBe(true);
    for (const bad of ["2026-11-1", "2026-11-18x", "", 20261118, null, "x".repeat(400)]) expect(isPolicyVersion(bad)).toBe(false);
  });
});

describe("the accept link", () => {
  it("accepts only the version it was mailed for", async () => {
    const token = await makeUnsubscribeToken("A@Example.com", SECRET, policyAcceptPurpose("2027-02-01"));
    expect(await verifyUnsubscribeToken(token, SECRET, policyAcceptPurpose("2027-02-01"))).toBe("a@example.com");
    expect(await verifyUnsubscribeToken(token, SECRET, policyAcceptPurpose("2027-03-01"))).toBeNull();
  });

  it("is refused for a token of another purpose, and for the bare form", async () => {
    const prefs = await makeUnsubscribeToken("a@example.com", SECRET, "prefs");
    const bare = await makeUnsubscribeToken("a@example.com", SECRET);
    expect(await verifyUnsubscribeToken(prefs, SECRET, policyAcceptPurpose("2027-02-01"))).toBeNull();
    expect(await verifyUnsubscribeToken(bare, SECRET, policyAcceptPurpose("2027-02-01"))).toBeNull();
    // And an accept token can't be replayed through the bare (legacy) check.
    const accept = await makeUnsubscribeToken("a@example.com", SECRET, policyAcceptPurpose("2027-02-01"));
    expect(await verifyUnsubscribeToken(accept, SECRET)).toBeNull();
  });
});

describe("what each version changes", () => {
  it("has one plain sentence for every version above the baseline, so nobody accepts something they weren't told", () => {
    const versions = new Set([POLICY_CONSENT_VERSION, ...Object.keys(POLICY_CHANGE_SUMMARIES)]);
    for (const v of versions) {
      if (v <= POLICY_BASELINE_VERSION) continue;
      const said = POLICY_CHANGE_SUMMARIES[v] ?? "";
      expect(said, `version ${v} has no summary`).toMatch(/^[A-Z].{20,300}\.$/);
    }
    // The baseline is nobody's to accept, so it carries none.
    expect(POLICY_CHANGE_SUMMARIES[POLICY_BASELINE_VERSION]).toBeUndefined();
  });
});
