/**
 * Google sign-in links to an existing account by email only when Google hasn't said the address is unverified
 * (the Nov 9 2026 security audit): linking an unverified address would hand the account over, the admin's included.
 * These drive the real createOrUpdateUser hook and the real profile mapping.
 */
import { describe, expect, it } from "vitest";
import { createTestContext } from "../../test-utils/convex";
import type { MutationCtx } from "../_generated/server";
import { authCallbacks, googleProfile, UNVERIFIED_GOOGLE_EMAIL } from "../auth";

type Hook = typeof authCallbacks.createOrUpdateUser;
type HookArgs = Parameters<Hook>[1];

function googleSignIn(ctx: MutationCtx, profile: Record<string, unknown>) {
  const args = {
    existingUserId: null,
    type: "oauth",
    provider: { id: "google", type: "oidc" },
    profile,
  } as unknown as HookArgs;
  return authCallbacks.createOrUpdateUser(ctx as unknown as Parameters<Hook>[0], args);
}

describe("a Google sign-in for an address an account already has", () => {
  it("is refused when Google says the address isn't verified, and nothing is linked", async () => {
    const t = createTestContext();
    const existing = await t.run((ctx) => ctx.db.insert("users", { email: "owner@example.com", name: "Owner" }));
    await expect(
      t.run((ctx) => googleSignIn(ctx, { email: "owner@example.com", name: "Someone", emailVerified: false })),
    ).rejects.toThrow(UNVERIFIED_GOOGLE_EMAIL);
    const user = await t.run((ctx) => ctx.db.get(existing));
    expect(user?.name).toBe("Owner");
  });

  it("links as before when Google verified it, or didn't say", async () => {
    const t = createTestContext();
    const existing = await t.run((ctx) => ctx.db.insert("users", { email: "owner@example.com" }));
    expect(await t.run((ctx) => googleSignIn(ctx, { email: "OWNER@example.com", emailVerified: true }))).toBe(existing);
    expect(await t.run((ctx) => googleSignIn(ctx, { email: "owner@example.com" }))).toBe(existing);
  });
});

describe("googleProfile", () => {
  it("keeps Convex Auth's default fields and id, and adds Google's email_verified", () => {
    expect(
      googleProfile({ sub: "1234", name: "A Person", email: "a@example.com", picture: "https://x/p.png", email_verified: false }),
    ).toEqual({ id: "1234", name: "A Person", email: "a@example.com", image: "https://x/p.png", emailVerified: false });
    expect(googleProfile({ sub: "1234", email: "a@example.com" })).toEqual({ id: "1234", email: "a@example.com" });
  });
});
