/**
 * Database-side rules for a case's second reminder recipient, shared by convex/reminderRecipients.ts and the email
 * retry worker (convex/emailLedger.ts): whether a row's case and account are live, and whether a retry kept for a row
 * may still go.
 *
 * @module
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { REMINDER_COPY_KIND, REMINDER_INVITE_KIND, REMINDER_REF_PREFIX } from "./reminderRecipients";

/** The case a row is for, while it's live and its account is too; null otherwise. */
export async function liveCase(
  ctx: QueryCtx | MutationCtx,
  row: Doc<"reminderRecipients">,
): Promise<Doc<"cases"> | null> {
  const caseDoc = await ctx.db.get("cases", row.caseId);
  if (!caseDoc || caseDoc.userId !== row.userId || caseDoc.deletedAt !== undefined) return null;
  const user = await ctx.db.get("users", row.userId);
  if (!user || user.deletedAt !== undefined) return null;
  return caseDoc;
}

/**
 * Whether a retry kept for a second person may still go, read just before the retry worker hands it out. Every path
 * that ends a row drops what's queued for it (dropReminderRetries), but a send already in flight can fail and queue
 * itself a moment after. So a retry that names a row (`reminder:<id>`) goes only while that row still exists, holds
 * the same address, has the status its kind needs (waiting for an invitation, confirmed for a reminder) and its case
 * and account are live. Mail that names no row is someone else's, and isn't held here.
 */
export async function reminderRetryStillWanted(
  ctx: QueryCtx | MutationCtx,
  retry: Pick<Doc<"emailRetries">, "kind" | "to" | "refs">,
): Promise<boolean> {
  for (const ref of retry.refs ?? []) {
    if (!ref.startsWith(REMINDER_REF_PREFIX)) continue;
    const raw = ref.slice(REMINDER_REF_PREFIX.length);
    const id = raw.length <= 64 ? ctx.db.normalizeId("reminderRecipients", raw) : null;
    const row = id ? await ctx.db.get("reminderRecipients", id) : null;
    if (!row || !row.email || row.email !== retry.to) return false;
    const status = retry.kind === REMINDER_INVITE_KIND ? "waiting" : retry.kind === REMINDER_COPY_KIND ? "confirmed" : null;
    if (row.status !== status) return false;
    if (!(await liveCase(ctx, row))) return false;
  }
  return true;
}
