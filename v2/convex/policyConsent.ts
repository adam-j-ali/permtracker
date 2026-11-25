/**
 * Active consent to a policy change (rules and versions: convex/lib/policyConsent.ts).
 *
 * - Signed in: `myStatus` tells the app's banner whether this account must accept the current version, and
 *   `accept` records it on the account's own row. A new account is stamped with the version of the day it opens
 *   (convex/auth.ts), so only accounts older than a change are asked.
 * - Email subscribers without an account: the change email (`sendNotices`) carries a link signed for the address
 *   AND the version; its page is a GET that shows the change and a POST button (`/prefs/policy` in convex/http.ts),
 *   and `acceptByToken` records the click in `policyConsents`, keyed by the address's hash. Confirming an alert or
 *   the digest after a change records consent too (convex/lib/policyConsentStore.ts).
 * - The change email goes only when the owner runs `startNotices` by hand after a version bump. Nothing schedules
 *   it. Each step claims a page's addresses, charges each to the pool BEFORE it is sent, and hands them to ONE action
 *   that sends them in turn and only then schedules the next step, so no two sends read the day's count at once
 *   and the list ceiling holds. At the pool's end the next step waits for it to reset.
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
  NOTICE_REF,
  NOTICE_TABLES,
  POLICY_ACCEPT_IP_LIMIT,
  POLICY_BASELINE_VERSION,
  POLICY_CHANGE_SUMMARIES,
  POLICY_CONSENT_VERSION,
  isPolicyVersion,
  liveRow,
  needsConsent,
  policyAcceptPurpose,
} from "./lib/policyConsent";
import { consentKey, recordAddressConsent } from "./lib/policyConsentStore";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./lib/unsubscribeToken";
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

/** A version that can be put to anyone: the current one, above the baseline, with its sentence of what changed. */
function askable(version: string): boolean {
  return version === POLICY_CONSENT_VERSION && version > POLICY_BASELINE_VERSION && Boolean(POLICY_CHANGE_SUMMARIES[version]);
}

// ============================================================================
// Signed in
// ============================================================================

/** Whether this account must accept the current version, and what it changes; null when nobody is signed in. */
export const myStatus = query({
  args: {},
  returns: v.union(v.null(), v.object({ needed: v.boolean(), version: v.string(), summary: v.union(v.string(), v.null()) })),
  handler: async (ctx) => {
    const userId = await getCurrentUserIdOrNull(ctx);
    if (!userId) return null;
    const user = await ctx.db.get("users", userId);
    if (!user || user.deletedAt) return null;
    return {
      needed: needsConsent(user.policyAcceptedVersion, POLICY_CONSENT_VERSION),
      version: POLICY_CONSENT_VERSION,
      summary: POLICY_CHANGE_SUMMARIES[POLICY_CONSENT_VERSION] ?? null,
    };
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
// Email subscribers without an account
// ============================================================================

/**
 * The click on the accept page's button. A token accepts only the version it names, and only while that version is
 * current. The caller's limit counts FAILED signatures only, so a valid link is never refused because of someone
 * else's tries from the same address (before nginx passes the visitor's address, every click shares one).
 */
export const acceptByToken = internalMutation({
  args: { token: v.string(), version: v.string(), ip: v.string() },
  returns: v.object({
    status: v.union(v.literal("accepted"), v.literal("already"), v.literal("bad"), v.literal("stale"), v.literal("throttled")),
  }),
  handler: async (ctx, args) => {
    const token = args.token.slice(0, 512);
    if (!token || !isPolicyVersion(args.version)) return { status: "bad" as const };
    if (args.version !== POLICY_CONSENT_VERSION) return { status: "stale" as const };
    const email = await verifyUnsubscribeToken(token, unsubscribeSecret(), policyAcceptPurpose(args.version));
    if (!email) {
      const ip = args.ip.slice(0, 64).trim();
      if (ip && ip !== "unknown") {
        const limited = await checkAndRecordRateLimit(ctx, ip, "policy_accept_ip", POLICY_ACCEPT_IP_LIMIT);
        if (!limited.allowed) return { status: "throttled" as const };
      }
      return { status: "bad" as const };
    }
    return { status: (await recordAddressConsent(ctx, email, args.version)) ? ("accepted" as const) : ("already" as const) };
  },
});

// ============================================================================
// The change email, run by hand after a version bump
// ============================================================================

const noticeTable = v.union(...NOTICE_TABLES.map((t) => v.literal(t)));
const nextStep = v.union(v.null(), v.object({ table: noticeTable, cursor: v.union(v.string(), v.null()), delayMs: v.number() }));
const noticeItem = v.object({ email: v.string(), refs: v.array(v.string()) });

/**
 * Starts the sweep for the current version: `npx convex run policyConsent:startNotices '{"version":"<v>"}' --prod`.
 * Refuses the baseline (nobody has anything to accept), any version that isn't the current one, and a version with
 * no sentence of what changed.
 */
export const startNotices = internalMutation({
  args: { version: v.string() },
  returns: v.object({ started: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    if (args.version !== POLICY_CONSENT_VERSION) return { started: false, reason: "not the current version" };
    if (args.version <= POLICY_BASELINE_VERSION) return { started: false, reason: "the baseline needs no consent" };
    if (!POLICY_CHANGE_SUMMARIES[args.version]) return { started: false, reason: "no summary of what changed" };
    await ctx.scheduler.runAfter(0, internal.policyConsent.noticeBatch, {
      version: args.version,
      table: NOTICE_TABLES[0],
      cursor: null,
      startedAt: Date.now(),
    });
    return { started: true };
  },
});

type LooseRow = { _id: string; email: string; confirmedAt?: number; unsubscribedAt?: number; notifiedAt?: number; caseClosedAt?: number };

/**
 * One step of the sweep: a page of one list, in address order. An address counts when it has a row confirmed
 * before the sweep began and still live, no account (an account gets the banner), and no notice or acceptance yet
 * for this version. Each is charged to the pool, then stamped, then handed with the rest of the page to one action.
 */
export const noticeBatch = internalMutation({
  args: { version: v.string(), table: noticeTable, cursor: v.union(v.string(), v.null()), startedAt: v.number() },
  returns: v.object({ claimed: v.number(), waiting: v.boolean(), done: v.boolean() }),
  handler: async (ctx, args) => {
    if (!askable(args.version)) return { claimed: 0, waiting: false, done: true };
    const page = await ctx.db
      .query(args.table)
      .withIndex("by_email")
      .paginate({ numItems: NOTICE_PAGE, cursor: args.cursor });

    // The rows that make each address eligible, as refs: a row confirmed during the sweep, or no longer running,
    // is passed over BEFORE its address is counted, so an older live row for the same address still counts.
    const byEmail = new Map<string, string[]>();
    for (const raw of page.page) {
      const row = raw as unknown as LooseRow;
      if (row.confirmedAt === undefined || row.confirmedAt >= args.startedAt) continue;
      if (!liveRow(args.table, row)) continue;
      const email = row.email.trim().toLowerCase();
      const refs = byEmail.get(email) ?? [];
      refs.push(`${NOTICE_REF[args.table]}:${row._id}`);
      byEmail.set(email, refs);
    }

    const items: { email: string; refs: string[] }[] = [];
    let waitMs: number | null = null;
    for (const [email, refs] of byEmail) {
      const user = await getUserByEmail(ctx, email);
      if (user && !user.deletedAt) continue;
      const key = await consentKey(email);
      const held = await ctx.db
        .query("policyConsents")
        .withIndex("by_key_version", (q) => q.eq("key", key).eq("version", args.version))
        .unique();
      if (held?.noticeSentAt || held?.acceptedAt) continue;
      const budget = await checkAndRecordRateLimit(ctx, "all", BUDGETS.policyNotice.key, windowFor("policyNotice"));
      if (!budget.allowed) {
        waitMs = Math.max(budget.resetInMs, MS_PER_MINUTE);
        break;
      }
      if (held) await ctx.db.patch("policyConsents", held._id, { noticeSentAt: Date.now() });
      else await ctx.db.insert("policyConsents", { key, version: args.version, noticeSentAt: Date.now() });
      items.push({ email, refs });
    }

    // Where the sweep goes next: the same page once the pool resets (its stamped addresses are skipped), the next
    // page, the next list, or nowhere.
    const following = NOTICE_TABLES[NOTICE_TABLES.indexOf(args.table) + 1];
    const next =
      waitMs !== null
        ? { table: args.table, cursor: args.cursor, delayMs: waitMs }
        : !page.isDone
          ? { table: args.table, cursor: page.continueCursor, delayMs: 0 }
          : following
            ? { table: following, cursor: null, delayMs: 0 }
            : null;

    if (items.length > 0) {
      await ctx.scheduler.runAfter(0, internal.policyConsent.sendNotices, { version: args.version, startedAt: args.startedAt, items, next });
    } else if (next) {
      await ctx.scheduler.runAfter(next.delayMs, internal.policyConsent.noticeBatch, {
        version: args.version,
        table: next.table,
        cursor: next.cursor,
        startedAt: args.startedAt,
      });
    }
    return { claimed: items.length, waiting: waitMs !== null, done: next === null };
  },
});

/**
 * One step's change emails, sent in turn: each `sendOrQueue` reads the day's count after the one before it recorded
 * its send, so a day near Resend's ceiling keeps the rest in the retry queue instead of passing it. Then the next
 * step, never before, so steps never overlap.
 */
export const sendNotices = internalAction({
  args: { version: v.string(), startedAt: v.number(), items: v.array(noticeItem), next: nextStep },
  returns: v.null(),
  handler: async (ctx, args) => {
    const summary = POLICY_CHANGE_SUMMARIES[args.version] ?? "";
    for (const item of args.items) {
      try {
        await sendOne(ctx, item.email, args.version, summary, item.refs);
      } catch (error) {
        await recordError(ctx, "action", "policyConsent.sendNotices", error);
      }
    }
    if (args.next) {
      await ctx.scheduler.runAfter(args.next.delayMs, internal.policyConsent.noticeBatch, {
        version: args.version,
        table: args.next.table,
        cursor: args.next.cursor,
        startedAt: args.startedAt,
      });
    }
    return null;
  },
});

async function sendOne(
  ctx: Parameters<typeof recordError>[0] & Parameters<typeof sendOrQueue>[0],
  email: string,
  version: string,
  summary: string,
  refs: string[],
): Promise<void> {
  const secret = unsubscribeSecret();
  const link = acceptUrl(await makeUnsubscribeToken(email, secret, policyAcceptPurpose(version)), version);
  const prefsUrl = await prefsLink(email, secret);
  const oneClick = oneClickUnsubscribeUrl(await makeUnsubscribeToken(email, secret, "prefs"), "alerts");
  let html: string | undefined;
  try {
    const { render } = await import("react-email");
    const { PolicyChange } = await import("../src/emails/PolicyChange");
    html = await render(PolicyChange({ acceptUrl: link, prefsUrl, summary }));
  } catch (error) {
    await recordError(ctx, "action", "policyConsent.sendNotices.render", error);
  }
  const result = await sendOrQueue(
    ctx,
    "policy-change",
    getResend(),
    {
      from: FROM_EMAIL,
      to: email,
      subject: "We updated our Privacy Policy and Terms",
      html,
      text: [
        summary,
        "",
        "The change affects how we use information you've already given us, so it waits for you. Until you accept it, your email from us keeps running under the version you last agreed to.",
        "",
        "Read the change and accept it here:",
        link,
        "",
        "You don't have to do anything else, and you can turn off our emails at any time:",
        prefsUrl,
        "",
        "PERM Tracker",
        SITE_URL,
        TEXT_LEGAL_LINE,
      ].join("\n"),
      headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    },
    { refs },
  );
  if ("error" in result && result.error) {
    await recordError(ctx, "action", "policyConsent.sendNotices", new Error(`${result.error.name}: ${result.error.message}`));
  }
}
