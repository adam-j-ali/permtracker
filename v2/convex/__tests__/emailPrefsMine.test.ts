/**
 * Settings' "Alerts and digests" card reads and turns off what's sent to the account's address, so it's open only to
 * an account that proved the address (Nov 19 2026 security review): a password account whose code was never entered
 * holds an address someone else may own, and that owner's watched case numbers, queue months and follows are theirs.
 * Same rule as API keys, webhooks and case alerts (isEmailVerified).
 */
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../test-utils/convex";

async function account(verified: boolean) {
  const t = createTestContext();
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { email: "owner@example.com" });
    await ctx.db.insert("authAccounts", {
      userId: id,
      provider: "password",
      providerAccountId: "owner@example.com",
      ...(verified ? { emailVerified: "owner@example.com" } : {}),
    });
    return id;
  });
  return { t, as: t.withIdentity({ subject: userId }) };
}

describe("the account's own alert settings", () => {
  it("show nothing, and turn nothing off, for an address the account never proved", async () => {
    const { as } = await account(false);
    expect(await as.query(api.emailPrefs.mine, {})).toBeNull();
    expect(await as.mutation(api.emailPrefs.turnOffMine, { kind: "news" })).toBeNull();
  });

  it("work as before for an address the account proved", async () => {
    const { as } = await account(true);
    expect(await as.query(api.emailPrefs.mine, {})).not.toBeNull();
    expect(await as.mutation(api.emailPrefs.turnOffMine, { kind: "news" })).not.toBeNull();
  });
});
