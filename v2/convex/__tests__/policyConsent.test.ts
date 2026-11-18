/**
 * Active consent today, at the baseline: nobody is asked, and the change email can't be started. The behaviour
 * after a version bump is held in policyConsentBumped.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";

import { settleScheduled, trackedTestContext } from "../../test-utils/convexSettle";
import { createAuthenticatedContext } from "../../test-utils/convex";
import { api, internal } from "../_generated/api";
import { POLICY_BASELINE_VERSION, POLICY_CONSENT_VERSION } from "../lib/policyConsent";

afterEach(async () => {
  await settleScheduled();
});

describe("active consent at the baseline", () => {
  it("asks no account anything, so no banner shows", async () => {
    const t = trackedTestContext();
    const user = await createAuthenticatedContext(t);
    expect(await user.query(api.policyConsent.myStatus, {})).toEqual({ needed: false, version: POLICY_CONSENT_VERSION, summary: null });
  });

  it("won't start the change email for the baseline", async () => {
    const t = trackedTestContext();
    expect(await t.mutation(internal.policyConsent.startNotices, { version: POLICY_BASELINE_VERSION })).toMatchObject({ started: false });
  });
});

describe("the key an address is stored under", () => {
  it("is the same key the site's reviews use for an address, so one person is one key", async () => {
    const { consentKey } = await import("../lib/policyConsentStore");
    const { raterKeyFor } = await import("../siteReviews");
    expect(await consentKey(" Someone@Example.com ")).toBe(await raterKeyFor("someone@example.com"));
  });
});
