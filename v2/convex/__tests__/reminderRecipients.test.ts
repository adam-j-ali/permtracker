/**
 * A case's deadline reminders sent to a second person too: only the case's own account adds, sees and removes the
 * address; the address gets one invitation and nothing more until it confirms by a POST; a confirmed address gets
 * that case's reminders with a one-click stop; every limit refuses before anything is written or sent; and the
 * address goes when it stops them, when it's removed, and with its case or the account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createAuthenticatedContext } from "../../test-utils/convex";
import { finishScheduledNow, settleScheduled, trackedTestContext } from "../../test-utils/convexSettle";
import { BUDGETS, REMINDER_INVITES_PER_ACCOUNT, windowFor } from "../lib/alertBudgets";
import { purgeAllUserData } from "../lib/deletion";
import {
  INVITE_MS,
  reminderAddressKey,
  reminderConfirmPurpose,
  reminderDeclinePurpose,
  reminderStopPurpose,
} from "../lib/reminderRecipients";
import { makeUnsubscribeToken } from "../lib/unsubscribeToken";
import { easternDay } from "../lib/time";
import { utcDay } from "../lib/emailLimits";

const SECRET = "test-secret-for-reminder-recipients";

type Sent = { to: string[] | string; subject: string; html?: string; text?: string; headers?: Record<string, string> };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  vi.stubEnv("UNSUBSCRIBE_SECRET", SECRET);
  vi.stubEnv("AUTH_RESEND_KEY", "re_test_key");
  vi.stubEnv("BLOCKED_EMAILS", "blocked@example.com");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: { body?: string }) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== "api.resend.com") throw new Error(`unexpected fetch ${url.href}`);
      sent.push(JSON.parse(init?.body ?? "{}") as Sent);
      return new Response(JSON.stringify({ id: `sent-${sent.length}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterEach(async () => {
  await settleScheduled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const caseRow = (userId: Id<"users">, over: Record<string, unknown> = {}) => ({
  userId,
  employerName: "ACME Robotics",
  beneficiaryIdentifier: "BENEFICIARY-PRIVATE",
  positionTitle: "Robotics Engineer",
  caseStatus: "recruitment" as const,
  progressStatus: "working" as const,
  rfiEntries: [],
  rfeEntries: [],
  notes: [],
  isProfessionalOccupation: true,
  isFavorite: false,
  priorityLevel: "normal" as const,
  tags: [],
  calendarSyncEnabled: false,
  documents: [],
  recruitmentApplicantsCount: 0,
  additionalRecruitmentMethods: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

async function setup(opts: { verified?: boolean; fullName?: string } = {}) {
  const t = trackedTestContext();
  const owner = await createAuthenticatedContext(t, "Jordan Lee");
  const other = await createAuthenticatedContext(t, "Other");
  const ownerEmail = await t.run(async (ctx) => {
    const user = await ctx.db.get(owner.userId);
    if (opts.verified !== false) {
      await ctx.db.insert("authAccounts", {
        userId: owner.userId,
        provider: "password",
        providerAccountId: user!.email!,
        emailVerified: user!.email!,
      });
    }
    return user!.email!;
  });
  const caseId = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
  return { t, owner, other, ownerEmail, caseId };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

const rows = (t: T) => t.run((ctx) => ctx.db.query("reminderRecipients").collect());

async function confirmToken(id: string, email: string) {
  return makeUnsubscribeToken(email, SECRET, reminderConfirmPurpose(id));
}
/** A reminder's Stop link's token: signed for the row and the account that added it. */
async function stopToken(id: string, email: string, userId: string) {
  return makeUnsubscribeToken(email, SECRET, reminderStopPurpose(id, userId));
}
async function declineToken(id: string, email: string) {
  return makeUnsubscribeToken(email, SECRET, reminderDeclinePurpose(id));
}

/**
 * The one answer the owner gets for an address we won't invite: refused, blocked, or invited twice already. One answer
 * for all, so trying addresses can't tell which of them refused.
 */
const REFUSED = "We can't send an invitation to that address.";

describe("adding a second person to a case's reminders", () => {
  it("stores the address trimmed and lowercased, waiting, and sends one invitation naming who asked and the case", async () => {
    const { t, owner, caseId } = await setup();
    const r = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "  Para.Legal@Firm.COM " });
    expect(r).toEqual({ ok: true });

    const [row] = await rows(t);
    expect(row).toMatchObject({ caseId, userId: owner.userId, email: "para.legal@firm.com", status: "waiting" });
    expect(row!.confirmedAt).toBeUndefined();

    expect(await owner.query(api.reminderRecipients.forCase, { caseId })).toMatchObject({
      email: "para.legal@firm.com",
      status: "waiting",
    });

    await finishScheduledNow(t);
    expect(sent).toHaveLength(1);
    const invite = sent[0]!;
    expect(invite.to).toEqual("para.legal@firm.com");
    expect(invite.subject).toBe("Jordan Lee asked us to send you deadline reminders for a PERM case");
    for (const words of ["Jordan Lee", "Robotics Engineer", "ACME Robotics", "/case-alert/reminders/confirm?token="]) {
      expect(invite.text).toContain(words);
      expect(invite.html).toContain(words);
    }
    // Nothing of the case the second person doesn't need: never the beneficiary.
    expect(JSON.stringify(invite)).not.toContain("BENEFICIARY-PRIVATE");
  });

  it("says a PERM Tracker user asked when the account has no name it can show", async () => {
    const { t, owner, caseId } = await setup();
    await t.run((ctx) => ctx.db.patch(owner.userId, { name: "www.evil.example" }));
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "hr@employer.example" });
    await finishScheduledNow(t);
    expect(sent[0]!.subject).toBe("A PERM Tracker user asked us to send you deadline reminders for a PERM case");
    expect(JSON.stringify(sent[0])).not.toContain("evil.example");
  });

  it("calls the case \"a PERM case\" when its job title reads like a link, in the invitation, its page and the reminders", async () => {
    const SCAM = "Refund due: verify at irs-refund.example/claim";
    const { t, owner, caseId } = await setup();
    await t.run((ctx) => ctx.db.patch(caseId, { positionTitle: SCAM }));
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" });
    await finishScheduledNow(t);
    const invite = sent[0]!;
    expect(JSON.stringify(invite)).not.toContain("irs-refund");
    expect(invite.text).toContain("Deadline reminders for a PERM case");
    expect(invite.html).toContain("a PERM case");

    // The page the Confirm button lands on says the same.
    const [row] = await rows(t);
    const confirmed = await t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    expect(confirmed).toEqual({ state: "confirmed", caseLine: "a PERM case" });

    // The person confirmed: their reminders call it "a PERM case" too.
    sent = [];
    await t.action(internal.reminderRecipients.sendCopy, {
      recipientId: row!._id,
      items: [{ deadlineType: "PWD expiration", deadlineDate: "2026-12-01", daysUntil: 7, urgency: "urgent" }],
    });
    expect(sent[0]!.subject).toBe("1 PERM deadline needs your attention: a PERM case");
    expect(JSON.stringify(sent[0])).not.toContain("irs-refund");
  });

  it("calls the case \"a PERM case\" in the reminders when the owner renames it to a link or a phone number after the person confirmed", async () => {
    const { t, owner, caseId } = await setup();
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" });
    await finishScheduledNow(t);
    const [row] = await rows(t);
    await t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    const items = [{ deadlineType: "PWD expiration", deadlineDate: "2026-12-01", daysUntil: 7, urgency: "urgent" as const }];
    for (const [i, title] of ["Refund due: verify at irs-refund\u3002com", "Call 800-555-0199 to verify"].entries()) {
      await t.run((ctx) => ctx.db.patch(caseId, { positionTitle: title }));
      // A new day, so the day's reminder goes again.
      await t.run((ctx) => ctx.db.patch(row!._id, { lastSentDay: undefined }));
      sent = [];
      await t.action(internal.reminderRecipients.sendCopy, { recipientId: row!._id, items });
      const mail = sent[0]!;
      expect(mail.subject, title).toBe("1 PERM deadline needs your attention: a PERM case");
      expect(mail.text, title).toContain("Deadline reminders for a PERM case");
      expect(mail.html, title).toContain("a PERM case");
      expect(JSON.stringify(mail), title).not.toContain(i === 0 ? "irs-refund" : "555-0199");
    }
  });

  it("refuses the owner's own address, an address that isn't one, and a blocked one, writing and sending nothing", async () => {
    const { t, owner, ownerEmail, caseId } = await setup();
    for (const email of [ownerEmail.toUpperCase(), "not-an-address", "blocked@example.com"]) {
      const r = await owner.mutation(api.reminderRecipients.invite, { caseId, email });
      expect(r.ok, email).toBe(false);
    }
    expect(await rows(t)).toEqual([]);
    await finishScheduledNow(t);
    expect(sent).toEqual([]);
  });

  it("refuses another spelling of a blocked inbox with the one answer", async () => {
    const { t, owner, caseId } = await setup();
    vi.stubEnv("BLOCKED_EMAILS", "jane@gmail.com");
    expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email: "j.ane+x@googlemail.com" })).toEqual({
      ok: false,
      message: REFUSED,
    });
    expect(await rows(t)).toEqual([]);
    await finishScheduledNow(t);
    expect(sent).toEqual([]);
  });

  it("keeps one per case: a second address waits until the first is removed", async () => {
    const { t, owner, caseId } = await setup();
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "a@firm.example" });
    const second = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "b@firm.example" });
    expect(second.ok).toBe(false);
    expect((await rows(t)).map((r) => r.email)).toEqual(["a@firm.example"]);
  });

  it("is the case's own account's alone: another account can't add, see or remove one", async () => {
    const { t, owner, other, caseId } = await setup();
    const r = await other.mutation(api.reminderRecipients.invite, { caseId, email: "x@firm.example" });
    expect(r.ok).toBe(false);
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "a@firm.example" });
    expect(await other.query(api.reminderRecipients.forCase, { caseId })).toBeNull();
    await expect(other.mutation(api.reminderRecipients.remove, { caseId })).rejects.toThrow();
    expect(await rows(t)).toHaveLength(1);
  });

  it("needs the account's own address confirmed first", async () => {
    const { t, owner, caseId } = await setup({ verified: false });
    const r = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "a@firm.example" });
    expect(r.ok).toBe(false);
    expect(await rows(t)).toEqual([]);
  });

  it("refuses the sample case and a deleted one", async () => {
    const { t, owner } = await setup();
    const sample = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId, { isSample: true })));
    const deleted = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId, { deletedAt: 5 })));
    for (const caseId of [sample, deleted]) {
      expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email: "a@firm.example" })).ok).toBe(false);
    }
    expect(await rows(t)).toEqual([]);
  });

  it("stops an account at its daily cap, across its cases, before writing anything", async () => {
    const { t, owner } = await setup();
    const n = REMINDER_INVITES_PER_ACCOUNT.limit;
    for (let i = 0; i < n; i++) {
      const caseId = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
      expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email: `p${i}@firm.example` })).ok).toBe(true);
    }
    const caseId = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
    const over = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "late@firm.example" });
    expect(over).toEqual({ ok: false, message: expect.stringContaining("tomorrow") });
    expect(await rows(t)).toHaveLength(n);
  });

  it("charges the shared daily pool, and a full pool refuses with no row, no send and the refusal counted", async () => {
    const { t, owner, caseId } = await setup();
    const limit = windowFor("reminderInvite").limit;
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < limit; i++) {
        await ctx.db.insert("rateLimits", {
          key: `${BUDGETS.reminderInvite.key}:all`,
          timestamp: now,
          identifier: "all",
          action: BUDGETS.reminderInvite.key,
        });
      }
    });
    const r = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "a@firm.example" });
    expect(r.ok).toBe(false);
    expect(await rows(t)).toEqual([]);
    const refusals = await t.run((ctx) => ctx.db.query("budgetRefusals").collect());
    expect(refusals.find((x) => x.pool === "reminderInvite")?.count).toBe(1);
    await finishScheduledNow(t);
    expect(sent).toEqual([]);
  });
});

describe("confirming the invitation", () => {
  async function invited() {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    return { ...s, id: row!._id };
  }

  it("confirms by its own signed link, once, and names the case", async () => {
    const { t, owner, caseId, id } = await invited();
    const token = await confirmToken(id, "para@firm.example");
    const first = await t.mutation(internal.reminderRecipients.confirmByToken, { token, recipientId: id });
    expect(first).toEqual({ state: "confirmed", caseLine: "Robotics Engineer at ACME Robotics" });
    expect((await rows(t))[0]).toMatchObject({ status: "confirmed", confirmedAt: expect.any(Number) });
    const again = await t.mutation(internal.reminderRecipients.confirmByToken, { token, recipientId: id });
    expect(again).toEqual({ state: "already", caseLine: "Robotics Engineer at ACME Robotics" });
    expect(await owner.query(api.reminderRecipients.forCase, { caseId })).toMatchObject({ status: "confirmed" });
  });

  it("refuses a stop link, another row's link, a changed id and a forged token", async () => {
    const { t, owner, id } = await invited();
    const tries = [
      { token: await stopToken(id, "para@firm.example", owner.userId), recipientId: id as string },
      { token: await confirmToken("someone-else", "para@firm.example"), recipientId: id as string },
      { token: await confirmToken(id, "para@firm.example"), recipientId: "not-an-id" },
      { token: "x".repeat(5000), recipientId: id as string },
      { token: await makeUnsubscribeToken("para@firm.example", "wrong-secret", reminderConfirmPurpose(id)), recipientId: id as string },
    ];
    for (const args of tries) {
      expect(await t.mutation(internal.reminderRecipients.confirmByToken, args)).toBeNull();
    }
    expect((await rows(t))[0]!.status).toBe("waiting");
  });

  it("never brings back reminders the person stopped, from a replayed link", async () => {
    const { t, owner, id } = await invited();
    await t.mutation(internal.reminderRecipients.stopByToken, {
      token: await stopToken(id, "para@firm.example", owner.userId),
      recipientId: id,
      userId: owner.userId,
    });
    const replay = await t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(id, "para@firm.example"),
      recipientId: id,
    });
    expect(replay).toBeNull();
    expect((await rows(t))[0]!.status).toBe("stopped");
  });

  it("refuses once the invitation is past its thirty days", async () => {
    const { t, id } = await invited();
    await t.run((ctx) => ctx.db.patch(id, { invitedAt: Date.now() - INVITE_MS - 1000 }));
    const r = await t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(id, "para@firm.example"),
      recipientId: id,
    });
    expect(r).toBeNull();
  });
});

describe("stopping, removing and the address's end", () => {
  async function confirmed() {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    await s.t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    return { ...s, id: row!._id };
  }

  it("stops with one click, erases the address, and says so again on a second click", async () => {
    const { t, owner, caseId, id } = await confirmed();
    const token = await stopToken(id, "para@firm.example", owner.userId);
    const stop = { token, recipientId: id, userId: owner.userId };
    expect(await t.mutation(internal.reminderRecipients.stopByToken, stop)).toBe("stopped");
    const [row] = await rows(t);
    expect(row!.status).toBe("stopped");
    expect(row!.stoppedAt).toEqual(expect.any(Number));
    expect("email" in row!).toBe(false);
    expect(await t.mutation(internal.reminderRecipients.stopByToken, stop)).toBe("already");
    expect(await owner.query(api.reminderRecipients.forCase, { caseId })).toMatchObject({ status: "stopped", email: null });
  });

  it("refuses a confirm link used as a stop link", async () => {
    const { t, owner, id } = await confirmed();
    const token = await confirmToken(id, "para@firm.example");
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id, userId: owner.userId })).toBeNull();
    expect((await rows(t))[0]!.status).toBe("confirmed");
  });

  it("the owner removes it, which stops it, and can then add someone else", async () => {
    const { t, owner, caseId, id } = await confirmed();
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect(await rows(t)).toEqual([]);
    // A stop link from an earlier reminder still answers kindly: nothing more will come.
    expect(
      await t.mutation(internal.reminderRecipients.stopByToken, {
        token: await stopToken(id, "para@firm.example", owner.userId),
        recipientId: id,
        userId: owner.userId,
      }),
    ).toBe("already");
    expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email: "new@firm.example" })).ok).toBe(true);
  });

  it("goes with its case", async () => {
    const { t, owner, caseId } = await confirmed();
    await owner.mutation(api.cases.remove, { id: caseId });
    expect(await rows(t)).toEqual([]);
  });

  it("goes with the account", async () => {
    const { t, owner } = await confirmed();
    await t.run((ctx) => purgeAllUserData(ctx, owner.userId));
    expect(await rows(t)).toEqual([]);
  });

  it("an invitation nobody confirmed is deleted after thirty days; a confirmed one stays", async () => {
    const { t, owner, id } = await confirmed();
    const other = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
    const now = Date.now();
    const old = await t.run((ctx) =>
      ctx.db.insert("reminderRecipients", {
        userId: owner.userId,
        caseId: other,
        email: "ignored@firm.example",
        status: "waiting",
        invitedAt: now - INVITE_MS - 1000,
      }),
    );
    await t.run((ctx) => ctx.db.patch(id, { invitedAt: now - INVITE_MS - 1000 }));
    const out = await t.mutation(internal.reminderRecipients.expireInvites, { now });
    expect(out).toEqual({ deleted: 1 });
    expect((await rows(t)).map((r) => r._id)).toEqual([id]);
    expect(await t.run((ctx) => ctx.db.get(old))).toBeNull();
  });
});

describe("an address that asked not to be added, and the cap on asking again", () => {
  /** The account's own address confirmed, as `setup` does for the owner. */
  const verify = (t: T, userId: Id<"users">) =>
    t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "password",
        providerAccountId: user!.email!,
        emailVerified: user!.email!,
      });
    });
  const refusals = (t: T) => t.run((ctx) => ctx.db.query("reminderRefusals").collect());
  const counts = (t: T) => t.run((ctx) => ctx.db.query("reminderInviteCounts").collect());

  /** The owner invites para@ and the person confirms, then clicks Stop. */
  async function stopped() {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    await s.t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    await s.t.mutation(internal.reminderRecipients.stopByToken, {
      token: await stopToken(row!._id, "para@firm.example", s.owner.userId),
      recipientId: row!._id,
      userId: s.owner.userId,
    });
    return { ...s, id: row!._id };
  }

  it("an address that clicked Stop can't be invited again by the account that added it, under any spelling", async () => {
    const { t, owner, caseId } = await stopped();
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    sent = [];
    for (const email of [" PARA@firm.example", "para+again@firm.example"]) {
      expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email }), email).toEqual({
        ok: false,
        message: REFUSED,
      });
    }
    expect(await rows(t)).toEqual([]);
    await finishScheduledNow(t);
    expect(sent).toEqual([]);
  });

  it("Stop refuses only the account that added the address: another account can still invite it", async () => {
    const { t, other } = await stopped();
    await verify(t, other.userId);
    const theirs = await t.run((ctx) => ctx.db.insert("cases", caseRow(other.userId)));
    expect(await other.mutation(api.reminderRecipients.invite, { caseId: theirs, email: "para@firm.example" })).toEqual({
      ok: true,
    });
    await finishScheduledNow(t);
  });

  it("keeps only a keyed one-way hash of the address with the account that added it, once", async () => {
    const { t, owner, id } = await stopped();
    // A second click on the same Stop link adds nothing.
    await t.mutation(internal.reminderRecipients.stopByToken, {
      token: await stopToken(id, "para@firm.example", owner.userId),
      recipientId: id,
      userId: owner.userId,
    });
    const list = await refusals(t);
    expect(list).toHaveLength(1);
    expect(list[0]!.addressKey).toBe(await reminderAddressKey("para@firm.example", SECRET));
    expect(list[0]!.userId).toBe(owner.userId);
    expect(JSON.stringify(list)).not.toContain("para");
  });

  /** The owner invites para@ and the person confirms: the reminders they get carry a Stop link. */
  async function confirmedPara() {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    await s.t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    return { ...s, id: row!._id };
  }

  it("a Stop link pressed after the owner removed the person still refuses the address for that account", async () => {
    const { t, owner, caseId, id } = await confirmedPara();
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect(
      await t.mutation(internal.reminderRecipients.stopByToken, {
        token: await stopToken(id, "para@firm.example", owner.userId),
        recipientId: id,
        userId: owner.userId,
      }),
    ).toBe("already");
    const list = await refusals(t);
    expect(list).toHaveLength(1);
    expect(list[0]!.userId).toBe(owner.userId);
    // The owner has one of its two invitations to the address left, and the refusal answers it.
    sent = [];
    expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" })).toEqual({
      ok: false,
      message: REFUSED,
    });
    expect(await rows(t)).toEqual([]);
    await finishScheduledNow(t);
    expect(sent).toEqual([]);
  });

  it("a Stop link whose user id was changed fails its signature and refuses nothing", async () => {
    const { t, owner, other, caseId, id } = await confirmedPara();
    const token = await stopToken(id, "para@firm.example", owner.userId);
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id, userId: other.userId })).toBeNull();
    expect((await rows(t))[0]!.status).toBe("confirmed");
    // Nor once the row is gone: another account can't be put on the list by editing the link.
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id, userId: other.userId })).toBeNull();
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id, userId: "not-an-id" })).toBeNull();
    expect(await refusals(t)).toEqual([]);
  });

  it("a Stop link whose account is gone answers that the reminders are off, and keeps no refusal", async () => {
    const { t, owner, id } = await confirmedPara();
    await t.run((ctx) => purgeAllUserData(ctx, owner.userId));
    expect(await rows(t)).toEqual([]);
    expect(
      await t.mutation(internal.reminderRecipients.stopByToken, {
        token: await stopToken(id, "para@firm.example", owner.userId),
        recipientId: id,
        userId: owner.userId,
      }),
    ).toBe("already");
    expect(await refusals(t)).toEqual([]);
  });

  it("\"Don't invite me again\" in the invitation ends it and refuses the address to every account from then on", async () => {
    const { t, owner, other, caseId } = await setup();
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" });
    await finishScheduledNow(t);
    const invite = sent[0]!;
    const link = /Don't invite me again: (\S+)/.exec(String(invite.text))?.[1];
    expect(link).toBeDefined();
    const url = new URL(link!);
    expect(url.pathname).toBe("/case-alert/reminders/decline");
    expect(invite.html).toContain(link!.replace(/&/g, "&amp;"));
    // The mail app's own Unsubscribe button does the same, by a one-click POST.
    expect(invite.headers!["List-Unsubscribe"]).toBe(`<${link!}>`);
    expect(invite.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const [row] = await rows(t);
    const out = await t.mutation(internal.reminderRecipients.declineByToken, {
      token: url.searchParams.get("token")!,
      recipientId: row!._id,
    });
    expect(out).toBe("declined");
    const [after] = await rows(t);
    expect(after!.status).toBe("stopped");
    expect("email" in after!).toBe(false);
    expect(await refusals(t)).toHaveLength(1);
    // Kept for every account: no account is named on it.
    expect((await refusals(t))[0]!.userId).toBeUndefined();

    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" })).toEqual({
      ok: false,
      message: REFUSED,
    });
    // Every other account is refused too.
    await verify(t, other.userId);
    const theirs = await t.run((ctx) => ctx.db.insert("cases", caseRow(other.userId)));
    expect(await other.mutation(api.reminderRecipients.invite, { caseId: theirs, email: "para@firm.example" })).toEqual({
      ok: false,
      message: REFUSED,
    });
  });

  it("still refuses the address when the invitation is already gone", async () => {
    const { t, owner, caseId } = await setup();
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" });
    await finishScheduledNow(t);
    const [row] = await rows(t);
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    const out = await t.mutation(internal.reminderRecipients.declineByToken, {
      token: await declineToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    expect(out).toBe("declined");
    expect(await refusals(t)).toHaveLength(1);
  });

  it("a decline link is its own: no other link declines, and it confirms or stops nothing", async () => {
    const { t, owner, caseId } = await setup();
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" });
    await finishScheduledNow(t);
    const [row] = await rows(t);
    const id = row!._id;
    for (const token of [
      await confirmToken(id, "para@firm.example"),
      await stopToken(id, "para@firm.example", owner.userId),
      await declineToken("another-row", "para@firm.example"),
      await makeUnsubscribeToken("para@firm.example", "wrong-secret", reminderDeclinePurpose(id)),
      "x".repeat(5000),
    ]) {
      expect(await t.mutation(internal.reminderRecipients.declineByToken, { token, recipientId: id })).toBeNull();
    }
    const decline = await declineToken(id, "para@firm.example");
    expect(await t.mutation(internal.reminderRecipients.confirmByToken, { token: decline, recipientId: id })).toBeNull();
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token: decline, recipientId: id, userId: owner.userId })).toBeNull();
    expect((await rows(t))[0]!.status).toBe("waiting");
    expect(await refusals(t)).toEqual([]);
  });

  it("one account invites one address twice in all, a lapsed invitation counting", async () => {
    const { t, owner, other, caseId } = await setup();
    // The first lapses, never confirmed.
    expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" })).ok).toBe(true);
    const now = Date.now();
    const [first] = await rows(t);
    await t.run((ctx) => ctx.db.patch(first!._id, { invitedAt: now - INVITE_MS - 1000 }));
    await t.mutation(internal.reminderRecipients.expireInvites, { now });
    expect(await rows(t)).toEqual([]);
    // The second is removed by the owner.
    expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" })).ok).toBe(true);
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    // A third is refused, however it's typed, and writes nothing.
    expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email: "Para@Firm.example " })).toEqual({
      ok: false,
      message: REFUSED,
    });
    expect(await rows(t)).toEqual([]);
    expect((await counts(t)).map((c) => c.count)).toEqual([2]);
    // Another address, or another account, isn't held by it.
    expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email: "hr@employer.example" })).ok).toBe(true);
    await verify(t, other.userId);
    const theirs = await t.run((ctx) => ctx.db.insert("cases", caseRow(other.userId)));
    expect((await other.mutation(api.reminderRecipients.invite, { caseId: theirs, email: "para@firm.example" })).ok).toBe(true);
    // The count keeps the address as the same keyed hash, never the address.
    expect(JSON.stringify(await counts(t))).not.toContain("para");
    await finishScheduledNow(t);
  });

  it("refuses a +tag or another Gmail spelling of a refused address, and mails the address as it was typed", async () => {
    const { t, owner, other, caseId } = await setup();
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "Para.Legal+Cases@gmail.com" });
    await finishScheduledNow(t);
    expect(sent[0]!.to).toBe("para.legal+cases@gmail.com");
    const [row] = await rows(t);
    expect(row!.email).toBe("para.legal+cases@gmail.com");
    expect(
      await t.mutation(internal.reminderRecipients.declineByToken, {
        token: await declineToken(row!._id, "para.legal+cases@gmail.com"),
        recipientId: row!._id,
      }),
    ).toBe("declined");
    await verify(t, other.userId);
    const theirs = await t.run((ctx) => ctx.db.insert("cases", caseRow(other.userId)));
    for (const email of ["paralegal@gmail.com", "Para.Legal+new@googlemail.com", "p.a.r.a.legal@gmail.com"]) {
      expect(await other.mutation(api.reminderRecipients.invite, { caseId: theirs, email }), email).toEqual({
        ok: false,
        message: REFUSED,
      });
    }
    expect(await refusals(t)).toHaveLength(1);
  });

  it("doesn't give an account a third invitation to the same inbox under a +tag", async () => {
    const { t, owner, caseId } = await setup();
    for (const email of ["para@firm.example", "para+2@firm.example"]) {
      expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email })).ok, email).toBe(true);
      await owner.mutation(api.reminderRecipients.remove, { caseId });
    }
    expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email: "Para+3@firm.example" })).toEqual({
      ok: false,
      message: REFUSED,
    });
    expect((await counts(t)).map((c) => c.count)).toEqual([2]);
    await finishScheduledNow(t);
  });

  /** Today's per-account cap emptied, so a test can try more addresses than one day allows. */
  const resetCaps = (t: T) =>
    t.run(async (ctx) => {
      for (const r of await ctx.db.query("rateLimits").collect()) {
        if (r.action === "reminder_invite_account") await ctx.db.delete(r._id);
      }
    });

  /** An address another account's invitation was declined for: on the site-wide list. */
  async function declinedElsewhere(s: Awaited<ReturnType<typeof setup>>, email: string) {
    await verify(s.t, s.other.userId);
    const theirs = await s.t.run((ctx) => ctx.db.insert("cases", caseRow(s.other.userId)));
    await s.other.mutation(api.reminderRecipients.invite, { caseId: theirs, email });
    await finishScheduledNow(s.t);
    const row = (await rows(s.t)).find((r) => r.caseId === theirs)!;
    await s.t.mutation(internal.reminderRecipients.declineByToken, { token: await declineToken(row._id, email), recipientId: row._id });
  }

  it("gives a refused, a blocked and an invited-twice address the same answer", async () => {
    const s = await setup();
    const { t, owner, caseId } = s;
    await declinedElsewhere(s, "para@firm.example");
    for (let i = 0; i < 2; i++) {
      expect((await owner.mutation(api.reminderRecipients.invite, { caseId, email: "hr@employer.example" })).ok).toBe(true);
      await owner.mutation(api.reminderRecipients.remove, { caseId });
    }
    await resetCaps(t);
    const answers = [];
    for (const email of ["para@firm.example", "blocked@example.com", "hr@employer.example"]) {
      answers.push(await owner.mutation(api.reminderRecipients.invite, { caseId, email }));
    }
    expect(answers).toEqual([
      { ok: false, message: REFUSED },
      { ok: false, message: REFUSED },
      { ok: false, message: REFUSED },
    ]);
    expect((await rows(t)).filter((r) => r.caseId === caseId)).toEqual([]);
    await finishScheduledNow(t);
  });

  it("charges every try to the account's daily cap, so the list can't be read by trying addresses", async () => {
    const s = await setup();
    const { t, owner, caseId } = s;
    await declinedElsewhere(s, "para@firm.example");
    sent = [];
    const n = REMINDER_INVITES_PER_ACCOUNT.limit;
    for (let i = 0; i < n; i++) {
      const email = i % 2 === 0 ? "para@firm.example" : "blocked@example.com";
      expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email })).toEqual({ ok: false, message: REFUSED });
    }
    // The day's tries are spent: a good address and a refused one now get the same "tomorrow".
    const good = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "fresh@firm.example" });
    expect(good).toEqual({ ok: false, message: expect.stringContaining("tomorrow") });
    expect(await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" })).toEqual(good);
    expect((await rows(t)).filter((r) => r.caseId === caseId)).toEqual([]);
    await finishScheduledNow(t);
    expect(sent).toEqual([]);
  });

  it("a full shared pool gives a refused address and a good one the same answer", async () => {
    const s = await setup();
    const { t, owner, caseId } = s;
    await declinedElsewhere(s, "para@firm.example");
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < windowFor("reminderInvite").limit; i++) {
        await ctx.db.insert("rateLimits", {
          key: `${BUDGETS.reminderInvite.key}:all`,
          timestamp: now,
          identifier: "all",
          action: BUDGETS.reminderInvite.key,
        });
      }
    });
    const refused = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" });
    const good = await owner.mutation(api.reminderRecipients.invite, { caseId, email: "fresh@firm.example" });
    expect(refused).toEqual({ ok: false, message: expect.stringContaining("as many invitations as we can today") });
    expect(good).toEqual(refused);
  });

  it("the account's invitation counts and its Stop refusals go with it; the list for every account stays", async () => {
    const s = await stopped();
    const { t, owner } = s;
    // A second address declined another account's invitation: that refusal names no account.
    await declinedElsewhere(s, "hr@employer.example");
    expect(await refusals(t)).toHaveLength(2);
    expect(await counts(t)).toHaveLength(2);
    await t.run((ctx) => purgeAllUserData(ctx, owner.userId));
    expect((await counts(t)).filter((c) => c.userId === owner.userId)).toEqual([]);
    const left = await refusals(t);
    expect(left).toHaveLength(1);
    expect(left[0]!.addressKey).toBe(await reminderAddressKey("hr@employer.example", SECRET));
    expect(left[0]!.userId).toBeUndefined();
  });
});

describe("a Stop ends every reminder its account sends that inbox", () => {
  const copyItems = [{ deadlineType: "PWD expiration", deadlineDate: "2026-12-01", daysUntil: 7, urgency: "urgent" as const }];
  const refusals = (t: T) => t.run((ctx) => ctx.db.query("reminderRefusals").collect());
  const waiting = (t: T) => t.run((ctx) => ctx.db.query("emailRetries").collect());
  const claim = (t: T) => t.mutation(internal.emailLedger.claimRetries, { limit: 10 });
  /** A retry for the row, due now: what a send in flight leaves behind. */
  const queueRetry = (t: T, recipientId: string, to = "para@firm.example") =>
    t.run((ctx) =>
      ctx.db.insert("emailRetries", {
        kind: "reminder-copy",
        to,
        payload: JSON.stringify({ from: "x@permtracker.app", to, subject: "s", text: "t" }),
        queuedAt: Date.now(),
        nextAttemptAt: 0,
        attempts: 0,
        lastError: "internal_server_error: outage",
        refs: [`reminder:${recipientId}`],
      }),
    );
  const verify = (t: T, userId: Id<"users">) =>
    t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "password",
        providerAccountId: user!.email!,
        emailVerified: user!.email!,
      });
    });

  /** `user` invites `email` on `caseId` and the person confirms; the row's id. */
  async function addConfirmed(t: T, user: Awaited<ReturnType<typeof setup>>["owner"], caseId: Id<"cases">, email: string) {
    expect(await user.mutation(api.reminderRecipients.invite, { caseId, email })).toEqual({ ok: true });
    await finishScheduledNow(t);
    const row = (await rows(t)).find((r) => r.caseId === caseId && r.status === "waiting")!;
    expect(
      await t.mutation(internal.reminderRecipients.confirmByToken, {
        token: await confirmToken(row._id, row.email!),
        recipientId: row._id,
      }),
    ).toMatchObject({ state: "confirmed" });
    return row._id;
  }

  it("an old Stop link for a row the owner removed stops the row that replaced it, and nothing more goes to it", async () => {
    const { t, owner, caseId } = await setup();
    // Row A: invited, confirmed, then removed by the owner.
    const a = await addConfirmed(t, owner, caseId, "para@firm.example");
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    // Row B: the account's second (and last) invitation to the address, confirmed too.
    const b = await addConfirmed(t, owner, caseId, "para@firm.example");
    // A reminder to B already waits in the retry queue.
    await queueRetry(t, b);

    expect(
      await t.mutation(internal.reminderRecipients.stopByToken, {
        token: await stopToken(a, "para@firm.example", owner.userId),
        recipientId: a,
        userId: owner.userId,
      }),
    ).toBe("stopped");

    const [row] = await rows(t);
    expect(row!._id).toBe(b);
    expect(row!.status).toBe("stopped");
    expect("email" in row!).toBe(false);
    const list = await refusals(t);
    expect(list).toHaveLength(1);
    expect(list[0]!.userId).toBe(owner.userId);
    // What waited for B in the retry queue is gone.
    expect(await waiting(t)).toEqual([]);

    // No reminder goes to B: the day's send admits nothing, and a retry a send in flight leaves is never handed out.
    sent = [];
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: b, items: copyItems });
    expect(sent).toEqual([]);
    await queueRetry(t, b);
    expect(await claim(t)).toEqual([]);
    expect(await waiting(t)).toEqual([]);
    expect(await t.query(internal.reminderRecipients.copyTargets, { caseIds: [caseId] })).toEqual([]);
  });

  it("the old link's page says the reminders are off, from that account, for every case", async () => {
    const { t, owner, caseId } = await setup();
    const a = await addConfirmed(t, owner, caseId, "para@firm.example");
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    await addConfirmed(t, owner, caseId, "para@firm.example");
    const link = `/case-alert/reminders/stop?token=${encodeURIComponent(await stopToken(a, "para@firm.example", owner.userId))}&r=${a}&u=${owner.userId}`;
    const html = await (await t.fetch(link, { method: "POST", body: "List-Unsubscribe=One-Click" })).text();
    expect(html).toContain("The reminders are off");
    expect(html).toContain("from the account that added you again, for this case or any other");
    expect((await rows(t))[0]!.status).toBe("stopped");
  });

  it("a Stop from one case ends the account's reminders to that inbox on its other cases too, waiting or confirmed, any spelling", async () => {
    const { t, owner, caseId } = await setup();
    const second = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId, { employerName: "Second Co" })));
    const third = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId, { employerName: "Third Co" })));
    const one = await addConfirmed(t, owner, caseId, "para@firm.example");
    // The same inbox under a +tag, on a second case.
    const two = await addConfirmed(t, owner, second, "para+hr@firm.example");
    // An invitation on a third case still waiting for its click (written directly: the account's two are spent).
    const three = await t.run((ctx) =>
      ctx.db.insert("reminderRecipients", {
        userId: owner.userId,
        caseId: third,
        email: "para@firm.example",
        status: "waiting",
        invitedAt: Date.now(),
      }),
    );
    // The account's other person, a different inbox, stays.
    const fourth = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId, { employerName: "Fourth Co" })));
    const keep = await t.run((ctx) =>
      ctx.db.insert("reminderRecipients", {
        userId: owner.userId,
        caseId: fourth,
        email: "hr@employer.example",
        status: "confirmed",
        invitedAt: Date.now(),
        confirmedAt: Date.now(),
      }),
    );

    expect(
      await t.mutation(internal.reminderRecipients.stopByToken, {
        token: await stopToken(one, "para@firm.example", owner.userId),
        recipientId: one,
        userId: owner.userId,
      }),
    ).toBe("stopped");

    const byId = new Map((await rows(t)).map((r) => [r._id, r]));
    for (const id of [one, two, three]) {
      expect(byId.get(id)!.status, id).toBe("stopped");
      expect("email" in byId.get(id)!, id).toBe(false);
    }
    expect(byId.get(keep)).toMatchObject({ status: "confirmed", email: "hr@employer.example" });
    sent = [];
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: two, items: copyItems });
    expect(sent).toEqual([]);
  });

  it("leaves another account's reminders to the same address alone", async () => {
    const { t, owner, other, caseId } = await setup();
    await verify(t, other.userId);
    const theirCase = await t.run((ctx) => ctx.db.insert("cases", caseRow(other.userId)));
    const mine = await addConfirmed(t, owner, caseId, "para@firm.example");
    const theirs = await addConfirmed(t, other, theirCase, "para@firm.example");

    expect(
      await t.mutation(internal.reminderRecipients.stopByToken, {
        token: await stopToken(mine, "para@firm.example", owner.userId),
        recipientId: mine,
        userId: owner.userId,
      }),
    ).toBe("stopped");

    const byId = new Map((await rows(t)).map((r) => [r._id, r]));
    expect(byId.get(mine)!.status).toBe("stopped");
    expect(byId.get(theirs)).toMatchObject({ status: "confirmed", email: "para@firm.example" });
    const list = await refusals(t);
    expect(list).toHaveLength(1);
    expect(list[0]!.userId).toBe(owner.userId);
    sent = [];
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: theirs, items: copyItems });
    expect(sent).toHaveLength(1);
  });

  it("answers \"already\" when the account has nothing left that sends to the inbox", async () => {
    const { t, owner, caseId } = await setup();
    const a = await addConfirmed(t, owner, caseId, "para@firm.example");
    const stop = { token: await stopToken(a, "para@firm.example", owner.userId), recipientId: a, userId: owner.userId };
    expect(await t.mutation(internal.reminderRecipients.stopByToken, stop)).toBe("stopped");
    expect(await t.mutation(internal.reminderRecipients.stopByToken, stop)).toBe("already");
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect(await t.mutation(internal.reminderRecipients.stopByToken, stop)).toBe("already");
  });
});

describe("mail waiting in the retry queue goes when the person does", () => {
  /** Today's count at its ceiling, so every send waits in the retry queue (the admin already told today). */
  const fillToday = (t: T) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const day = await ctx.db
        .query("emailDays")
        .withIndex("by_day", (q) => q.eq("day", utcDay(now)))
        .unique();
      if (day) await ctx.db.patch(day._id, { sent: 1_000_000, alertedAt: now });
      else await ctx.db.insert("emailDays", { day: utcDay(now), sent: 1_000_000, alertedAt: now });
    });
  const waiting = (t: T) => t.run((ctx) => ctx.db.query("emailRetries").collect());
  const copyItems = [{ deadlineType: "PWD expiration", deadlineDate: "2026-12-01", daysUntil: 7, urgency: "urgent" as const }];

  /** A confirmed person whose day's reminders are waiting in the retry queue. */
  async function queuedCopy() {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    await s.t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    await fillToday(s.t);
    sent = [];
    await s.t.action(internal.reminderRecipients.sendCopy, { recipientId: row!._id, items: copyItems });
    expect(sent).toEqual([]);
    return { ...s, id: row!._id };
  }

  /** A person whose invitation is waiting in the retry queue: Resend had an outage when it went. */
  async function queuedInvite() {
    const s = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ name: "internal_server_error", message: "outage", statusCode: 500 }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    expect(sent).toEqual([]);
    const [row] = await rows(s.t);
    return { ...s, id: row!._id };
  }

  it("a queued reminder or invitation carries its row's ref", async () => {
    const copy = await queuedCopy();
    expect(await waiting(copy.t)).toEqual([
      expect.objectContaining({ to: "para@firm.example", kind: "reminder-copy", refs: [`reminder:${copy.id}`] }),
    ]);
    const invite = await queuedInvite();
    expect(await waiting(invite.t)).toEqual([
      expect.objectContaining({ to: "para@firm.example", kind: "reminder-invite", refs: [`reminder:${invite.id}`] }),
    ]);
  });

  it("the stop link drops it", async () => {
    const { t, owner, id } = await queuedCopy();
    await t.mutation(internal.reminderRecipients.stopByToken, {
      token: await stopToken(id, "para@firm.example", owner.userId),
      recipientId: id,
      userId: owner.userId,
    });
    expect(await waiting(t)).toEqual([]);
  });

  it("the owner's Remove drops it", async () => {
    const { t, owner, caseId } = await queuedCopy();
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect(await waiting(t)).toEqual([]);
  });

  it("deleting the case drops it", async () => {
    const { t, owner, caseId } = await queuedCopy();
    await owner.mutation(api.cases.remove, { id: caseId });
    expect(await waiting(t)).toEqual([]);
  });

  it("deleting the account drops it", async () => {
    const { t, owner } = await queuedCopy();
    await t.run((ctx) => purgeAllUserData(ctx, owner.userId));
    expect((await waiting(t)).filter((r) => r.to === "para@firm.example")).toEqual([]);
  });

  it("an invitation that lapses drops its queued copy", async () => {
    const { t, id } = await queuedInvite();
    const now = Date.now();
    await t.run((ctx) => ctx.db.patch(id, { invitedAt: now - INVITE_MS - 1000 }));
    await t.mutation(internal.reminderRecipients.expireInvites, { now });
    expect(await waiting(t)).toEqual([]);
  });

  it("leaves another person's waiting mail alone", async () => {
    const { t, owner, caseId } = await queuedCopy();
    await t.run((ctx) =>
      ctx.db.insert("emailRetries", {
        kind: "reminder-copy",
        to: "para@firm.example",
        payload: "{}",
        queuedAt: 1,
        nextAttemptAt: 1,
        attempts: 0,
        lastError: "daily_ceiling",
        refs: ["reminder:another-row"],
      }),
    );
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect((await waiting(t)).map((r) => r.refs)).toEqual([["reminder:another-row"]]);
  });
});

describe("a retry for a second person, checked again as the retry worker picks it up", () => {
  /**
   * A retry for the row, due now: what a send in flight leaves behind when the row changed after it was admitted (a
   * Stop or a Remove drops what's queued, but not a send that failed and queued itself a moment later).
   */
  const queueRetry = (t: T, recipientId: string, kind: "reminder-copy" | "reminder-invite", to = "para@firm.example") =>
    t.run((ctx) =>
      ctx.db.insert("emailRetries", {
        kind,
        to,
        payload: JSON.stringify({ from: "x@permtracker.app", to, subject: "s", text: "t" }),
        queuedAt: Date.now(),
        nextAttemptAt: 0,
        attempts: 0,
        lastError: "internal_server_error: outage",
        refs: [`reminder:${recipientId}`],
      }),
    );
  const claim = (t: T) => t.mutation(internal.emailLedger.claimRetries, { limit: 10 });
  const waiting = (t: T) => t.run((ctx) => ctx.db.query("emailRetries").collect());

  async function invited() {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    return { ...s, id: row!._id };
  }
  async function confirmed() {
    const s = await invited();
    await s.t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(s.id, "para@firm.example"),
      recipientId: s.id,
    });
    return s;
  }

  it("hands out a confirmed person's reminder and a waiting person's invitation", async () => {
    const copy = await confirmed();
    const r1 = await queueRetry(copy.t, copy.id, "reminder-copy");
    expect((await claim(copy.t)).map((c) => c.id)).toEqual([r1]);
    const invite = await invited();
    const r2 = await queueRetry(invite.t, invite.id, "reminder-invite");
    expect((await claim(invite.t)).map((c) => c.id)).toEqual([r2]);
  });

  it("drops a reminder whose person clicked Stop while it was in flight", async () => {
    const { t, owner, id } = await confirmed();
    await t.mutation(internal.reminderRecipients.stopByToken, {
      token: await stopToken(id, "para@firm.example", owner.userId),
      recipientId: id,
      userId: owner.userId,
    });
    await queueRetry(t, id, "reminder-copy");
    expect(await claim(t)).toEqual([]);
    expect(await waiting(t)).toEqual([]);
  });

  it("drops one for a row that's gone", async () => {
    const { t, owner, caseId, id } = await confirmed();
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    await queueRetry(t, id, "reminder-copy");
    expect(await claim(t)).toEqual([]);
    expect(await waiting(t)).toEqual([]);
  });

  it("drops one addressed to anyone but the row's address", async () => {
    const { t, id } = await confirmed();
    await queueRetry(t, id, "reminder-copy", "someone.else@firm.example");
    expect(await claim(t)).toEqual([]);
    expect(await waiting(t)).toEqual([]);
  });

  it("drops an invitation once the person confirmed, and a reminder to one who hasn't", async () => {
    const yes = await confirmed();
    await queueRetry(yes.t, yes.id, "reminder-invite");
    expect(await claim(yes.t)).toEqual([]);
    expect(await waiting(yes.t)).toEqual([]);
    const notYet = await invited();
    await queueRetry(notYet.t, notYet.id, "reminder-copy");
    expect(await claim(notYet.t)).toEqual([]);
    expect(await waiting(notYet.t)).toEqual([]);
  });

  it("drops one whose case was deleted, or whose account was", async () => {
    const one = await confirmed();
    await one.t.run((ctx) => ctx.db.patch(one.caseId, { deletedAt: Date.now() }));
    await queueRetry(one.t, one.id, "reminder-copy");
    expect(await claim(one.t)).toEqual([]);
    expect(await waiting(one.t)).toEqual([]);
    const two = await confirmed();
    await two.t.run((ctx) => ctx.db.patch(two.owner.userId, { deletedAt: Date.now() }));
    await queueRetry(two.t, two.id, "reminder-copy");
    expect(await claim(two.t)).toEqual([]);
    expect(await waiting(two.t)).toEqual([]);
  });

  it("leaves mail that isn't a second person's alone", async () => {
    const { t } = await setup();
    const other = await t.run((ctx) =>
      ctx.db.insert("emailRetries", {
        kind: "case-alert",
        to: "watcher@firm.example",
        payload: "{}",
        queuedAt: Date.now(),
        nextAttemptAt: 0,
        attempts: 0,
        lastError: "internal_server_error: outage",
        refs: ["case:abc"],
      }),
    );
    expect((await claim(t)).map((c) => c.id)).toEqual([other]);
  });
});

describe("the second person's daily reminders", () => {
  async function confirmed() {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    await s.t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });
    sent = [];
    return { ...s, id: row!._id };
  }

  const items = [
    { deadlineType: "PWD expiration", deadlineDate: "2026-12-01", daysUntil: 7, urgency: "urgent" as const },
  ];

  it("goes only to confirmed people, for the cases asked about", async () => {
    const { t, owner, caseId, id } = await confirmed();
    const waitingCase = await t.run((ctx) => ctx.db.insert("cases", caseRow(owner.userId)));
    await t.run((ctx) =>
      ctx.db.insert("reminderRecipients", {
        userId: owner.userId,
        caseId: waitingCase,
        email: "waiting@firm.example",
        status: "waiting",
        invitedAt: Date.now(),
      }),
    );
    const targets = await t.query(internal.reminderRecipients.copyTargets, { caseIds: [caseId, waitingCase] });
    expect(targets).toEqual([{ recipientId: id, caseId }]);
  });

  it("sends that case's reminders with a one-click stop in the header and the email, once a day", async () => {
    const { t, owner, id } = await confirmed();
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: id, items });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe("para@firm.example");
    expect(mail.subject).toBe("1 PERM deadline needs your attention: Robotics Engineer at ACME Robotics");
    for (const words of ["PWD expiration", "Robotics Engineer at ACME Robotics", "You confirmed these reminders."]) {
      expect(mail.text).toContain(words);
    }
    // The reminders name nobody: the invitation said who asked.
    expect(JSON.stringify(mail)).not.toContain("Jordan Lee");
    const link = /Stop these reminders: (\S+)/.exec(String(mail.text))?.[1];
    expect(link).toBeDefined();
    const url = new URL(link!);
    expect(url.pathname).toBe("/case-alert/reminders/stop");
    expect(url.searchParams.get("r")).toBe(id);
    // The account that added the address rides in the link, signed, so the Stop still refuses it once the row is gone.
    expect(url.searchParams.get("u")).toBe(owner.userId);
    expect(mail.headers!["List-Unsubscribe"]).toBe(`<${link!}>`);
    expect(mail.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.html).toContain(link!.replace(/&/g, "&amp;"));
    expect(JSON.stringify(mail)).not.toContain("BENEFICIARY-PRIVATE");

    // The stop link in the email works.
    const token = url.searchParams.get("token")!;
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id, userId: owner.userId })).toBe(
      "stopped",
    );

    // A second run on the same day, or after the stop, sends nothing.
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: id, items });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing twice on the same Eastern day", async () => {
    const { t, id } = await confirmed();
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: id, items });
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: id, items });
    expect(sent).toHaveLength(1);
    expect((await rows(t))[0]!.lastSentDay).toBe(easternDay(Date.now()));
  });

  it("charges its own pool before the send, and a full pool sends nothing and counts the refusal", async () => {
    const { t, id } = await confirmed();
    const limit = windowFor("reminderCopy").limit;
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < limit; i++) {
        await ctx.db.insert("rateLimits", {
          key: `${BUDGETS.reminderCopy.key}:all`,
          timestamp: now,
          identifier: "all",
          action: BUDGETS.reminderCopy.key,
        });
      }
    });
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: id, items });
    expect(sent).toEqual([]);
    const refusals = await t.run((ctx) => ctx.db.query("budgetRefusals").collect());
    expect(refusals.find((x) => x.pool === "reminderCopy")?.count).toBe(1);
  });
});

describe("the daily reminder run", () => {
  /** Days from today in Eastern time, the day the reminder rules count from. */
  const daysFromNow = (days: number) => {
    const today = easternDay(Date.now());
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  /**
   * A case with reminders due today, a confirmed second person, and the owner's notification switches as given (the
   * rest on). Runs the day's reminders and returns the second person's scheduled sends, and the deadline types the
   * run found due for the case, from the real deadline rules, never from memory.
   */
  async function runWith(switches: Record<string, boolean>) {
    const { t, owner, caseId } = await setup();
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("userProfiles", {
        userId: owner.userId,
        userType: "individual",
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: false,
        pushNotificationsEnabled: false,
        urgentDeadlineDays: 7,
        reminderDaysBefore: [7],
        emailDeadlineReminders: true,
        emailStatusUpdates: false,
        emailRfeAlerts: true,
        emailWeeklyDigest: false,
        quietHoursEnabled: false,
        timezone: "America/New_York",
        calendarSyncEnabled: false,
        calendarSyncPwd: false,
        calendarSyncEta9089: false,
        calendarSyncI140: false,
        calendarSyncRfe: false,
        calendarSyncRfi: false,
        calendarSyncRecruitment: false,
        calendarSyncFilingWindow: false,
        googleCalendarConnected: false,
        gmailConnected: false,
        casesSortBy: "updatedAt",
        casesSortOrder: "desc",
        casesPerPage: 12,
        dismissedDeadlines: [],
        darkModeEnabled: false,
        autoDeadlineEnforcementEnabled: false,
        createdAt: now,
        updatedAt: now,
        ...switches,
      });
      await ctx.db.patch(caseId, {
        caseStatus: "eta9089" as const,
        pwdExpirationDate: daysFromNow(7),
        eta9089CertificationDate: daysFromNow(-173),
        eta9089ExpirationDate: daysFromNow(7),
      });
    });
    const otherCase = await t.run((ctx) =>
      ctx.db.insert("cases", caseRow(owner.userId, { caseStatus: "pwd", pwdExpirationDate: daysFromNow(7), employerName: "Other Co" })),
    );
    await owner.mutation(api.reminderRecipients.invite, { caseId, email: "para@firm.example" });
    await finishScheduledNow(t);
    const [row] = await rows(t);
    await t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "para@firm.example"),
      recipientId: row!._id,
    });

    const due = await t.query(internal.scheduledJobs.getCasesNeedingReminders, {});
    expect(due.some((r) => r.caseId === otherCase)).toBe(true);
    const dueTypes = due.filter((r) => r.caseId === caseId).map((r) => r.deadlineType);
    expect(dueTypes).toContain("pwd_expiration");

    vi.useFakeTimers();
    await t.action(internal.deadlineDigest.runDeadlineReminders, {});
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (j) => j.name.includes("reminderRecipients") && j.name.includes("sendCopy") && j.state.kind === "pending",
      ),
    );
    vi.useRealTimers();
    return {
      rowId: row!._id,
      dueTypes,
      copies: jobs.map((j) => j.args[0] as { recipientId: string; items: { deadlineType: string }[] }),
    };
  }

  it("gives a confirmed second person their own case's reminders only, by the owner's switch for each kind", async () => {
    const { rowId, dueTypes, copies } = await runWith({ emailDeadlineReminderPwd: false });
    const expected = dueTypes.filter((d) => d !== "pwd_expiration");
    expect(expected.length).toBeGreaterThan(0);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.recipientId).toBe(rowId);
    expect(copies[0]!.items.map((i) => i.deadlineType)).not.toContain("PWD expiration");
    expect(copies[0]!.items).toHaveLength(expected.length);
  });

  it("sends the second person nothing when the owner turns off deadline reminders", async () => {
    const { copies } = await runWith({ emailDeadlineReminders: false });
    expect(copies).toEqual([]);
  });

  it("sends the second person nothing when the owner turns off email altogether", async () => {
    const { copies } = await runWith({ emailNotificationsEnabled: false });
    expect(copies).toEqual([]);
  });
});

describe("the confirm and stop pages", () => {
  async function invited(employerName = "ACME Robotics") {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.caseId, { employerName }));
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "para@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    return { ...s, id: row!._id };
  }
  const path = (base: string, token: string, id: string, userId?: string) =>
    `${base}?token=${encodeURIComponent(token)}&r=${encodeURIComponent(id)}${userId ? `&u=${encodeURIComponent(userId)}` : ""}`;

  it("opening the confirm link changes nothing; its button confirms", async () => {
    const { t, id } = await invited();
    const link = path("/case-alert/reminders/confirm", await confirmToken(id, "para@firm.example"), id);
    const page = await t.fetch(link, { method: "GET" });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<form method="POST"');
    expect(html).toContain("Confirm the reminders");
    expect((await rows(t))[0]!.status).toBe("waiting");

    const done = await t.fetch(link, { method: "POST" });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("Robotics Engineer at ACME Robotics");
    expect((await rows(t))[0]!.status).toBe("confirmed");
  });

  it("escapes the case's words on the page", async () => {
    const { t, id } = await invited("O'Brien & Sons");
    const link = path("/case-alert/reminders/confirm", await confirmToken(id, "para@firm.example"), id);
    const html = await (await t.fetch(link, { method: "POST" })).text();
    expect(html).toContain("Robotics Engineer at O&#39;Brien &amp; Sons");
  });

  it("never puts markup the owner typed on the page: the case is \"a PERM case\"", async () => {
    const { t, id } = await invited("<b>Bold</b> & Co");
    const link = path("/case-alert/reminders/confirm", await confirmToken(id, "para@firm.example"), id);
    const html = await (await t.fetch(link, { method: "POST" })).text();
    expect(html).toContain("the deadline reminders for a PERM case");
    expect(html).not.toContain("Bold");
  });

  it("opening the stop link changes nothing; its button, or the mail app's one-click POST, stops", async () => {
    const { t, owner, id } = await invited();
    await t.mutation(internal.reminderRecipients.confirmByToken, { token: await confirmToken(id, "para@firm.example"), recipientId: id });
    const link = path("/case-alert/reminders/stop", await stopToken(id, "para@firm.example", owner.userId), id, owner.userId);
    const page = await t.fetch(link, { method: "GET" });
    const pageHtml = await page.text();
    expect(pageHtml).toContain("Stop the reminders");
    // The button keeps the account in its own link.
    expect(pageHtml).toContain(`&amp;u=${owner.userId}`);
    // Stop ends that account's reminders on every case and refuses that account, and only that one.
    expect(pageHtml).toContain("from the account that added you again, for this case or any other");
    expect(pageHtml).toContain("kept with its cases. That account can");
    expect(pageHtml).not.toContain("No one on PERM Tracker");
    expect((await rows(t))[0]!.status).toBe("confirmed");
    const done = await t.fetch(link, { method: "POST", body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    const doneHtml = await done.text();
    expect(doneHtml).toContain("The reminders are off");
    expect(doneHtml).toContain("from the account that added you again, for this case or any other");
    expect(doneHtml).toContain("deleted your address from its cases. That account can");
    expect(doneHtml).not.toContain("No one on PERM Tracker");
    expect((await rows(t))[0]!.status).toBe("stopped");
  });

  it("a Stop pressed after the owner removed the person says what's true: already off, and refused for that account", async () => {
    const { t, owner, caseId, id } = await invited();
    await t.mutation(internal.reminderRecipients.confirmByToken, { token: await confirmToken(id, "para@firm.example"), recipientId: id });
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    const link = path("/case-alert/reminders/stop", await stopToken(id, "para@firm.example", owner.userId), id, owner.userId);
    const done = await t.fetch(link, { method: "POST", body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    const html = await done.text();
    expect(html).toContain("These reminders are already off");
    expect(html).toContain("from the account that added you again, and your address isn");
    expect(html).toContain("kept with its cases. That account can");
    expect(await t.run((ctx) => ctx.db.query("reminderRefusals").take(5))).toHaveLength(1);
  });

  it("opening the decline link changes nothing; its button, or the mail app's one-click POST, declines", async () => {
    const { t, id } = await invited();
    const link = path("/case-alert/reminders/decline", await declineToken(id, "para@firm.example"), id);
    const page = await t.fetch(link, { method: "GET" });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<form method="POST"');
    expect(html).toContain("t invite me again");
    expect((await rows(t))[0]!.status).toBe("waiting");
    const done = await t.fetch(link, { method: "POST", body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("can invite this address");
    expect((await rows(t))[0]!.status).toBe("stopped");
  });

  it("answers a forged or incomplete link with a 400 and changes nothing", async () => {
    const { t, owner, id } = await invited();
    for (const link of [
      path("/case-alert/reminders/confirm", "forged.token", id),
      `/case-alert/reminders/confirm?r=${id}`,
      path("/case-alert/reminders/stop", "forged.token", id, "user"),
      path("/case-alert/reminders/stop", "x".repeat(600), id, "user"),
      // A Stop link with the account cut out of it.
      path("/case-alert/reminders/stop", await stopToken(id, "para@firm.example", owner.userId), id),
      path("/case-alert/reminders/decline", "forged.token", id),
      `/case-alert/reminders/decline?r=${id}`,
    ]) {
      const res = await t.fetch(link, { method: "POST" });
      expect(res.status, link).toBe(400);
    }
    expect((await rows(t))[0]!.status).toBe("waiting");
  });
});

describe("an address blocked after it confirmed", () => {
  it("gets nothing and spends nothing", async () => {
    const s = await setup();
    await s.owner.mutation(api.reminderRecipients.invite, { caseId: s.caseId, email: "later@firm.example" });
    await finishScheduledNow(s.t);
    const [row] = await rows(s.t);
    await s.t.mutation(internal.reminderRecipients.confirmByToken, {
      token: await confirmToken(row!._id, "later@firm.example"),
      recipientId: row!._id,
    });
    sent = [];
    vi.stubEnv("BLOCKED_EMAILS", "later@firm.example");
    await s.t.action(internal.reminderRecipients.sendCopy, {
      recipientId: row!._id,
      items: [{ deadlineType: "PWD expiration", deadlineDate: "2026-12-01", daysUntil: 7, urgency: "urgent" }],
    });
    expect(sent).toEqual([]);
    const charged = await s.t.run((ctx) =>
      ctx.db
        .query("rateLimits")
        .withIndex("by_key_and_timestamp", (q) => q.eq("key", `${BUDGETS.reminderCopy.key}:all`))
        .take(5),
    );
    expect(charged).toEqual([]);
  });
});
