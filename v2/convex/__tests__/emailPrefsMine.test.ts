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

  // The dashboard lists these watches with a stop on each (MyWatchesWidget): only the account's own, and a stop
  // naming another address's row leaves it alone.
  it("list only the account's own watches, and never stop another address's", async () => {
    const { t, as } = await account(true);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const mine = await ctx.db.insert("caseStatusAlerts", {
        email: "owner@example.com",
        caseNumber: "G-100-26001-123456",
        confirmedAt: now,
        createdAt: now,
      });
      const theirs = await ctx.db.insert("caseStatusAlerts", {
        email: "someone.else@example.com",
        caseNumber: "G-100-26001-654321",
        confirmedAt: now,
        createdAt: now,
      });
      await ctx.db.insert("bulletinAlerts", {
        email: "owner@example.com",
        category: "EB2",
        country: "india",
        confirmedAt: now,
        createdAt: now,
      });
      await ctx.db.insert("uscisWatches", { email: "owner@example.com", receipt: "IOE0000000012", confirmedAt: now, createdAt: now });
      return { mine, theirs };
    });

    const state = (await as.query(api.emailPrefs.mine, {}))!;
    expect(state.caseAlerts.map((a) => a.caseNumber)).toEqual(["G-100-26001-123456"]);
    expect(state.bulletinAlerts).toHaveLength(1);
    expect(state.uscisAlerts.map((a) => a.receipt)).toEqual(["IOE0000000012"]);

    await as.mutation(api.emailPrefs.turnOffMine, { kind: "case", id: ids.theirs });
    await as.mutation(api.emailPrefs.turnOffMine, { kind: "case", id: ids.mine });
    const after = await t.run(async (ctx) => ({ mine: await ctx.db.get(ids.mine), theirs: await ctx.db.get(ids.theirs) }));
    expect(after.mine?.unsubscribedAt).toBeDefined();
    expect(after.theirs?.unsubscribedAt).toBeUndefined();
  });
});
