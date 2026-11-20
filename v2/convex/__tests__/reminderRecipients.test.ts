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
import { INVITE_MS, reminderConfirmPurpose, reminderStopPurpose } from "../lib/reminderRecipients";
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
async function stopToken(id: string, email: string) {
  return makeUnsubscribeToken(email, SECRET, reminderStopPurpose(id));
}

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
    const { t, id } = await invited();
    const tries = [
      { token: await stopToken(id, "para@firm.example"), recipientId: id as string },
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
    const { t, id } = await invited();
    await t.mutation(internal.reminderRecipients.stopByToken, { token: await stopToken(id, "para@firm.example"), recipientId: id });
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
    const token = await stopToken(id, "para@firm.example");
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id })).toBe("stopped");
    const [row] = await rows(t);
    expect(row!.status).toBe("stopped");
    expect(row!.stoppedAt).toEqual(expect.any(Number));
    expect("email" in row!).toBe(false);
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id })).toBe("already");
    expect(await owner.query(api.reminderRecipients.forCase, { caseId })).toMatchObject({ status: "stopped", email: null });
  });

  it("refuses a confirm link used as a stop link", async () => {
    const { t, id } = await confirmed();
    const token = await confirmToken(id, "para@firm.example");
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id })).toBeNull();
    expect((await rows(t))[0]!.status).toBe("confirmed");
  });

  it("the owner removes it, which stops it, and can then add someone else", async () => {
    const { t, owner, caseId, id } = await confirmed();
    await owner.mutation(api.reminderRecipients.remove, { caseId });
    expect(await rows(t)).toEqual([]);
    // A stop link from an earlier reminder still answers kindly: nothing more will come.
    expect(
      await t.mutation(internal.reminderRecipients.stopByToken, { token: await stopToken(id, "para@firm.example"), recipientId: id }),
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
    const { t, id } = await queuedCopy();
    await t.mutation(internal.reminderRecipients.stopByToken, { token: await stopToken(id, "para@firm.example"), recipientId: id });
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
    const { t, id } = await confirmed();
    await t.action(internal.reminderRecipients.sendCopy, { recipientId: id, items });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.to).toBe("para@firm.example");
    expect(mail.subject).toBe("1 PERM deadline needs your attention: Robotics Engineer at ACME Robotics");
    for (const words of ["PWD expiration", "Jordan Lee", "Robotics Engineer at ACME Robotics"]) {
      expect(mail.text).toContain(words);
    }
    const link = /Stop these reminders: (\S+)/.exec(String(mail.text))?.[1];
    expect(link).toBeDefined();
    const url = new URL(link!);
    expect(url.pathname).toBe("/case-alert/reminders/stop");
    expect(url.searchParams.get("r")).toBe(id);
    expect(mail.headers!["List-Unsubscribe"]).toBe(`<${link!}>`);
    expect(mail.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.html).toContain(link!.replace(/&/g, "&amp;"));
    expect(JSON.stringify(mail)).not.toContain("BENEFICIARY-PRIVATE");

    // The stop link in the email works.
    const token = url.searchParams.get("token")!;
    expect(await t.mutation(internal.reminderRecipients.stopByToken, { token, recipientId: id })).toBe("stopped");

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

  it("gives a confirmed second person their own case's reminders only, by the owner's switches", async () => {
    const { t, owner, caseId } = await setup();
    // The owner has switched off the PWD reminders and their own reminder emails altogether: the second person
    // follows the per-deadline switch, and their own emails aren't the owner's to turn off.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("userProfiles", {
        userId: owner.userId,
        userType: "individual",
        emailNotificationsEnabled: false,
        smsNotificationsEnabled: false,
        pushNotificationsEnabled: false,
        urgentDeadlineDays: 7,
        reminderDaysBefore: [7],
        emailDeadlineReminders: false,
        emailDeadlineReminderPwd: false,
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

    // The run's own reminders, so the expected rows come from the real deadline rules, never from memory.
    const due = await t.query(internal.scheduledJobs.getCasesNeedingReminders, {});
    const mine = due.filter((r) => r.caseId === caseId).map((r) => r.deadlineType);
    expect(mine).toContain("pwd_expiration");
    expect(due.some((r) => r.caseId === otherCase)).toBe(true);
    const expected = due
      .filter((r) => r.caseId === caseId && r.deadlineType !== "pwd_expiration")
      .map((r) => r.deadlineType);
    expect(expected.length).toBeGreaterThan(0);

    vi.useFakeTimers();
    await t.action(internal.deadlineDigest.runDeadlineReminders, {});
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (j) => j.name.includes("reminderRecipients") && j.name.includes("sendCopy") && j.state.kind === "pending",
      ),
    );
    vi.useRealTimers();
    expect(jobs).toHaveLength(1);
    const args = jobs[0]!.args[0] as { recipientId: string; items: { deadlineType: string }[] };
    expect(args.recipientId).toBe(row!._id);
    expect(args.items.map((i) => i.deadlineType)).not.toContain("PWD expiration");
    expect(args.items).toHaveLength(expected.length);
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
  const path = (base: string, token: string, id: string) =>
    `${base}?token=${encodeURIComponent(token)}&r=${encodeURIComponent(id)}`;

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
    const { t, id } = await invited("<b>Bold</b> & Co");
    const link = path("/case-alert/reminders/confirm", await confirmToken(id, "para@firm.example"), id);
    const html = await (await t.fetch(link, { method: "POST" })).text();
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>Bold</b>");
  });

  it("opening the stop link changes nothing; its button, or the mail app's one-click POST, stops", async () => {
    const { t, id } = await invited();
    await t.mutation(internal.reminderRecipients.confirmByToken, { token: await confirmToken(id, "para@firm.example"), recipientId: id });
    const link = path("/case-alert/reminders/stop", await stopToken(id, "para@firm.example"), id);
    const page = await t.fetch(link, { method: "GET" });
    expect(await page.text()).toContain("Stop the reminders");
    expect((await rows(t))[0]!.status).toBe("confirmed");
    const done = await t.fetch(link, { method: "POST", body: "List-Unsubscribe=One-Click" });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("The reminders are off");
    expect((await rows(t))[0]!.status).toBe("stopped");
  });

  it("answers a forged or incomplete link with a 400 and changes nothing", async () => {
    const { t, id } = await invited();
    for (const link of [
      path("/case-alert/reminders/confirm", "forged.token", id),
      `/case-alert/reminders/confirm?r=${id}`,
      path("/case-alert/reminders/stop", "forged.token", id),
      path("/case-alert/reminders/stop", "x".repeat(600), id),
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
