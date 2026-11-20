/**
 * Centralized User Data Deletion
 *
 * Single source of truth for purging all user data.
 * Used by both admin deletion and user-initiated account deletion.
 *
 * @module
 */

import { dropReminderRetries, dropRetries } from "./alertOutboxStore";
import { stopListMail, type ListMailStopped } from "./listMailOff";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { recordError } from "./errorRecording";
import { deleteCaseDocumentBlobs } from "./caseDocumentBlobs";
import { APPLICANTS_PER_CASE_MAX } from "./perm/recruitment/applicantReport";

interface PurgeResult {
  /** The deleted user's email, captured before the user row is removed. */
  email: string | undefined;
  storageBlobsDeleted: number;
  cases: number;
  notifications: number;
  conversations: number;
  auditLogs: number;
  caseOrders: number;
  timelinePrefs: number;
  templates: number;
  apiKeys: number;
  authAccounts: number;
  authSessions: number;
  authRefreshTokens: number;
  authVerificationCodes: number;
  profileDeleted: boolean;
  userDeleted: boolean;
  /** The address's list mail turned off (convex/lib/listMailOff.ts). */
  listMail: ListMailStopped;
}

/**
 * Purge ALL data for a user. Deletes everything:
 * cases, notifications, conversations (+ messages + tool cache),
 * audit logs, case order, timeline prefs, job description templates,
 * user profile, auth accounts (+ verification codes),
 * auth sessions (+ refresh tokens), the address's rows in the email
 * event log, and the user record itself.
 *
 * This is the single source of truth for user deletion.
 * Both `deleteUserAdmin` and `permanentlyDeleteAccount` call this.
 */
/**
 * Delete the applicant logs of the given cases: run when a case is deleted, as the Privacy Policy's Case Data list
 * says. Bounded by the log's per-case cap.
 */
export async function deleteCaseApplicants(ctx: MutationCtx, caseIds: readonly Id<"cases">[]): Promise<number> {
  let n = 0;
  for (const caseId of caseIds) {
    const rows = await ctx.db
      .query("recruitmentApplicants")
      .withIndex("by_caseId", (q) => q.eq("caseId", caseId))
      .take(APPLICANTS_PER_CASE_MAX + 1);
    for (const r of rows) {
      await ctx.db.delete(r._id);
      n += 1;
    }
  }
  return n;
}

/**
 * Delete the share links of the given cases (convex/recruitmentShares.ts): run when a case is deleted, as the Privacy
 * Policy says. A case holds one live link and at most one turned off, so the read is small.
 */
export async function deleteCaseShares(ctx: MutationCtx, caseIds: readonly Id<"cases">[]): Promise<number> {
  let n = 0;
  for (const caseId of caseIds) {
    const rows = await ctx.db
      .query("recruitmentShares")
      .withIndex("by_caseId", (q) => q.eq("caseId", caseId))
      .take(50);
    for (const r of rows) {
      await ctx.db.delete("recruitmentShares", r._id);
      n += 1;
    }
  }
  return n;
}

/**
 * Delete the second reminder recipients of the given cases (convex/reminderRecipients.ts), with any of their mail
 * still waiting in the retry queue: run when a case is deleted, as the Privacy Policy says. A case holds one, so the
 * read is small.
 */
export async function deleteCaseReminderRecipients(ctx: MutationCtx, caseIds: readonly Id<"cases">[]): Promise<number> {
  let n = 0;
  for (const caseId of caseIds) {
    const rows = await ctx.db
      .query("reminderRecipients")
      .withIndex("by_caseId", (q) => q.eq("caseId", caseId))
      .take(50);
    for (const r of rows) {
      await dropReminderRetries(ctx, r);
      await ctx.db.delete("reminderRecipients", r._id);
      n += 1;
    }
  }
  return n;
}

export async function purgeAllUserData(
  ctx: MutationCtx,
  userId: Id<"users">
): Promise<PurgeResult> {
  // Capture the email BEFORE deleting the user row, so callers can finish
  // external cleanup (e.g. removing the Resend contact) after the purge.
  const userDoc = await ctx.db.get(userId);
  const email = userDoc?.email;

  // Delete all user's cases, and their uploaded document blobs from storage
  // (the row holds the storageId; the blob must be deleted separately or it's
  // orphaned). Mirrors documents.removeDocument.
  const cases = await ctx.db
    .query("cases")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  let storageBlobsDeleted = 0;
  const failedBlobs: string[] = [];
  for (const caseDoc of cases) {
    const blobs = await deleteCaseDocumentBlobs(ctx, caseDoc);
    storageBlobsDeleted += blobs.deleted;
    failedBlobs.push(...blobs.failed);
    await ctx.db.delete(caseDoc._id);
  }
  // Record blob-deletion failures ONCE per purge (not per blob) to avoid alert
  // spam. Orphaned blobs are non-critical but worth visibility.
  if (failedBlobs.length > 0) {
    await recordError(
      ctx,
      "mutation",
      "deletion.purgeAllUserData.storage",
      new Error(`Failed to delete ${failedBlobs.length} storage blob(s) during purge`),
      { resourceId: failedBlobs.join(",").slice(0, 500), userId }
    );
  }

  // Delete the applicant logs the user kept for those cases (the Privacy Policy's Case Data list says they go with
  // the account), by the user's own index so a log whose case is already gone goes too.
  const applicants = await ctx.db
    .query("recruitmentApplicants")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
  for (const a of applicants) await ctx.db.delete(a._id);

  // The links that shared those cases' recruitment records stop with the account (the Privacy Policy says so).
  for await (const share of ctx.db.query("recruitmentShares").withIndex("by_userId", (q) => q.eq("userId", userId))) {
    await ctx.db.delete("recruitmentShares", share._id);
  }

  // So does anyone else who got those cases' deadline reminders (convex/reminderRecipients.ts), with their mail
  // still waiting in the retry queue.
  for await (const r of ctx.db.query("reminderRecipients").withIndex("by_userId", (q) => q.eq("userId", userId))) {
    await dropReminderRetries(ctx, r);
    await ctx.db.delete("reminderRecipients", r._id);
  }
  // And the account's count of invitations to each address, and the refusals its second people gave it by a
  // reminder's Stop link (keyed hashes, never addresses). A refusal of every account ("Don't invite me again") names
  // no account and stays.
  for await (const c of ctx.db
    .query("reminderInviteCounts")
    .withIndex("by_userId_and_addressKey", (q) => q.eq("userId", userId))) {
    await ctx.db.delete("reminderInviteCounts", c._id);
  }
  for await (const r of ctx.db
    .query("reminderRefusals")
    .withIndex("by_userId_and_addressKey", (q) => q.eq("userId", userId))) {
    await ctx.db.delete("reminderRefusals", r._id);
  }

  // Delete all user's notifications
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  for (const notif of notifications) {
    await ctx.db.delete(notif._id);
  }

  // Delete conversations, messages, and tool cache
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  for (const conv of conversations) {
    const messages = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation_id", (q) => q.eq("conversationId", conv._id))
      .collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    const cacheEntries = await ctx.db
      .query("toolCache")
      .withIndex("by_conversation_tool_hash", (q) => q.eq("conversationId", conv._id))
      .collect();
    for (const entry of cacheEntries) {
      await ctx.db.delete(entry._id);
    }

    await ctx.db.delete(conv._id);
  }

  // Delete the chat's confirmation cards (their arguments hold case data)
  for await (const card of ctx.db
    .query("chatConfirmations")
    .withIndex("by_user_tool_call", (q) => q.eq("userId", userId))) {
    await ctx.db.delete(card._id);
  }

  // Delete audit logs
  const auditLogs = await ctx.db
    .query("auditLogs")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  for (const logEntry of auditLogs) {
    await ctx.db.delete(logEntry._id);
  }

  // Delete custom case order
  const caseOrders = await ctx.db
    .query("userCaseOrder")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  for (const order of caseOrders) {
    await ctx.db.delete(order._id);
  }

  // Delete timeline preferences
  const timelinePrefs = await ctx.db
    .query("timelinePreferences")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  for (const pref of timelinePrefs) {
    await ctx.db.delete(pref._id);
  }

  // Delete job description templates
  const templates = await ctx.db
    .query("jobDescriptionTemplates")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  for (const template of templates) {
    await ctx.db.delete(template._id);
  }

  // API keys and the API account. The calls those keys made are counted in
  // the public-data database under the account's random id only, which
  // names nobody once these rows are gone.
  const apiKeys = await ctx.db
    .query("apiKeys")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const key of apiKeys) {
    await ctx.db.delete(key._id);
  }
  const apiAccounts = await ctx.db
    .query("apiAccounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  // The account's webhooks go with it: endpoints (and their secrets),
  // watches, and the delivery log. Events name no account but a watch's.
  for (const acct of apiAccounts) {
    const endpoints = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_account", (q) => q.eq("account", acct.account))
      .collect();
    for (const e of endpoints) await ctx.db.delete(e._id);
    const watches = await ctx.db
      .query("webhookWatches")
      .withIndex("by_account", (q) => q.eq("account", acct.account))
      .collect();
    for (const w of watches) await ctx.db.delete(w._id);
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_account", (q) => q.eq("account", acct.account))
      .take(4000);
    for (const d of deliveries) await ctx.db.delete(d._id);
  }
  for (const acct of apiAccounts) {
    await ctx.db.delete(acct._id);
  }

  // Delete user profile (use collect to handle any duplicates)
  const profiles = await ctx.db
    .query("userProfiles")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .collect();
  for (const profile of profiles) {
    await ctx.db.delete(profile._id);
  }

  // Delete auth accounts and their child verification codes
  const authAccounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  let authVerificationCodesCount = 0;
  for (const account of authAccounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const code of codes) {
      await ctx.db.delete(code._id);
    }
    authVerificationCodesCount += codes.length;
    await ctx.db.delete(account._id);
  }

  // Delete auth sessions and their child refresh tokens
  const authSessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  let authRefreshTokensCount = 0;
  for (const session of authSessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) {
      await ctx.db.delete(token._id);
    }
    authRefreshTokensCount += tokens.length;
    await ctx.db.delete(session._id);
  }

  // The address's list mail stops too. Every alert table is keyed by address,
  // not account, so the rows above never covered it: onboarding's "Waiting on
  // my own case" writes a case alert that a verified account confirms at once,
  // and the same address can follow a queue month, a bulletin line, an
  // employer, the news and the digest. Each is turned off the way its own
  // opt-out does it (tombstoned, its waiting outbox and retry mail dropped),
  // with any confirmation still waiting for room and any founder's note still
  // due. Nov 4 2026: until then they kept mailing a deleted account's address.
  let listMail: ListMailStopped = { subscriptions: 0, confirmations: 0, congratsNotes: 0 };
  if (email) {
    const now = Date.now();
    for (const address of new Set([email.toLowerCase().trim(), email])) {
      const stopped = await stopListMail(ctx, address, now);
      listMail = {
        subscriptions: listMail.subscriptions + stopped.subscriptions,
        confirmations: listMail.confirmations + stopped.confirmations,
        congratsNotes: listMail.congratsNotes + stopped.congratsNotes,
      };
    }
  }

  // The email event log (Resend's contact events, convex/marketingWebhook.ts) holds the
  // address, the names and each event's payload. It isn't on the Privacy Policy's list
  // of what stays, so the address's rows go with the account. One address has a handful.
  if (email) {
    for (const address of new Set([email.toLowerCase().trim(), email])) {
      const events = await ctx.db
        .query("marketingEvents")
        .withIndex("by_email_and_time", (q) => q.eq("email", address))
        .collect();
      for (const event of events) await ctx.db.delete(event._id);
    }
  }

  // Mail waiting in the retry queue for this address goes too (a deadline
  // reminder carries case details), except the deletion confirmation itself.
  if (email) {
    await dropRetries(ctx, email.toLowerCase().trim(), (r) => r.kind !== "notification:sendAccountDeletionEmail");
  }

  // Finally delete the user record itself
  await ctx.db.delete(userId);

  return {
    email,
    storageBlobsDeleted,
    cases: cases.length,
    notifications: notifications.length,
    conversations: conversations.length,
    auditLogs: auditLogs.length,
    caseOrders: caseOrders.length,
    timelinePrefs: timelinePrefs.length,
    templates: templates.length,
    apiKeys: apiKeys.length,
    authAccounts: authAccounts.length,
    authSessions: authSessions.length,
    authRefreshTokens: authRefreshTokensCount,
    authVerificationCodes: authVerificationCodesCount,
    profileDeleted: profiles.length > 0,
    userDeleted: true,
    listMail,
  };
}
