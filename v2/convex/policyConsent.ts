/**
 * Active consent to a policy change (rules and versions: convex/lib/policyConsent.ts).
 *
 * - Signed in: `myStatus` tells the app's banner whether this account must accept the current version, and
 *   `accept` records it on the account's own row.
 * - Alert subscribers without an account: the change email (`sendNotice`) carries a link signed for the address
 *   AND the version; its page is a GET that shows the change and a POST button (`/prefs/policy` in convex/http.ts),
 *   and `acceptByToken` records the click in `policyConsents`, keyed by the address's hash.
 * - The change email goes only when the owner runs `startNotices` by hand after a version bump. Nothing schedules
 *   it. Each send is charged to its own pool BEFORE it is scheduled, and a sweep that meets the pool's end waits for
 *   it to reset instead of bursting the day's mail.
 *
 * @module
 */
import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getCurrentUserId, getCurrentUserIdOrNull, getUserByEmail } from "./lib/auth";
import { checkAndRecordRateLimit } from "./lib/rateLimit";
import { BUDGETS, windowFor } from "./lib/alertBudgets";
import {
  NOTICE_PAGE,
  NOTICE_TABLES,
  POLICY_ACCEPT_IP_LIMIT,
  POLICY_BASELINE_VERSION,
  POLICY_CONSENT_VERSION,
  isPolicyVersion,
  needsConsent,
  policyAcceptPurpose,
} from "./lib/policyConsent";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./lib/unsubscribeToken";
import { raterKeyFor } from "./siteReviews";
import { FROM_EMAIL, getResend, sendOrQueue } from "./lib/email";
import { SITE_URL } from "./lib/links";
import { oneClickUnsubscribeUrl, prefsLink } from "./lib/prefsLink";
import { recordError } from "./lib/errorRecording";
import { TEXT_LEGAL_LINE } from "./lib/textFooter";
import { MS_PER_MINUTE } from "./lib/time";

function unsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not configured");
  return secret;
}

/** The accept page for one address and one version, on the public site (nginx relays /prefs/* to Convex). */
export function acceptUrl(token: string, version: string): string {
  return `${SITE_URL}/prefs/policy?token=${encodeURIComponent(token)}&v=${encodeURIComponent(version)}`;
}

// ============================================================================
// Signed in
// ============================================================================

/** Whether this account must accept the current version; null when nobody is signed in. */
export const myStatus = query({
  args: {},
  returns: v.union(v.null(), v.object({ needed: v.boolean(), version: v.string() })),
  handler: async (ctx) => {
    const userId = await getCurrentUserIdOrNull(ctx);
    if (!userId) return null;
    const user = await ctx.db.get("users", userId);
    if (!user || user.deletedAt) return null;
    return { needed: needsConsent(user.policyAcceptedVersion, POLICY_CONSENT_VERSION), version: POLICY_CONSENT_VERSION };
  },
});

/** The signed-in account accepts the current version. Only the current one: an old tab can't accept a newer text. */
export const accept = mutation({
  args: { version: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await getCurrentUserId(ctx);
    if (args.version !== POLICY_CONSENT_VERSION) return { ok: false };
    await ctx.db.patch("users", userId, { policyAcceptedVersion: args.version, policyAcceptedAt: Date.now() });
    return { ok: true };
  },
});

// ============================================================================
// Alert subscribers without an account
// ============================================================================

/**
 * The click on the accept page's button. Guards in cost order: the shapes, the caller's limit, then the signature.
 * A token accepts only the version it names, and only while that version is current.
 */
export const acceptByToken = internalMutation({
  args: { token: v.string(), version: v.string(), ip: v.string() },
  returns: v.object({
    status: v.union(v.literal("accepted"), v.literal("already"), v.literal("bad"), v.literal("stale"), v.literal("throttled")),
  }),
  handler: async (ctx, args) => {
    const token = args.token.slice(0, 512);
    if (!token || !isPolicyVersion(args.version)) return { status: "bad" as const };
    const ip = args.ip.slice(0, 64).trim();
    if (ip && ip !== "unknown") {
      const limited = await checkAndRecordRateLimit(ctx, ip, "policy_accept_ip", POLICY_ACCEPT_IP_LIMIT);
      if (!limited.allowed) return { status: "throttled" as const };
    }
    if (args.version !== POLICY_CONSENT_VERSION) return { status: "stale" as const };
    const email = await verifyUnsubscribeToken(token, unsubscribeSecret(), policyAcceptPurpose(args.version));
    if (!email) return { status: "bad" as const };
    const key = await raterKeyFor(email);
    const row = await ctx.db
      .query("policyConsents")
      .withIndex("by_key_version", (q) => q.eq("key", key).eq("version", args.version))
      .unique();
    if (row?.acceptedAt) return { status: "already" as const };
    if (row) await ctx.db.patch("policyConsents", row._id, { acceptedAt: Date.now() });
    else await ctx.db.insert("policyConsents", { key, version: args.version, acceptedAt: Date.now() });
    return { status: "accepted" as const };
  },
});

// ============================================================================
// The change email, run by hand after a version bump
// ============================================================================

const noticeTable = v.union(...NOTICE_TABLES.map((t) => v.literal(t)));

/**
 * Starts the sweep for the current version: `npx convex run policyConsent:startNotices '{"version":"<v>"}' --prod`.
 * Refuses the baseline (nobody has anything to accept) and any version that isn't the current one.
 */
export const startNotices = internalMutation({
  args: { version: v.string() },
  returns: v.object({ started: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    if (args.version !== POLICY_CONSENT_VERSION) return { started: false, reason: "not the current version" };
    if (args.version === POLICY_BASELINE_VERSION) return { started: false, reason: "the baseline needs no consent" };
    await ctx.scheduler.runAfter(0, internal.policyConsent.noticeBatch, { version: args.version, table: NOTICE_TABLES[0], cursor: null });
    return { started: true };
  },
});

/**
 * One step of the sweep: a page of one alert table, in address order. A confirmed, live subscriber with no account
 * and no notice yet for this version gets one, charged to the pool first; at the pool's end the step reschedules
 * itself, same page, for when the pool resets, and a page's earlier sends are not repeated (their rows are stamped).
 */
export const noticeBatch = internalMutation({
  args: { version: v.string(), table: noticeTable, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ sent: v.number(), waiting: v.boolean(), done: v.boolean() }),
  handler: async (ctx, args) => {
    if (args.version !== POLICY_CONSENT_VERSION || args.version === POLICY_BASELINE_VERSION) {
      return { sent: 0, waiting: false, done: true };
    }
    const page = await ctx.db
      .query(args.table)
      .withIndex("by_email")
      .paginate({ numItems: NOTICE_PAGE, cursor: args.cursor });
    const seen = new Set<string>();
    let sent = 0;
    for (const row of page.page) {
      if (!row.confirmedAt || row.unsubscribedAt) continue;
      const email = row.email.trim().toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      // An account gets the banner at sign-in instead.
      const user = await getUserByEmail(ctx, email);
      if (user && !user.deletedAt) continue;
      const key = await raterKeyFor(email);
      const held = await ctx.db
        .query("policyConsents")
        .withIndex("by_key_version", (q) => q.eq("key", key).eq("version", args.version))
        .unique();
      if (held?.noticeSentAt || held?.acceptedAt) continue;
      const budget = await checkAndRecordRateLimit(ctx, "all", BUDGETS.policyNotice.key, windowFor("policyNotice"));
      if (!budget.allowed) {
        await ctx.scheduler.runAfter(Math.max(budget.resetInMs, MS_PER_MINUTE), internal.policyConsent.noticeBatch, args);
        return { sent, waiting: true, done: false };
      }
      if (held) await ctx.db.patch("policyConsents", held._id, { noticeSentAt: Date.now() });
      else await ctx.db.insert("policyConsents", { key, version: args.version, noticeSentAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.policyConsent.sendNotice, { email, version: args.version });
      sent += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.policyConsent.noticeBatch, { ...args, cursor: page.continueCursor });
      return { sent, waiting: false, done: false };
    }
    const next = NOTICE_TABLES[NOTICE_TABLES.indexOf(args.table) + 1];
    if (next) await ctx.scheduler.runAfter(0, internal.policyConsent.noticeBatch, { version: args.version, table: next, cursor: null });
    return { sent, waiting: false, done: next === undefined };
  },
});

/** One change email. Through `sendOrQueue`, so a full day's count keeps it in the retry queue for the next. */
export const sendNotice = internalAction({
  args: { email: v.string(), version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const secret = unsubscribeSecret();
      const link = acceptUrl(await makeUnsubscribeToken(args.email, secret, policyAcceptPurpose(args.version)), args.version);
      const prefsUrl = await prefsLink(args.email, secret);
      const prefsToken = await makeUnsubscribeToken(args.email, secret, "prefs");
      const oneClick = oneClickUnsubscribeUrl(prefsToken, "alerts");
      let html: string | undefined;
      try {
        const { render } = await import("@react-email/render");
        const { PolicyChange } = await import("../src/emails/PolicyChange");
        html = await render(PolicyChange({ acceptUrl: link, prefsUrl }));
      } catch (error) {
        await recordError(ctx, "action", "policyConsent.sendNotice.render", error);
      }
      const result = await sendOrQueue(ctx, "policy-change", getResend(), {
        from: FROM_EMAIL,
        to: args.email,
        subject: "We updated our Privacy Policy and Terms",
        html,
        text: [
          "We changed how we use information you've already given us, so the change waits for you. Until you accept it, your alerts keep running under the version you last agreed to.",
          "",
          "Read the change and accept it here:",
          link,
          "",
          "You don't have to do anything else, and you can turn your alerts off at any time:",
          prefsUrl,
          "",
          "PERM Tracker",
          SITE_URL,
          TEXT_LEGAL_LINE,
        ].join("\n"),
        headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      if (result.error) {
        await recordError(ctx, "action", "policyConsent.sendNotice", new Error(`${result.error.name}: ${result.error.message}`));
      }
    } catch (error) {
      await recordError(ctx, "action", "policyConsent.sendNotice", error);
    }
    return null;
  },
});
