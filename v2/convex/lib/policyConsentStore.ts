/**
 * Writing that someone accepted the current policy version, shared by every alert module's confirm path and by
 * convex/policyConsent.ts. Kept apart from the rules (./policyConsent.ts), which stay free of database code.
 */
import type { MutationCtx } from "../_generated/server";
import { POLICY_BASELINE_VERSION, POLICY_CONSENT_VERSION } from "./policyConsent";

/** One key per address: SHA-256 of it trimmed and lowercased, the same key `raterKeyFor` makes (a test holds it). */
export async function consentKey(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Records `version` as accepted for an address (once), keyed by its hash. Returns false when it already was. */
export async function recordAddressConsent(ctx: MutationCtx, email: string, version: string): Promise<boolean> {
  const key = await consentKey(email);
  const row = await ctx.db
    .query("policyConsents")
    .withIndex("by_key_version", (q) => q.eq("key", key).eq("version", version))
    .unique();
  if (row?.acceptedAt) return false;
  if (row) await ctx.db.patch("policyConsents", row._id, { acceptedAt: Date.now() });
  else await ctx.db.insert("policyConsents", { key, version, acceptedAt: Date.now() });
  return true;
}

/**
 * Someone confirming an alert or the digest agrees to the policy as it reads that day, so the change email never
 * asks them about a version they signed up under. At the baseline it writes nothing: no row already means the
 * baseline, so confirmations add no rows until a version needs consent.
 */
export async function recordConsentAtConfirm(ctx: MutationCtx, email: string): Promise<void> {
  if (POLICY_CONSENT_VERSION <= POLICY_BASELINE_VERSION) return;
  await recordAddressConsent(ctx, email, POLICY_CONSENT_VERSION);
}
