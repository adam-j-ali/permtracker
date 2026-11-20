/**
 * A case's deadline reminders, sent to a second person too: a paralegal, or the employer's HR contact.
 *
 * ADDING ONE. The case's own account types an address on the case (`invite`). Checks run cheapest first, and every
 * refusal leaves nothing behind (v2/CLAUDE.md, "Charge a budget before the side effect it guards"):
 *
 * 1. the address's shape (length first, then the pattern: convex/lib/reminderRecipients.ts);
 * 2. the case is the caller's, live, and not the sample case;
 * 3. the address isn't the account's own, the account's own address is confirmed, and the address isn't blocked;
 * 4. the case has no second person yet (one per case);
 * 5. the address isn't on the refusal list (it clicked Stop, or "Don't invite me again"), and this account hasn't
 *    invited it REMINDER_INVITES_PER_ADDRESS times already, a lapsed or removed invitation counting; both are read by
 *    the address's keyed hash (reminderAddressKey), never the address;
 * 6. the account's daily cap (REMINDER_INVITES_PER_ACCOUNT), checked without charging;
 * 7. the shared daily pool (BUDGETS.reminderInvite) and the day's public ceiling, charged; a refusal is counted for
 *    the admin panel and nothing is queued, because the owner is right there to try again tomorrow;
 * 8. then the account's cap and its count for the address are charged, the row written as "waiting" and the one
 *    invitation scheduled.
 *
 * THE INVITATION. One email, never repeated. Its Confirm link opens a page with a POST button (convex/http.ts): a GET
 * changes nothing, so a mail scanner opening the link confirms nothing. The link is an HMAC over the address, signed
 * for `reminder-confirm:<row id>` (convex/lib/unsubscribeToken.ts), so it confirms that row and no other, and a row
 * that was stopped or removed can't be brought back by replaying it. A waiting row is deleted 30 days after the
 * invitation (`expireInvites`, run by the daily retention job). Its "Don't invite me again" link (and its
 * List-Unsubscribe header) is signed for `reminder-decline:<row id>` and opens a page with a POST button too: it ends
 * the invitation and puts the address on the refusal list (`declineByToken`).
 *
 * THE REMINDERS. The daily reminder run (convex/deadlineDigest.ts) gives each confirmed person that case's reminders
 * due that day that the owner's own email switches allow (the master switch, "Deadline reminders" and each kind's
 * switch: emailsDeadlineReminder), in one email a day (`sendCopy`). Each send charges BUDGETS.reminderCopy before it
 * goes and stamps the Eastern day, so a second run the same day sends nothing. Every email carries a one-click stop,
 * in its List-Unsubscribe header and as a link, signed for `reminder-stop:<row id>`.
 *
 * THE REFUSAL LIST. A Stop click, like "Don't invite me again", puts the address on a site-wide list kept only as an
 * HMAC of the address under UNSUBSCRIBE_SECRET (table reminderRefusals). No account can invite it again, and the owner
 * is told so plainly. The list is never shown and can't be read back as addresses.
 *
 * THE END. Stopping erases the address and keeps the row as "stopped", so the owner sees what happened. The owner
 * removing it deletes the row. It goes with its case (cases.remove, through clearCaseReferences) and with the account
 * (lib/deletion.ts), as the Privacy Policy says. Both emails carry the row's ref (`reminder:<row id>`) into the retry
 * queue, and every one of those paths, and the expiry of an invitation, drops what's still waiting there first
 * (dropReminderRetries), so a person who's gone never gets a retry.
 *
 * @module
 */
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { admitConfirmation } from "./confirmationQueue";
import { dropReminderRetries, dropRetries } from "./lib/alertOutboxStore";
import { BUDGETS, REMINDER_INVITES_PER_ACCOUNT, noteRefusal, windowFor } from "./lib/alertBudgets";
import { getCurrentUserId, isEmailVerified } from "./lib/auth";
import { formatDateForDisplay, formatRelativeDays } from "./lib/digestHelpers";
import { deadlineDigestWords } from "./lib/deadlineDigestWords";
import { FROM_EMAIL, getResend, sendOrQueue } from "./lib/email";
import { isEmailBlocked } from "./lib/emailBlocklist";
import { recordError } from "./lib/errorRecording";
import { SITE_URL } from "./lib/links";
import { createLogger } from "./lib/logging";
import { checkAndRecordRateLimit, checkRateLimit, recordRateLimitAttempt } from "./lib/rateLimit";
import {
  INVITE_MS,
  REMINDER_INVITES_PER_ADDRESS,
  caseLine,
  confirmUrl,
  declineUrl,
  inviteCaseLine,
  inviterName,
  normaliseRecipientEmail,
  reminderAddressKey,
  reminderConfirmPurpose,
  reminderCopySubject,
  reminderDeclinePurpose,
  reminderInviteSubject,
  reminderRef,
  reminderStopPurpose,
  sentenceStart,
  stopUrl,
  type CopyItem,
} from "./lib/reminderRecipients";
import { TEXT_LEGAL_LINE } from "./lib/textFooter";
import { easternDay, emailStamp } from "./lib/time";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./lib/unsubscribeToken";

const log = createLogger("ReminderRecipients");

/** The per-account cap's key in the rate-limit table. */
const ACCOUNT_LIMIT_ACTION = "reminder_invite_account";

/** Rows read for one case. A case holds one, so this is room to spare. */
const ROWS_PER_CASE = 5;

/** A token longer than this was never ours: refused before any work. */
const TOKEN_MAX = 512;

/** Waiting invitations one expiry run deletes; a longer backlog reschedules itself. */
const EXPIRE_BATCH = 200;

const statusV = v.union(v.literal("waiting"), v.literal("confirmed"), v.literal("stopped"));

const copyItemV = v.object({
  deadlineType: v.string(),
  deadlineDate: v.string(),
  daysUntil: v.number(),
  urgency: v.union(v.literal("overdue"), v.literal("urgent"), v.literal("upcoming"), v.literal("later")),
});

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET;
  if (!s) throw new Error("UNSUBSCRIBE_SECRET is not configured");
  return s;
}

async function rowsOf(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">): Promise<Doc<"reminderRecipients">[]> {
  return await ctx.db
    .query("reminderRecipients")
    .withIndex("by_caseId", (q) => q.eq("caseId", caseId))
    .take(ROWS_PER_CASE);
}

/** What the owner is told when the address is on the refusal list. */
export const REFUSED_ADDRESS = "That address asked not to get these reminders.";

/** What the owner is told when the account has invited the address REMINDER_INVITES_PER_ADDRESS times already. */
export const INVITED_ENOUGH = "You've invited that address twice already, so we can't send it another invitation.";

/** Whether an address (by its keyed hash) asked never to be added again. */
async function isRefused(ctx: QueryCtx | MutationCtx, addressKey: string): Promise<boolean> {
  const row = await ctx.db
    .query("reminderRefusals")
    .withIndex("by_addressKey", (q) => q.eq("addressKey", addressKey))
    .first();
  return row !== null;
}

/** Put an address on the refusal list, once, as its keyed hash only. */
async function refuseAddress(ctx: MutationCtx, email: string): Promise<void> {
  const addressKey = await reminderAddressKey(email, secret());
  if (await isRefused(ctx, addressKey)) return;
  await ctx.db.insert("reminderRefusals", { addressKey, refusedAt: Date.now() });
}

/** This account's count of invitations to one address (by its keyed hash), or null when it never invited it. */
async function inviteCountOf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  addressKey: string,
): Promise<Doc<"reminderInviteCounts"> | null> {
  return await ctx.db
    .query("reminderInviteCounts")
    .withIndex("by_userId_and_addressKey", (q) => q.eq("userId", userId).eq("addressKey", addressKey))
    .first();
}

/**
 * End a row because its person said no (Stop, or "Don't invite me again"): what's waiting for it in the retry queue
 * goes, the address is erased, and the row stays as "stopped" for the owner to see.
 */
async function endByPerson(ctx: MutationCtx, row: Doc<"reminderRecipients">): Promise<void> {
  await dropReminderRetries(ctx, row);
  // Patching a field to undefined deletes it: the address goes, the row stays for the owner to see.
  await ctx.db.patch("reminderRecipients", row._id, { status: "stopped", stoppedAt: Date.now(), email: undefined });
}

/** Who the emails say asked: the account's display name in Settings, else its sign-in name, else nobody named. */
async function inviterFor(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<string> {
  const user = await ctx.db.get("users", userId);
  let fullName: string | undefined;
  for await (const p of ctx.db
    .query("userProfiles")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .order("desc")) {
    if (p.deletedAt === undefined) {
      fullName = p.fullName;
      break;
    }
  }
  return inviterName(fullName, user?.name);
}

/** The case a row is for, while it's live and its account is too; null otherwise. */
async function liveCase(ctx: QueryCtx | MutationCtx, row: Doc<"reminderRecipients">): Promise<Doc<"cases"> | null> {
  const caseDoc = await ctx.db.get("cases", row.caseId);
  if (!caseDoc || caseDoc.userId !== row.userId || caseDoc.deletedAt !== undefined) return null;
  const user = await ctx.db.get("users", row.userId);
  if (!user || user.deletedAt !== undefined) return null;
  return caseDoc;
}

/** The row a link names, by its id as the link carries it; null for one that isn't an id of this table. */
async function rowById(ctx: QueryCtx | MutationCtx, recipientId: string): Promise<Doc<"reminderRecipients"> | null> {
  if (recipientId.length > 64) return null;
  const id = ctx.db.normalizeId("reminderRecipients", recipientId);
  return id ? await ctx.db.get("reminderRecipients", id) : null;
}

// ============================================================================
// THE OWNER'S SIDE
// ============================================================================

/** The case's second person as its own account sees it, or null (none, or not the caller's case). */
export const forCase = query({
  args: { caseId: v.id("cases") },
  returns: v.union(
    v.null(),
    v.object({
      email: v.union(v.string(), v.null()),
      status: statusV,
      invitedAt: v.number(),
      confirmedAt: v.union(v.number(), v.null()),
      stoppedAt: v.union(v.number(), v.null()),
      inviteFailed: v.boolean(),
    }),
  ),
  handler: async (ctx, { caseId }) => {
    const userId = await getCurrentUserId(ctx);
    const caseDoc = await ctx.db.get("cases", caseId);
    if (!caseDoc || caseDoc.userId !== userId) return null;
    const row = (await rowsOf(ctx, caseId))[0];
    if (!row) return null;
    return {
      email: row.email ?? null,
      status: row.status,
      invitedAt: row.invitedAt,
      confirmedAt: row.confirmedAt ?? null,
      stoppedAt: row.stoppedAt ?? null,
      inviteFailed: row.inviteFailedAt !== undefined,
    };
  },
});

const inviteResult = v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false), message: v.string() }));

/** Add a second person to the case's reminders and send them the one invitation. See the module's order of checks. */
export const invite = mutation({
  args: { caseId: v.id("cases"), email: v.string() },
  returns: inviteResult,
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    const email = normaliseRecipientEmail(args.email);
    if (!email) return { ok: false as const, message: "That email address doesn't look right." };

    const caseDoc = await ctx.db.get("cases", args.caseId);
    if (!caseDoc || caseDoc.userId !== userId || caseDoc.deletedAt !== undefined) {
      return { ok: false as const, message: "We couldn't find that case." };
    }
    if (caseDoc.isSample === true) {
      return { ok: false as const, message: "The sample case sends no reminders, so there's nothing to share." };
    }

    const user = await ctx.db.get("users", userId);
    if (user?.email && user.email.trim().toLowerCase() === email) {
      return { ok: false as const, message: "That's your own address. Your reminders already come to you." };
    }
    if (!(await isEmailVerified(ctx, userId))) {
      return { ok: false as const, message: "Confirm your own email address first, then you can add someone." };
    }
    if (isEmailBlocked(email)) {
      return { ok: false as const, message: "We can't send email to that address." };
    }
    if ((await rowsOf(ctx, args.caseId)).length > 0) {
      return { ok: false as const, message: "This case already has a second person. Remove them first to add someone else." };
    }
    const addressKey = await reminderAddressKey(email, secret());
    if (await isRefused(ctx, addressKey)) return { ok: false as const, message: REFUSED_ADDRESS };
    const invitedBefore = await inviteCountOf(ctx, userId, addressKey);
    if (invitedBefore && invitedBefore.count >= REMINDER_INVITES_PER_ADDRESS) {
      return { ok: false as const, message: INVITED_ENOUGH };
    }

    const perAccount = await checkRateLimit(ctx, userId, ACCOUNT_LIMIT_ACTION, REMINDER_INVITES_PER_ACCOUNT);
    if (!perAccount.allowed) {
      return {
        ok: false as const,
        message: `You've sent ${REMINDER_INVITES_PER_ACCOUNT.limit} invitations today. You can send more tomorrow.`,
      };
    }
    const pool = await admitConfirmation(ctx, "reminderInvite");
    if (!pool.allowed) {
      await noteRefusal(ctx, "reminderInvite");
      log.warn("reminder invitation refused: the day's pool or public ceiling is full");
      return {
        ok: false as const,
        message: "We've sent as many invitations as we can today. Please try again tomorrow.",
      };
    }
    await recordRateLimitAttempt(ctx, userId, ACCOUNT_LIMIT_ACTION);
    const now = Date.now();
    if (invitedBefore) {
      await ctx.db.patch("reminderInviteCounts", invitedBefore._id, { count: invitedBefore.count + 1, lastInvitedAt: now });
    } else {
      await ctx.db.insert("reminderInviteCounts", { userId, addressKey, count: 1, lastInvitedAt: now });
    }

    const recipientId = await ctx.db.insert("reminderRecipients", {
      userId,
      caseId: args.caseId,
      email,
      status: "waiting",
      invitedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.reminderRecipients.sendInvite, { recipientId });
    return { ok: true as const };
  },
});

/** Take the case's second person off: nothing more is sent to them, and the address is deleted. */
export const remove = mutation({
  args: { caseId: v.id("cases") },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, { caseId }) => {
    const userId = await getCurrentUserId(ctx);
    const caseDoc = await ctx.db.get("cases", caseId);
    if (!caseDoc || caseDoc.userId !== userId) throw new ConvexError("That case isn't one of yours.");
    const rows = await rowsOf(ctx, caseId);
    for (const r of rows) {
      await dropReminderRetries(ctx, r);
      await ctx.db.delete("reminderRecipients", r._id);
    }
    return { removed: rows.length > 0 };
  },
});

// ============================================================================
// THE INVITATION
// ============================================================================

/** What the invitation needs, while the row still waits for it. */
export const inviteDetails = internalQuery({
  args: { recipientId: v.id("reminderRecipients") },
  returns: v.union(v.null(), v.object({ email: v.string(), inviter: v.string(), caseLine: v.string() })),
  handler: async (ctx, { recipientId }) => {
    const row = await ctx.db.get("reminderRecipients", recipientId);
    if (!row || row.status !== "waiting" || !row.email) return null;
    const caseDoc = await liveCase(ctx, row);
    if (!caseDoc) return null;
    return {
      email: row.email,
      inviter: await inviterFor(ctx, row.userId),
      // Not yet confirmed: a title or employer that reads like a link is never put in front of this address.
      caseLine: inviteCaseLine(caseDoc.positionTitle, caseDoc.employerName),
    };
  },
});

/** The invitation couldn't go and won't be tried again: the owner's card says so. */
export const markInviteFailed = internalMutation({
  args: { recipientId: v.id("reminderRecipients") },
  returns: v.null(),
  handler: async (ctx, { recipientId }) => {
    const row = await ctx.db.get("reminderRecipients", recipientId);
    if (row && row.status === "waiting") await ctx.db.patch("reminderRecipients", recipientId, { inviteFailedAt: Date.now() });
    return null;
  },
});

/** The one invitation. Its pool was charged by `invite`, before this was scheduled. */
export const sendInvite = internalAction({
  args: { recipientId: v.id("reminderRecipients") },
  returns: v.null(),
  handler: async (ctx, { recipientId }) => {
    const details = await ctx.runQuery(internal.reminderRecipients.inviteDetails, { recipientId });
    if (!details) return null;
    try {
      const token = await makeUnsubscribeToken(details.email, secret(), reminderConfirmPurpose(recipientId));
      const link = confirmUrl(token, recipientId);
      const never = declineUrl(
        await makeUnsubscribeToken(details.email, secret(), reminderDeclinePurpose(recipientId)),
        recipientId,
      );
      let html: string | undefined;
      try {
        const { render } = await import("@react-email/render");
        const { ReminderInvite } = await import("../src/emails/ReminderInvite");
        html = await render(
          ReminderInvite({ inviter: details.inviter, caseLine: details.caseLine, confirmUrl: link, declineUrl: never }),
        );
      } catch (error) {
        await recordError(ctx, "action", "reminderRecipients.sendInvite.render", error);
      }
      const result = await sendOrQueue(
        ctx,
        "reminder-invite",
        getResend(),
        {
          from: FROM_EMAIL,
          to: details.email,
          subject: reminderInviteSubject(details.inviter),
          html,
          text: inviteText(details.inviter, details.caseLine, link, never),
          // The mail app's own Unsubscribe button is "Don't invite me again": a one-click POST to its page.
          headers: {
            "List-Unsubscribe": `<${never}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        },
        { priority: "public", refs: [reminderRef(recipientId)] },
      );
      if (result.error) {
        await recordError(ctx, "action", "reminderRecipients.sendInvite", new Error(`Resend: ${result.error.name}: ${result.error.message}`));
        await ctx.runMutation(internal.reminderRecipients.markInviteFailed, { recipientId });
      }
    } catch (error) {
      await recordError(ctx, "action", "reminderRecipients.sendInvite", error);
      await ctx.runMutation(internal.reminderRecipients.markInviteFailed, { recipientId });
    }
    return null;
  },
});

/** The invitation as plain text, for mail apps that show no HTML. */
export function inviteText(inviter: string, line: string, link: string, never: string): string {
  return [
    `Deadline reminders for ${line}`,
    "",
    `${sentenceStart(inviter)} tracks this PERM case on PERM Tracker and asked us to send you its deadline reminders too.`,
    "",
    "When one of its deadlines comes near, we'll email you its name and its date. The emails name the employer, the job title and the deadlines, and nothing else from the case. Each one has a link that stops them with one click.",
    "",
    "Confirm here (the page has one button):",
    link,
    "",
    "If you don't want these, ignore this email. Nothing more will be sent, and we'll delete your address in 30 days.",
    "",
    "Don't want to be asked again? Use this link, and no one on PERM Tracker can invite this address again.",
    `Don't invite me again: ${never}`,
    "",
    "PERM Tracker",
    SITE_URL,
    TEXT_LEGAL_LINE,
  ].join("\n");
}

/**
 * The Confirm button. Only a link signed for this row confirms it, only while it waits and inside its 30 days, and
 * only while its case and account are live. A row that was stopped or removed stays that way, whatever is replayed.
 */
export const confirmByToken = internalMutation({
  args: { token: v.string(), recipientId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ state: v.union(v.literal("confirmed"), v.literal("already")), caseLine: v.string() }),
  ),
  handler: async (ctx, args) => {
    if (args.token.length > TOKEN_MAX) return null;
    const row = await rowById(ctx, args.recipientId);
    if (!row || !row.email) return null;
    const email = await verifyUnsubscribeToken(args.token, secret(), reminderConfirmPurpose(row._id));
    if (!email || email !== row.email) return null;
    const caseDoc = await liveCase(ctx, row);
    if (!caseDoc) return null;
    // The page the invitation's button lands on names the case as the invitation did.
    const line = inviteCaseLine(caseDoc.positionTitle, caseDoc.employerName);
    if (row.status === "confirmed") return { state: "already" as const, caseLine: line };
    if (row.status !== "waiting" || Date.now() - row.invitedAt > INVITE_MS) return null;
    await ctx.db.patch("reminderRecipients", row._id, { status: "confirmed", confirmedAt: Date.now() });
    return { state: "confirmed" as const, caseLine: line };
  },
});

// ============================================================================
// STOPPING, AND THE INVITATIONS NOBODY CONFIRMED
// ============================================================================

/**
 * The stop link (and the mail app's own Unsubscribe button). The address is erased and the row kept as "stopped".
 * A valid link for a row that's already stopped or was removed answers "already": nothing more will be sent either way.
 */
export const stopByToken = internalMutation({
  args: { token: v.string(), recipientId: v.string() },
  returns: v.union(v.null(), v.literal("stopped"), v.literal("already")),
  handler: async (ctx, args) => {
    if (args.token.length > TOKEN_MAX || args.recipientId.length > 64) return null;
    const email = await verifyUnsubscribeToken(args.token, secret(), reminderStopPurpose(args.recipientId));
    if (!email) return null;
    // Whatever the row's state, the address asked to stop: nobody invites it again, and nothing kept for this row in
    // the retry queue goes to it.
    await refuseAddress(ctx, email);
    const ref = reminderRef(args.recipientId);
    await dropRetries(ctx, email, (r) => (r.refs ?? []).includes(ref));
    const row = await rowById(ctx, args.recipientId);
    if (!row || row.status === "stopped") return "already" as const;
    if (row.email !== email) return null;
    await endByPerson(ctx, row);
    return "stopped" as const;
  },
});

/**
 * "Don't invite me again", from the invitation (and its mail app's Unsubscribe button). The address goes on the
 * refusal list, so no account can invite it again, and the invitation it came in ends like a stop: its retries go, the
 * address is erased and the row stays as "stopped" for the owner. A valid link for a row that's already gone still
 * refuses the address. Only a link signed for this purpose does it.
 */
export const declineByToken = internalMutation({
  args: { token: v.string(), recipientId: v.string() },
  returns: v.union(v.null(), v.literal("declined")),
  handler: async (ctx, args) => {
    if (args.token.length > TOKEN_MAX || args.recipientId.length > 64) return null;
    const email = await verifyUnsubscribeToken(args.token, secret(), reminderDeclinePurpose(args.recipientId));
    if (!email) return null;
    await refuseAddress(ctx, email);
    const ref = reminderRef(args.recipientId);
    await dropRetries(ctx, email, (r) => (r.refs ?? []).includes(ref));
    const row = await rowById(ctx, args.recipientId);
    if (row && row.status !== "stopped" && row.email === email) await endByPerson(ctx, row);
    return "declined" as const;
  },
});

/**
 * Invitations nobody confirmed, deleted INVITE_DAYS after they were sent. Run by the daily retention job
 * (convex/retention.ts). Reads waiting rows only, oldest first, so the first young one ends the read.
 */
export const expireInvites = internalMutation({
  args: { now: v.number() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, { now }) => {
    const old = await ctx.db
      .query("reminderRecipients")
      .withIndex("by_status_and_invitedAt", (q) => q.eq("status", "waiting").lt("invitedAt", now - INVITE_MS))
      .take(EXPIRE_BATCH + 1);
    for (const row of old.slice(0, EXPIRE_BATCH)) {
      await dropReminderRetries(ctx, row);
      await ctx.db.delete("reminderRecipients", row._id);
    }
    // Guarded on progress: a run that deleted a full batch has more to do.
    if (old.length > EXPIRE_BATCH) await ctx.scheduler.runAfter(0, internal.reminderRecipients.expireInvites, { now });
    return { deleted: Math.min(old.length, EXPIRE_BATCH) };
  },
});

// ============================================================================
// THE DAILY REMINDERS
// ============================================================================

/** The confirmed second people of these cases (the day's cases with reminders due). */
export const copyTargets = internalQuery({
  args: { caseIds: v.array(v.id("cases")) },
  returns: v.array(v.object({ recipientId: v.id("reminderRecipients"), caseId: v.id("cases") })),
  handler: async (ctx, { caseIds }) => {
    const out: { recipientId: Id<"reminderRecipients">; caseId: Id<"cases"> }[] = [];
    for (const caseId of caseIds) {
      for (const row of await rowsOf(ctx, caseId)) {
        if (row.status === "confirmed" && row.email) out.push({ recipientId: row._id, caseId });
      }
    }
    return out;
  },
});

/**
 * Just before a reminder goes: the row is still confirmed with an address, its case and account are live, it hasn't
 * had today's reminder, and the pool has room. The pool is charged and the day stamped here, before the send.
 */
export const admitCopy = internalMutation({
  args: { recipientId: v.id("reminderRecipients") },
  returns: v.union(v.null(), v.object({ email: v.string(), caseLine: v.string(), jobTitle: v.string(), employerName: v.string() })),
  handler: async (ctx, { recipientId }) => {
    const row = await ctx.db.get("reminderRecipients", recipientId);
    if (!row || row.status !== "confirmed" || !row.email) return null;
    // An address blocked since it confirmed gets nothing, and spends nothing: the send would only be refused.
    if (isEmailBlocked(row.email)) return null;
    const today = easternDay(Date.now());
    if (row.lastSentDay === today) return null;
    const caseDoc = await liveCase(ctx, row);
    if (!caseDoc) return null;
    const pool = await checkAndRecordRateLimit(ctx, "all", BUDGETS.reminderCopy.key, windowFor("reminderCopy"));
    if (!pool.allowed) {
      await noteRefusal(ctx, "reminderCopy");
      log.warn("second-person reminder refused: the day's pool is full");
      return null;
    }
    await ctx.db.patch("reminderRecipients", recipientId, { lastSentDay: today });
    return {
      email: row.email,
      caseLine: caseLine(caseDoc.positionTitle, caseDoc.employerName),
      jobTitle: caseDoc.positionTitle,
      employerName: caseDoc.employerName,
    };
  },
});

/** One day's reminders for one case, to its confirmed second person. */
export const sendCopy = internalAction({
  args: { recipientId: v.id("reminderRecipients"), items: v.array(copyItemV) },
  returns: v.null(),
  handler: async (ctx, { recipientId, items }) => {
    if (items.length === 0) return null;
    const admitted = await ctx.runMutation(internal.reminderRecipients.admitCopy, { recipientId });
    if (!admitted) return null;
    try {
      const token = await makeUnsubscribeToken(admitted.email, secret(), reminderStopPurpose(recipientId));
      const stop = stopUrl(token, recipientId);
      const checkedAt = emailStamp(Date.now());
      const overdue = items.filter((i) => i.urgency === "overdue").length;
      let html: string | undefined;
      try {
        const { render } = await import("@react-email/render");
        const { ReminderCopy } = await import("../src/emails/ReminderCopy");
        html = await render(
          ReminderCopy({ caseLine: admitted.caseLine, items, checkedAt, stopUrl: stop }),
        );
      } catch (error) {
        await recordError(ctx, "action", "reminderRecipients.sendCopy.render", error);
      }
      const result = await sendOrQueue(
        ctx,
        "reminder-copy",
        getResend(),
        {
          from: FROM_EMAIL,
          to: admitted.email,
          subject: reminderCopySubject(items.length, overdue, admitted.jobTitle, admitted.employerName),
          html,
          text: copyText(admitted.caseLine, items, checkedAt, stop),
          headers: {
            "List-Unsubscribe": `<${stop}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        },
        // A retry kept for this row is dropped when the row stops or goes (dropReminderRetries).
        { refs: [reminderRef(recipientId)] },
      );
      if (result.error) {
        await recordError(ctx, "action", "reminderRecipients.sendCopy", new Error(`Resend: ${result.error.name}: ${result.error.message}`));
      }
    } catch (error) {
      await recordError(ctx, "action", "reminderRecipients.sendCopy", error);
    }
    return null;
  },
});

/** The reminders as plain text, for mail apps that show no HTML. It names nobody: the invitation said who asked. */
export function copyText(line: string, items: readonly CopyItem[], checkedAt: string, stop: string): string {
  const words = deadlineDigestWords(items.length, items.filter((i) => i.urgency === "overdue").length);
  return [
    `Deadline reminders for ${line}`,
    "",
    `${words.headline}. Here's what's due, most urgent first.`,
    "",
    ...items.map((i) => `- ${i.deadlineType}: ${formatDateForDisplay(i.deadlineDate)} (${formatRelativeDays(i.daysUntil).toLowerCase()})`),
    "",
    `You confirmed these reminders. Checked ${checkedAt}.`,
    "",
    `Stop these reminders: ${stop}`,
    "",
    "PERM Tracker",
    SITE_URL,
    TEXT_LEGAL_LINE,
  ].join("\n");
}
