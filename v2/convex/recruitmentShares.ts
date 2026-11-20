/**
 * A case's recruitment record, shared with the client (the employer) by a private link.
 *
 * The case's own account makes the link from the case's Recruitment tab. The link opens a read-only page at
 * /share/recruitment/<key> with no sign-in: the employer, the job title, each recruitment step with its dates, the
 * filing window and the applicant log, built by sharedRecruitmentRecord (convex/lib/perm/recruitment/sharedRecord.ts)
 * and nothing else from the case or the account.
 *
 * THE KEY. Made in an action, because queries and mutations can't use cryptographic randomness: 32 random bytes,
 * base64url. Only its SHA-256 is stored and the action returns the link once, so nothing can show it again; a lost
 * link is turned off and a new one made. One live link per case. A turned-off link answers nothing, and the next
 * link made for the case clears it.
 *
 * THE PUBLIC READ. `recordByToken` takes the key, hashes it and returns the record, or null for a key that's
 * malformed, unknown or off, a case that's gone, or an account being deleted. Only someone holding the key can
 * compute its hash. `recordView` notes the Eastern day the page was last opened; the page's script calls it after
 * the page has loaded, so a mail scanner fetching the link writes nothing.
 *
 * Every link goes with its case (cases.remove, through clearCaseReferences) and with the account
 * (lib/deletion.ts), as the Privacy Policy says.
 */
import { ConvexError, v } from "convex/values";

import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { extractUserIdFromAction, getCurrentUserId } from "./lib/auth";
import { SITE_URL } from "./lib/links";
import { APPLICANTS_PER_CASE_MAX } from "./lib/perm/recruitment/applicantReport";
import { sharedRecruitmentRecord } from "./lib/perm/recruitment/sharedRecord";
import { hashShareToken, isShareToken, newShareToken, SHARE_RECRUITMENT_PATH, SHARE_TOKEN_HASH_RE } from "./lib/shareToken";
import { easternDay } from "./lib/time";
import { contactV, outcomeV } from "./recruitmentApplicants";

/**
 * The most rows one case's links are read in. A case holds one link at a time, live or turned off (each new link
 * clears the turned-off one), so this is room to spare, never a cap anyone meets.
 */
const LINKS_READ_PER_CASE = 25;

const failure = v.object({ ok: v.literal(false), message: v.string() });
type Failure = { ok: false; message: string };

const nullableString = v.union(v.string(), v.null());

const recordValidator = v.object({
  employerName: v.string(),
  positionTitle: v.string(),
  steps: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      dates: v.array(v.object({ start: v.string(), end: nullableString })),
    }),
  ),
  filingWindow: v.union(v.object({ opens: nullableString, closes: nullableString }), v.null()),
  applicants: v.array(
    v.object({
      ref: v.string(),
      appliedOn: nullableString,
      contactedOn: nullableString,
      contactMethod: v.union(contactV, v.null()),
      outcome: outcomeV,
      reason: nullableString,
    }),
  ),
});

async function linksOf(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">): Promise<Doc<"recruitmentShares">[]> {
  return await ctx.db
    .query("recruitmentShares")
    .withIndex("by_caseId", (q) => q.eq("caseId", caseId))
    .take(LINKS_READ_PER_CASE);
}

/** The live link a key opens, or null. Cheap checks first: a key of the wrong shape is never hashed. */
async function liveLink(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"recruitmentShares"> | null> {
  if (!isShareToken(token)) return null;
  const tokenHash = await hashShareToken(token);
  const link = await ctx.db
    .query("recruitmentShares")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  return link && link.turnedOffAt === undefined ? link : null;
}

type Made = { ok: true; url: string; createdAt: number } | Failure;

/** Make the case's link. The returned `url` is the only time the link exists outside its owner's hands. */
export const create = action({
  args: { caseId: v.id("cases") },
  returns: v.union(v.object({ ok: v.literal(true), url: v.string(), createdAt: v.number() }), failure),
  handler: async (ctx, args): Promise<Made> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, message: "Sign in to share this record." };
    const userId = extractUserIdFromAction(identity.subject);
    const token = newShareToken();
    const result: { ok: true; createdAt: number } | Failure = await ctx.runMutation(internal.recruitmentShares.insertLink, {
      userId,
      caseId: args.caseId,
      tokenHash: await hashShareToken(token),
    });
    if (!result.ok) return result;
    return { ok: true, url: `${SITE_URL}${SHARE_RECRUITMENT_PATH}${token}`, createdAt: result.createdAt };
  },
});

export const insertLink = internalMutation({
  args: { userId: v.id("users"), caseId: v.id("cases"), tokenHash: v.string() },
  returns: v.union(v.object({ ok: v.literal(true), createdAt: v.number() }), failure),
  handler: async (ctx, args): Promise<{ ok: true; createdAt: number } | Failure> => {
    if (!SHARE_TOKEN_HASH_RE.test(args.tokenHash)) throw new Error("malformed share link record");
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.deletedAt !== undefined) return { ok: false, message: "This account is being deleted, so it can't share a record." };
    const caseDoc = await ctx.db.get("cases", args.caseId);
    if (!caseDoc || caseDoc.userId !== args.userId || caseDoc.deletedAt !== undefined) {
      return { ok: false, message: "That case isn't one of yours." };
    }
    const links = await linksOf(ctx, args.caseId);
    if (links.some((l) => l.turnedOffAt === undefined)) {
      return { ok: false, message: "This case already has a link. Turn it off to make a new one." };
    }
    // The links turned off before this one answer nothing; they go now, so a case never collects them.
    for (const l of links) await ctx.db.delete("recruitmentShares", l._id);
    const createdAt = Date.now();
    await ctx.db.insert("recruitmentShares", { userId: args.userId, caseId: args.caseId, tokenHash: args.tokenHash, createdAt });
    return { ok: true, createdAt };
  },
});

/** Whether the signed-in owner's case has a live link, when it was made and last opened. Never the link itself. */
export const forCase = query({
  args: { caseId: v.id("cases") },
  returns: v.union(v.null(), v.object({ createdAt: v.number(), lastViewedOn: nullableString })),
  handler: async (ctx, { caseId }) => {
    const userId = await getCurrentUserId(ctx);
    const caseDoc = await ctx.db.get("cases", caseId);
    if (!caseDoc || caseDoc.userId !== userId) return null;
    const live = (await linksOf(ctx, caseId)).find((l) => l.turnedOffAt === undefined);
    return live ? { createdAt: live.createdAt, lastViewedOn: live.lastViewedOn ?? null } : null;
  },
});

/** Turn the case's link off. Anyone who opens it then sees that it's off. */
export const turnOff = mutation({
  args: { caseId: v.id("cases") },
  returns: v.object({ turnedOff: v.boolean() }),
  handler: async (ctx, { caseId }) => {
    const userId = await getCurrentUserId(ctx);
    const caseDoc = await ctx.db.get("cases", caseId);
    if (!caseDoc || caseDoc.userId !== userId) throw new ConvexError("That case isn't one of yours.");
    let turnedOff = false;
    for (const l of await linksOf(ctx, caseId)) {
      if (l.turnedOffAt !== undefined) continue;
      await ctx.db.patch("recruitmentShares", l._id, { turnedOffAt: Date.now() });
      turnedOff = true;
    }
    return { turnedOff };
  },
});

/** The record a link opens, for anyone holding it; null for a link that's off or doesn't exist. */
export const recordByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), recordValidator),
  handler: async (ctx, { token }) => {
    const link = await liveLink(ctx, token);
    if (!link) return null;
    const caseDoc = await ctx.db.get("cases", link.caseId);
    if (!caseDoc || caseDoc.userId !== link.userId || caseDoc.deletedAt !== undefined) return null;
    const user = await ctx.db.get("users", link.userId);
    if (!user || user.deletedAt !== undefined) return null;
    const applicants = await ctx.db
      .query("recruitmentApplicants")
      .withIndex("by_caseId", (q) => q.eq("caseId", caseDoc._id))
      .take(APPLICANTS_PER_CASE_MAX);
    return sharedRecruitmentRecord(caseDoc, applicants);
  },
});

/**
 * Note the Eastern day a link's page was opened, at most one write a day. Called by the page's script once it has
 * loaded, never by the request for the page. A key that's malformed, unknown or off writes nothing.
 */
export const recordView = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, { token }) => {
    const link = await liveLink(ctx, token);
    if (!link) return null;
    const today = easternDay(Date.now());
    if (link.lastViewedOn !== today) await ctx.db.patch("recruitmentShares", link._id, { lastViewedOn: today });
    return null;
  },
});
