/**
 * A bulletin alert from a saved case: the case's category and chargeability name the line, and the alert is the
 * same subscription the public bulletin form makes (convex/bulletinAlerts.ts), for the account's own address.
 */
import { describe, expect, it } from "vitest";
import {
  createAuthenticatedContext,
  createTestContext,
  finishScheduledFunctions,
  setupSchedulerTests,
} from "../../test-utils/convex";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

setupSchedulerTests();

const LINE_CASE = {
  employerName: "Acme",
  positionTitle: "Engineer",
  eta9089FilingDate: "2023-08-01",
  eta9089CertificationDate: "2024-05-01",
  i140FilingDate: "2024-06-01",
  i140ApprovalDate: "2024-09-01",
  ebCategory: "EB-2" as const,
  countryOfBirth: "IN",
};

async function owner(verified: boolean) {
  const t = createTestContext();
  const user = await createAuthenticatedContext(t, "Owner");
  const email = await t.run(async (ctx) => {
    const u = (await ctx.db.get(user.userId))!;
    if (verified) {
      await ctx.db.insert("authAccounts", { userId: user.userId, provider: "google", providerAccountId: u.email! });
    }
    return u.email!;
  });
  return { t, user, email };
}

const rows = (t: ReturnType<typeof createTestContext>) => t.run((ctx) => ctx.db.query("bulletinAlerts").collect());

describe("the bulletin alert on a saved case", () => {
  it("names the case's line, and isn't on until asked", async () => {
    const { t, user } = await owner(true);
    const caseId = await user.mutation(api.cases.create, LINE_CASE);
    await finishScheduledFunctions(t);
    expect(await user.query(api.caseBulletinAlert.get, { caseId })).toEqual({
      line: { category: "EB2", country: "india" },
      state: "off",
    });
  });

  it("subscribes a verified account's own address to the line at once, through the bulletin alert table", async () => {
    const { t, user, email } = await owner(true);
    const caseId = await user.mutation(api.cases.create, { ...LINE_CASE, chargeabilityCountry: "CA" });
    await finishScheduledFunctions(t);

    await user.mutation(api.caseBulletinAlert.set, { caseId, enabled: true });
    const [row] = await rows(t);
    // Born in India, charged to Canada: the rest-of-world column.
    expect(row).toMatchObject({ email, category: "EB2", country: "worldwide", source: "case" });
    expect(row!.confirmedAt).toBeTypeOf("number");
    expect(row!.unsubscribedAt).toBeUndefined();
    expect(await user.query(api.caseBulletinAlert.get, { caseId })).toMatchObject({ state: "on" });
  });

  it("one alert per line: a second case on the same line shows it on, and turning it off turns the line off", async () => {
    const { t, user } = await owner(true);
    const first = await user.mutation(api.cases.create, LINE_CASE);
    const second = await user.mutation(api.cases.create, { ...LINE_CASE, employerName: "Beta" });
    await finishScheduledFunctions(t);

    await user.mutation(api.caseBulletinAlert.set, { caseId: first, enabled: true });
    expect(await user.query(api.caseBulletinAlert.get, { caseId: second })).toMatchObject({ state: "on" });
    expect(await rows(t)).toHaveLength(1);

    await user.mutation(api.caseBulletinAlert.set, { caseId: second, enabled: false });
    const [row] = await rows(t);
    expect(row!.unsubscribedAt).toBeTypeOf("number");
    expect(await user.query(api.caseBulletinAlert.get, { caseId: first })).toMatchObject({ state: "off" });
  });

  it("turns a line back on after an opt-out, since the account asked again", async () => {
    const { t, user } = await owner(true);
    const caseId = await user.mutation(api.cases.create, LINE_CASE);
    await finishScheduledFunctions(t);
    await user.mutation(api.caseBulletinAlert.set, { caseId, enabled: true });
    await user.mutation(api.caseBulletinAlert.set, { caseId, enabled: false });
    await user.mutation(api.caseBulletinAlert.set, { caseId, enabled: true });
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]!.unsubscribedAt).toBeUndefined();
  });

  it("sends an address the account hasn't proved the usual confirmation, and holds the alert until it's clicked", async () => {
    const { t, user, email } = await owner(false);
    const caseId = await user.mutation(api.cases.create, LINE_CASE);
    await finishScheduledFunctions(t);

    await user.mutation(api.caseBulletinAlert.set, { caseId, enabled: true });
    const [row] = await rows(t);
    expect(row).toMatchObject({ email, category: "EB2", country: "india", pendingSeries: "EB2|india" });
    expect(row!.confirmedAt).toBeUndefined();
    expect(await user.query(api.caseBulletinAlert.get, { caseId })).toMatchObject({ state: "pending" });
  });

  it("asks for the category and the country when the case can't name a line", async () => {
    const { t, user } = await owner(true);
    const caseId = await user.mutation(api.cases.create, { employerName: "Acme", positionTitle: "Engineer" });
    await finishScheduledFunctions(t);
    expect(await user.query(api.caseBulletinAlert.get, { caseId })).toEqual({ line: null, state: "off" });
    await expect(user.mutation(api.caseBulletinAlert.set, { caseId, enabled: true })).rejects.toThrow(
      /preference category and the country of birth/,
    );
  });

  it("refuses another account's case", async () => {
    const { t, user } = await owner(true);
    const caseId = await user.mutation(api.cases.create, LINE_CASE);
    const other = await createAuthenticatedContext(t, "Other");
    await finishScheduledFunctions(t);
    await expect(other.mutation(api.caseBulletinAlert.set, { caseId, enabled: true })).rejects.toThrow();
    expect(await other.query(api.caseBulletinAlert.get, { caseId: caseId as Id<"cases"> })).toBeNull();
  });
});
