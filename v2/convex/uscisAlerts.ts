/**
 * The USCIS receipt tracking beta: an email when USCIS changes the status of a receipt someone watches.
 *
 * ## Who does what
 *
 * A person signs up a receipt (and, if they like, the DOL case number it follows) on /uscis-case-status or
 * /perm-case-alerts. The sign-up is double opt-in, exactly as a DOL case alert is (convex/caseAlerts.ts): the
 * unauthenticated POST writes an unconfirmed row and sends one email, and only a click in that email (a POST from
 * the page the link opens, never the GET a mail scanner makes) confirms it.
 *
 * A private checker does the checking. It reads the confirmed receipts through GET /uscis-watched, asks USCIS
 * about each every 4 hours and after USCIS's overnight updates, and posts what USCIS said to POST
 * /uscis-watched/results (the contract is in convex/lib/uscisWatch.ts). Neither route says who watches anything.
 *
 * ## Where each thing lives
 *
 * USCIS's newest status lives once per receipt, in `uscisReceipts`; the person lives in `uscisWatches`, which keeps
 * only the status it last told them about (`lastAlertedStatus`). An email is owed when the two differ, so:
 * - the first status the checker finds for a watch is its baseline and sends nothing (the person already knows today's
 *   status: they just looked it up);
 * - a status that moves and moves back before the email goes owes nothing; one that moves back after it went owes
 *   a second email, because the person was told the first move;
 * - a receipt USCIS can't find ("none") is recorded as not found and owes nothing, keeping the last status found;
 * - one receipt watched from two addresses is one status and two emails;
 * - one address whose receipts move in the same run gets one email naming them all (SEND_SETTLE_MS).
 *
 * ## Sending
 *
 * Every alert leaves through `deliverAlert` (kind "uscis", sent at once), and every confirmation through
 * `sendOrQueue`. Each claims its unit from its own pool BEFORE the send (convex/lib/alertBudgets.ts: uscisConfirm,
 * uscisAlert). A spent alert pool sends nothing and drops nothing: the watches stay owed (`alertDue`), and the
 * retry run every 30 minutes sends them when the pool has room. A send the day's account count holds back waits in
 * the retry queue (convex/emailLedger.ts) and counts as told.
 *
 * ## Stopping
 *
 * A stop deletes the watch: the one-click link in every email (every receipt of the address), the preference page
 * (one receipt, or all), account deletion (convex/lib/listMailOff.ts), a year after a final status with nothing new,
 * and 30 days after a sign-up nobody confirmed. The receipt's status goes with its last watch.
 *
 * @module convex/uscisAlerts
 */

import { v } from "convex/values";
import type { ReactElement } from "react";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { admitConfirmation, queueConfirmation, replayArgs } from "./confirmationQueue";
import { BUDGETS, CONFIRMATION_COOLDOWN_MS, noteQueued, SUBSCRIBE_IP_LIMIT, windowFor } from "./lib/alertBudgets";
import { claimHolds, deliverAlert, deliveredSince } from "./lib/alertDelivery";
import { FROM_EMAIL, getResend, sendOrQueue } from "./lib/email";
import { isPlausibleEmail } from "./lib/emailShape";
import { recordError } from "./lib/errorRecording";
import { formatInt } from "./lib/format";
import { actionUrl, SITE_URL } from "./lib/links";
import { createLogger } from "./lib/logging";
import { stageNewsFor, stageNewsletterFor } from "./lib/newsConsent";
import { recordConsentAtConfirm } from "./lib/policyConsentStore";
import { prefsLink } from "./lib/prefsLink";
import { checkAndRecordRateLimit, checkRateLimit, recordRateLimitAttempt } from "./lib/rateLimit";
import { TEXT_LEGAL_LINE } from "./lib/textFooter";
import { connectionThrottleReply } from "./lib/throttleReply";
import { checkedLabel, MS_PER_DAY, MS_PER_HOUR } from "./lib/time";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./lib/unsubscribeToken";
import {
  groupTone,
  isFinalGroup,
  MAX_RECEIPTS_PER_ADDRESS,
  RECEIPT_ALERT_COOLDOWN_MS,
  receiptBlockUrl,
  receiptPageUrl,
  SEND_SETTLE_MS,
  UNCONFIRMED_WATCH_DAYS,
  uscisGroupValidator,
  WATCH_AFTER_FINAL_MS,
  WATCHED_RECEIPTS_CAP,
  watchableReceipt,
} from "./lib/uscisWatch";
import { addWatcher, betaFull, deleteWatch, deleteWatchesFor, metaRow, receiptRow, watchesFor } from "./lib/uscisWatchStore";
import { normaliseFlagCaseNumber } from "../src/lib/flagCaseNumber";
import { RECEIPT_PREFIXES } from "../src/lib/uscis/receipt";

const log = createLogger("UscisAlerts");

/** Every outcome on an address gets these words, so the reply never says what an address watches. */
const NEUTRAL_REPLY = "Check your inbox to confirm.";
/** The same for every receipt and every address while the beta is full, so it says nothing about either. */
export const FULL_REPLY =
  "The beta is watching as many receipts as it can right now. Try again in a few days, when we've made room.";
const RECEIPT_REPLY = "That doesn't look like a USCIS receipt number: three letters and ten digits, from the top of an I-797 notice.";
const DOL_REPLY = "That DOL case number doesn't look right. It's optional, so you can leave it empty.";

/** Times a follow-up waits for the cooldown or the pool to free before it gives up. */
const FOLLOW_UP_TRIES = 6;
/** Addresses one retry run schedules. The rest wait for the next run, 30 minutes on. */
const RETRY_ADDRESSES = 100;
/** Unconfirmed sign-ups one clean-up run deletes. */
const EXPIRE_BATCH = 500;


function unsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not configured");
  return secret;
}

/** The office a receipt's three letters name, from USCIS's glossary, or null. */
function officeOf(receipt: string): string | null {
  return RECEIPT_PREFIXES[receipt.slice(0, 3)]?.name ?? null;
}

const replyValidator = v.object({
  ok: v.boolean(),
  message: v.string(),
  throttled: v.optional(v.boolean()),
  queued: v.optional(v.boolean()),
  /** True when the beta was full: the HTTP layer answers 503. */
  full: v.optional(v.boolean()),
});
type Reply = typeof replyValidator.type;

const namedValidator = v.array(v.object({ receipt: v.string(), dolCaseNumber: v.optional(v.string()) }));

// ============================================================================
// Sign-up
// ============================================================================

/**
 * Ask to watch one receipt. Internal: its only caller is POST /uscis-alert/subscribe (convex/http.ts), which owns
 * CORS and the length caps, and the confirmation queue's replay.
 */
export const subscribe = internalMutation({
  args: {
    email: v.string(),
    receipt: v.string(),
    /** Optional: the person's DOL case number, the PERM this receipt follows. */
    dolCaseNumber: v.optional(v.string()),
    source: v.optional(v.string()),
    news: v.optional(v.boolean()),
    newsletter: v.optional(v.boolean()),
    /** Caller IP from the HTTP layer, or "unknown". */
    ip: v.optional(v.string()),
    /** Set only by the confirmation queue's drain: the per-IP limit and the pool were passed on the first call. */
    fromQueue: v.optional(v.boolean()),
  },
  returns: replyValidator,
  handler: async (ctx, args): Promise<Reply> => {
    const email = args.email.trim().toLowerCase();
    // Shape checks first: free, and a refusal here costs no rate-limit row.
    if (!isPlausibleEmail(email)) return { ok: false, message: "That email address doesn't look right." };
    const receipt = watchableReceipt(args.receipt);
    if (!receipt) return { ok: false, message: RECEIPT_REPLY };
    let dolCaseNumber: string | undefined;
    const typedDol = (args.dolCaseNumber ?? "").trim();
    if (typedDol.length > 0) {
      const parsed = typedDol.length <= 64 ? normaliseFlagCaseNumber(typedDol) : null;
      if (!parsed) return { ok: false, message: DOL_REPLY };
      dolCaseNumber = parsed.caseNumber;
    }

    const ip = args.ip?.trim();
    if (ip && ip !== "unknown" && !args.fromQueue) {
      const perIp = await checkAndRecordRateLimit(ctx, ip, "uscis_subscribe_ip", SUBSCRIBE_IP_LIMIT);
      if (!perIp.allowed) return { ok: false, message: connectionThrottleReply(perIp.resetInMs), throttled: true };
    }

    // Before anything about the address or the receipt is read, so a full beta answers everyone alike.
    if (await betaFull(ctx)) return { ok: false, message: FULL_REPLY, full: true };

    const existing = await ctx.db
      .query("uscisWatches")
      .withIndex("by_email_receipt", (q) => q.eq("email", email).eq("receipt", receipt))
      .first();
    // Already watched: nothing to confirm, and no email. The reply is the one every request gets.
    if (existing?.confirmedAt !== undefined) return { ok: true, message: NEUTRAL_REPLY };

    const forThisAddress = await watchesFor(ctx, email);
    const now = Date.now();
    const lastSent = forThisAddress.reduce<number>((acc, r) => Math.max(acc, r.lastConfirmationSentAt ?? 0), 0);

    // Inside another confirmation's ten minutes: no second email now, and no lost request. The row is staged and
    // owed a confirmation, and ONE follow-up names every such row when the ten minutes end.
    // A row already staged was named by an email, or is owed the follow-up already.
    if (lastSent > 0 && now - lastSent < CONFIRMATION_COOLDOWN_MS) {
      if (!existing && forThisAddress.length < MAX_RECEIPTS_PER_ADDRESS) {
        const scheduled = forThisAddress.some((r) => r.confirmationOwed === true);
        await ctx.db.insert("uscisWatches", {
          email,
          receipt,
          dolCaseNumber,
          createdAt: now,
          source: args.source,
          confirmationOwed: true,
        });
        if (!scheduled) {
          await ctx.scheduler.runAt(lastSent + CONFIRMATION_COOLDOWN_MS, internal.uscisAlerts.followUpConfirmation, { email });
        }
      }
      return { ok: true, message: NEUTRAL_REPLY };
    }

    // Only a new row can pass the address's ceiling. Same reply, so it's no oracle.
    if (!existing && forThisAddress.length >= MAX_RECEIPTS_PER_ADDRESS) {
      log.warn("address at the receipt ceiling; refusing a new watch", { held: forThisAddress.length });
      return { ok: true, message: NEUTRAL_REPLY };
    }

    // Charged before the write: a full pool queues the request before any row or stamp exists.
    if (!args.fromQueue) {
      const budget = await admitConfirmation(ctx, "uscisConfirm");
      if (!budget.allowed) {
        log.warn("receipt confirmation can't send now; queueing");
        return await queueConfirmation(ctx, {
          kind: "uscis",
          pool: "uscisConfirm",
          email,
          args: replayArgs(args),
          resetInMs: budget.resetInMs,
        });
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastConfirmationSentAt: now,
        confirmationOwed: undefined,
        ...(dolCaseNumber ? { dolCaseNumber } : {}),
      });
    } else {
      await ctx.db.insert("uscisWatches", {
        email,
        receipt,
        dolCaseNumber,
        createdAt: now,
        source: args.source,
        lastConfirmationSentAt: now,
      });
    }

    const includesNews = args.news === true;
    if (includesNews) await stageNewsFor(ctx, email, args.source);
    const includesNewsletter = args.newsletter === true;
    if (includesNewsletter) await stageNewsletterFor(ctx, email, args.source);

    await ctx.scheduler.runAfter(0, internal.uscisAlerts.sendConfirmation, {
      email,
      named: [{ receipt, dolCaseNumber: dolCaseNumber ?? existing?.dolCaseNumber }],
      includesNews,
      includesNewsletter,
    });
    return { ok: true, message: NEUTRAL_REPLY };
  },
});

/**
 * The one confirmation for every receipt an address typed inside another confirmation's ten minutes. By then a
 * click on the first email has usually confirmed them (it confirms every staged row), and this sends nothing.
 */
export const followUpConfirmation = internalMutation({
  args: { email: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await watchesFor(ctx, args.email);
    const owed = rows.filter((r) => r.confirmationOwed === true);
    const waiting = owed.filter((r) => r.confirmedAt === undefined);
    for (const r of owed) {
      if (r.confirmedAt !== undefined) await ctx.db.patch(r._id, { confirmationOwed: undefined });
    }
    if (waiting.length === 0) return null;

    const now = Date.now();
    const attempt = args.attempt ?? 0;
    const lastSent = rows.reduce<number>((acc, r) => Math.max(acc, r.lastConfirmationSentAt ?? 0), 0);
    const inCooldown = lastSent > 0 && now - lastSent < CONFIRMATION_COOLDOWN_MS;
    const budget = inCooldown ? null : await admitConfirmation(ctx, "uscisConfirm");
    if (inCooldown || !budget?.allowed) {
      if (attempt + 1 >= FOLLOW_UP_TRIES) {
        for (const r of waiting) await ctx.db.patch(r._id, { confirmationOwed: undefined });
        log.error("a follow-up receipt confirmation gave up; the rows stay staged for a click or a new sign-up", {
          receipts: waiting.length,
        });
        return null;
      }
      const at = inCooldown
        ? lastSent + CONFIRMATION_COOLDOWN_MS
        : now + Math.min(budget?.resetInMs ?? MS_PER_HOUR, MS_PER_HOUR);
      await ctx.scheduler.runAt(at, internal.uscisAlerts.followUpConfirmation, { email: args.email, attempt: attempt + 1 });
      return null;
    }

    for (const r of waiting) await ctx.db.patch(r._id, { confirmationOwed: undefined, lastConfirmationSentAt: now });
    await ctx.scheduler.runAfter(0, internal.uscisAlerts.sendConfirmation, {
      email: args.email,
      named: waiting
        .map((r) => ({ receipt: r.receipt, dolCaseNumber: r.dolCaseNumber }))
        .sort((a, b) => a.receipt.localeCompare(b.receipt)),
    });
    return null;
  },
});

/** A confirmation that didn't go out: free its rows, so typing the receipt again isn't swallowed by the cooldown. */
export const clearConfirmationCooldown = internalMutation({
  args: { email: v.string(), receipts: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const row of await watchesFor(ctx, args.email)) {
      if (args.receipts.includes(row.receipt) && row.confirmedAt === undefined) {
        await ctx.db.patch(row._id, { lastConfirmationSentAt: undefined });
      }
    }
    return null;
  },
});

/**
 * Render a template, or send text only. Imported dynamically: this module also holds the mutation behind an
 * unauthenticated route, which mustn't pay for a React renderer it never uses.
 */
async function renderOrTextOnly(
  ctx: Parameters<typeof recordError>[0],
  where: string,
  build: () => Promise<ReactElement>,
): Promise<string | undefined> {
  try {
    const { render } = await import("@react-email/render");
    return await render(await build());
  } catch (error) {
    log.error("email render failed, sending text only", { where });
    await recordError(ctx, "action", where, error);
    return undefined;
  }
}

/** The double opt-in email: every receipt the click confirms, named, with its office so a typo shows. */
export const sendConfirmation = internalAction({
  args: {
    email: v.string(),
    named: namedValidator,
    includesNews: v.optional(v.boolean()),
    includesNewsletter: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const receipts = args.named.map((n) => n.receipt);
    const free = async () => {
      await ctx.runMutation(internal.uscisAlerts.clearConfirmationCooldown, { email: args.email, receipts });
    };
    try {
      const token = await makeUnsubscribeToken(args.email, unsubscribeSecret(), "uscis-confirm");
      const confirmUrl = actionUrl("/uscis-alert/confirm", token);
      const rows = args.named.map((n) => ({ receipt: n.receipt, office: officeOf(n.receipt), dolCaseNumber: n.dolCaseNumber ?? null }));
      const several = rows.length > 1;
      const includesNews = args.includesNews === true;
      const includesNewsletter = args.includesNewsletter === true;

      const html = await renderOrTextOnly(ctx, "uscisAlerts.sendConfirmation.render", async () => {
        const { UscisAlertConfirm } = await import("../src/emails/UscisAlertConfirm");
        return UscisAlertConfirm({ receipts: rows, confirmUrl, includesNews, includesNewsletter });
      });

      const result = await sendOrQueue(ctx, "uscis-confirmation", getResend(), {
        from: FROM_EMAIL,
        to: args.email,
        subject: several
          ? `Confirm alerts for ${formatInt(rows.length)} USCIS receipts`
          : `Confirm alerts for USCIS receipt ${rows[0]!.receipt}`,
        html,
        text: [
          several
            ? `You asked to be told when USCIS changes the status of ${formatInt(rows.length)} receipts:`
            : "You asked to be told when USCIS changes the status of this receipt:",
          "",
          ...rows.map(
            (r) =>
              `${r.receipt}${r.office ? `, ${r.office}` : ""}${r.dolCaseNumber ? ` (DOL case ${r.dolCaseNumber})` : ""}`,
          ),
          "",
          "Check the letters and digits against your I-797 notice. A typo watches someone else's receipt, or nothing.",
          "",
          "Receipt alerts are a beta. We check each watched receipt with USCIS every 4 hours and after USCIS's overnight",
          "updates, and email you when its status changes. Today's status isn't emailed: you already know it.",
          "",
          "Confirm here:",
          confirmUrl,
          "",
          ...(includesNews ? ["You also asked for occasional product news. The same click confirms that.", ""] : []),
          ...(includesNewsletter ? ["You also asked for the weekly digest. The same click confirms that.", ""] : []),
          "If you didn't ask for this, ignore this message. Nothing further will be sent.",
          "",
          "PERM Tracker",
          `${SITE_URL}/uscis-case-status`,
          TEXT_LEGAL_LINE,
        ].join("\n"),
      });
      // Resend RETURNS its failures; this check is the only thing between a failed send and a silent one.
      if (result.error) {
        await recordError(
          ctx,
          "action",
          "uscisAlerts.sendConfirmation",
          new Error(`Resend: ${result.error.name}: ${result.error.message}`),
        );
        await free();
      }
    } catch (error) {
      await recordError(ctx, "action", "uscisAlerts.sendConfirmation", error);
      await free();
    }
    return null;
  },
});

// ============================================================================
// Confirm and stop (driven by the HTTP routes)
// ============================================================================

/**
 * Confirm every receipt staged for the address a `uscis-confirm` token names. Address-scoped, as the DOL case
 * alerts' confirm is: the click proves the inbox, the same proof for every receipt staged from it.
 *
 * A token never expires and anyone holding the email can replay it, so it is never consent on its own: it confirms
 * only rows a sign-up staged, and a stop deletes the rows, so a replay after a stop finds nothing.
 *
 * A receipt the beta can't take (full, and nobody else watches it) stays staged and is named in `full`; a click
 * after room is made confirms it.
 */
export const confirmByToken = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      email: v.string(),
      receipts: v.array(v.string()),
      /** Nothing was waiting and the address still watches these: an old link clicked again. */
      already: v.optional(v.boolean()),
      /** Staged receipts left unconfirmed because the beta is full. */
      full: v.optional(v.array(v.string())),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const email = await verifyUnsubscribeToken(args.token, unsubscribeSecret(), "uscis-confirm");
    if (!email) return null;
    const rows = await watchesFor(ctx, email);
    const active = rows.filter((r) => r.confirmedAt !== undefined).map((r) => r.receipt);
    const staged = rows.filter((r) => r.confirmedAt === undefined);
    if (staged.length === 0) return active.length > 0 ? { email, receipts: active, already: true } : null;

    const now = Date.now();
    const confirmed: string[] = [];
    const full: string[] = [];
    for (const row of staged) {
      const held = await addWatcher(ctx, row.receipt);
      if (!held) {
        full.push(row.receipt);
        continue;
      }
      await ctx.db.patch(row._id, {
        confirmedAt: now,
        confirmationOwed: undefined,
        // The status the receipt shows now, when the checker has read it, is the baseline: the first email is a change.
        lastAlertedStatus: held.status,
        alertDue: undefined,
      });
      confirmed.push(row.receipt);
    }
    if (confirmed.length === 0) return { email, receipts: [], full };

    await recordConsentAtConfirm(ctx, email);
    // The confirmation email named the news and the digest when they were ticked; the click confirms them too.
    await ctx.runMutation(internal.emailPrefs.confirmNewsForEmail, { email });
    await ctx.runMutation(internal.emailPrefs.confirmNewsletterForEmail, { email });
    return { email, receipts: confirmed, ...(full.length > 0 ? { full } : {}) };
  },
});

/** The one-click stop in every alert: every receipt of the address, deleted. */
export const unsubscribeByToken = internalMutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = await verifyUnsubscribeToken(args.token, unsubscribeSecret(), "uscis-unsubscribe");
    if (!email) return false;
    await deleteWatchesFor(ctx, email);
    return true;
  },
});

// ============================================================================
// The checker's two routes
// ============================================================================

/**
 * Every receipt a confirmed watch holds, for GET /uscis-watched: upper-cased, one each, the first
 * WATCHED_RECEIPTS_CAP by when they joined. Receipt numbers only.
 */
export const watchedReceipts = internalQuery({
  args: {},
  returns: v.object({ receipts: v.array(v.string()), capped: v.boolean() }),
  handler: async (ctx) => {
    const out = new Set<string>();
    let capped = false;
    for await (const row of ctx.db.query("uscisReceipts")) {
      if (row.watchers <= 0) continue;
      if (out.size >= WATCHED_RECEIPTS_CAP) {
        capped = true;
        break;
      }
      out.add(row.receipt.trim().toUpperCase());
    }
    return { receipts: [...out].sort(), capped };
  },
});

/**
 * What the checker found, for POST /uscis-watched/results. Records the newest status per receipt, marks every
 * confirmed watch whose status moved since it last told its person, and schedules one email per address.
 * A receipt nobody watches, and a result older than the one held, are ignored. Returns how many were recorded.
 */
export const recordResults = internalMutation({
  args: {
    results: v.array(
      v.object({
        receipt: v.string(),
        status: v.string(),
        group: uscisGroupValidator,
        form: v.union(v.string(), v.null()),
        checkedAt: v.number(),
      }),
    ),
  },
  returns: v.object({ recorded: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let recorded = 0;
    const owed = new Set<string>();

    for (const r of args.results) {
      // Checked again here: the route checked the shape, and this is the one place a status is written.
      const receipt = watchableReceipt(r.receipt);
      if (!receipt) continue;
      const held = await receiptRow(ctx, receipt);
      if (!held) continue;
      // An older answer than the one held (two runs crossing): the newest stands.
      if (held.checkedAt !== undefined && r.checkedAt < held.checkedAt) continue;
      recorded += 1;

      if (r.group === "none") {
        // USCIS has no case under the number right now. Recorded as when we checked; the last status found stays,
        // and nobody is emailed: a receipt that briefly can't be found is far likelier than a case that vanished.
        await ctx.db.patch(held._id, { checkedAt: r.checkedAt, notFound: true });
        continue;
      }

      const moved = held.status !== r.status;
      const final = isFinalGroup(r.group);
      await ctx.db.patch(held._id, {
        status: r.status,
        group: r.group,
        form: r.form ?? undefined,
        checkedAt: r.checkedAt,
        notFound: undefined,
        ...(moved
          ? { changedAt: r.checkedAt, finalSince: final ? r.checkedAt : undefined }
          : final && held.finalSince === undefined
            ? { finalSince: r.checkedAt }
            : {}),
      });

      // A year after a final status with nothing new, the watches end, as DOL's case alerts do.
      const finalSince = held.finalSince ?? (final ? r.checkedAt : undefined);
      if (!moved && finalSince !== undefined && r.checkedAt - finalSince > WATCH_AFTER_FINAL_MS) {
        await retireReceipt(ctx, receipt);
        continue;
      }

      for (const w of await watchersOf(ctx, receipt)) {
        if (w.lastAlertedStatus === undefined) {
          // The first status found after they confirmed: the baseline, told nothing.
          await ctx.db.patch(w._id, { lastAlertedStatus: r.status, alertDue: undefined });
          continue;
        }
        const due = w.lastAlertedStatus !== r.status;
        if (due !== (w.alertDue === true)) await ctx.db.patch(w._id, { alertDue: due ? true : undefined });
        if (due) owed.add(w.email);
      }
    }

    const meta = await metaRow(ctx);
    if (meta) await ctx.db.patch(meta._id, { lastResultsAt: now });

    // One email per address, a few minutes on, so receipts that moved in the same run share it.
    for (const email of owed) {
      await ctx.scheduler.runAfter(SEND_SETTLE_MS, internal.uscisAlerts.sendForAddress, { email });
    }
    return { recorded };
  },
});

/** The confirmed watches on one receipt. Bounded: past a few hundred watchers, the rest wait for the next check. */
async function watchersOf(ctx: MutationCtx, receipt: string): Promise<Doc<"uscisWatches">[]> {
  const rows = await ctx.db
    .query("uscisWatches")
    .withIndex("by_receipt", (q) => q.eq("receipt", receipt))
    .take(500);
  return rows.filter((w) => w.confirmedAt !== undefined);
}

/** The watches on a receipt decided a year ago with nothing new: each deleted, and the receipt with the last. */
async function retireReceipt(ctx: MutationCtx, receipt: string): Promise<void> {
  for (const w of await watchersOf(ctx, receipt)) {
    // One still owed an email or mid-send keeps going until it's told.
    if (w.alertDue === true || claimHolds(w.sendingAt, Date.now())) continue;
    await deleteWatch(ctx, w);
  }
}

// ============================================================================
// Sending the change emails
// ============================================================================

const itemValidator = v.object({
  id: v.id("uscisWatches"),
  receipt: v.string(),
  fromStatus: v.string(),
  toStatus: v.string(),
  group: v.string(),
  form: v.union(v.string(), v.null()),
  checkedAt: v.number(),
  dolCaseNumber: v.union(v.string(), v.null()),
});

/**
 * Claim every receipt the address is owed an email about, and the alert pool's one unit for that email, before
 * anything is rendered. Null when nothing is owed, another run holds the claim, or the pool is spent; in the last
 * case the watches stay owed and the retry run sends them later, so a full pool never drops one.
 *
 * A claim older than SEND_CLAIM_MS is a run that died: when its email reached the outbox it's recorded as told,
 * otherwise it's taken over.
 */
export const claimDue = internalMutation({
  args: { email: v.string(), retry: v.optional(v.boolean()) },
  returns: v.union(v.object({ ref: v.string(), items: v.array(itemValidator) }), v.null()),
  handler: async (ctx, args) => {
    const now = Date.now();
    const picked: { row: Doc<"uscisWatches">; held: Doc<"uscisReceipts"> }[] = [];
    for (const row of await watchesFor(ctx, args.email)) {
      if (row.confirmedAt === undefined || row.alertDue !== true) continue;
      const held = await receiptRow(ctx, row.receipt);
      if (!held?.status || held.status === row.lastAlertedStatus) {
        await ctx.db.patch(row._id, { alertDue: undefined });
        continue;
      }
      if (claimHolds(row.sendingAt, now)) continue;
      if (row.sendingAt !== undefined && row.sendingRef && (await deliveredSince(ctx, row.sendingRef, row.sendingAt))) {
        // The run that claimed it sent it and died before recording it.
        await stampTold(ctx, row, row.sendingStatus ?? held.status, held.status, now);
        continue;
      }
      if (row.lastAlertedAt !== undefined && now - row.lastAlertedAt < RECEIPT_ALERT_COOLDOWN_MS) continue;
      picked.push({ row, held });
    }
    if (picked.length === 0) return null;

    // The pool's unit, charged before the side effect. Refused, nothing is stamped: the watches stay owed.
    const state = await checkRateLimit(ctx, "all", BUDGETS.uscisAlert.key, windowFor("uscisAlert"));
    if (!state.allowed) {
      if (!args.retry) await noteQueued(ctx, "uscisAlert");
      log.warn("receipt alert pool spent; the email waits for the next run", { receipts: picked.length });
      return null;
    }
    await recordRateLimitAttempt(ctx, "all", BUDGETS.uscisAlert.key);

    const ref = `uscis:${picked[0]!.row._id}`;
    for (const { row, held } of picked) {
      await ctx.db.patch(row._id, { sendingAt: now, sendingStatus: held.status, sendingRef: ref });
    }
    return {
      ref,
      items: picked
        .map(({ row, held }) => ({
          id: row._id,
          receipt: row.receipt,
          fromStatus: row.lastAlertedStatus!,
          toStatus: held.status!,
          group: held.group ?? "other",
          form: held.form ?? null,
          checkedAt: held.checkedAt ?? now,
          dolCaseNumber: row.dolCaseNumber ?? null,
        }))
        .sort((a, b) => a.receipt.localeCompare(b.receipt)),
    };
  },
});

/** A watch told about `told`: owed again only when the receipt has moved on since. */
async function stampTold(
  ctx: MutationCtx,
  row: Doc<"uscisWatches">,
  told: string,
  current: string | undefined,
  now: number,
): Promise<void> {
  await ctx.db.patch(row._id, {
    lastAlertedStatus: told,
    lastAlertedAt: now,
    alertDue: current !== undefined && current !== told ? true : undefined,
    sendingAt: undefined,
    sendingStatus: undefined,
    sendingRef: undefined,
  });
}

/** After a delivery (sent, or kept in the retry queue): each watch told about the status it was sent. */
export const recordSent = internalMutation({
  args: { ids: v.array(v.id("uscisWatches")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row || row.sendingStatus === undefined) continue;
      const held = await receiptRow(ctx, row.receipt);
      await stampTold(ctx, row, row.sendingStatus, held?.status, now);
    }
    return null;
  },
});

/** A claimed send that didn't go: the watches stay owed, free for the next run. */
export const releaseClaims = internalMutation({
  args: { ids: v.array(v.id("uscisWatches")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (row) await ctx.db.patch(id, { sendingAt: undefined, sendingStatus: undefined, sendingRef: undefined });
    }
    return null;
  },
});

/** One email to one address, naming every receipt of it that moved. */
export const sendForAddress = internalAction({
  args: { email: v.string(), retry: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.uscisAlerts.claimDue, { email: args.email, retry: args.retry });
    if (!claim) return null;
    const ids: Id<"uscisWatches">[] = claim.items.map((i) => i.id);
    let delivered = false;
    try {
      const secret = unsubscribeSecret();
      const unsubscribeUrl = actionUrl("/uscis-alert/unsubscribe", await makeUnsubscribeToken(args.email, secret, "uscis-unsubscribe"));
      const prefsUrl = await prefsLink(args.email, secret, "uscis");
      const items = claim.items.map((i) => ({
        receipt: i.receipt,
        form: i.form,
        fromStatus: i.fromStatus,
        toStatus: i.toStatus,
        tone: groupTone(i.group),
        isFinal: isFinalGroup(i.group),
        checkedAt: checkedLabel(i.checkedAt),
        statusUrl: receiptPageUrl(i.receipt),
        blockUrl: receiptBlockUrl(i.receipt),
        dolCaseNumber: i.dolCaseNumber,
        dolCaseUrl: i.dolCaseNumber ? `${SITE_URL}/perm-case-status?case=${encodeURIComponent(i.dolCaseNumber)}` : null,
      }));
      const one = items.length === 1 ? items[0]! : null;

      const html = await renderOrTextOnly(ctx, "uscisAlerts.sendForAddress.render", async () => {
        const { UscisStatusChanged } = await import("../src/emails/UscisStatusChanged");
        return UscisStatusChanged({ items, unsubscribeUrl, prefsUrl });
      });

      const result = await deliverAlert(ctx, {
        email: args.email,
        kind: "uscis",
        ref: claim.ref as `uscis:${string}`,
        subject: one
          ? `USCIS updated ${one.receipt}: ${one.toStatus}`
          : `USCIS updated ${formatInt(items.length)} of your receipts`,
        html,
        listUnsubscribe: unsubscribeUrl,
        summary: {
          title: one ? one.receipt : `${formatInt(items.length)} USCIS receipts`,
          line: one ? `${one.fromStatus} to ${one.toStatus}` : "Each one's status changed since the last check",
          url: items[0]!.statusUrl,
          tone: one ? one.tone : "neutral",
        },
        text: [
          one ? `USCIS changed the status of receipt ${one.receipt}.` : `USCIS changed the status of ${formatInt(items.length)} of your receipts.`,
          "",
          ...items.flatMap((i) => [
            `${i.receipt}${i.form ? ` (${i.form})` : ""}`,
            `Was: ${i.fromStatus}`,
            `Now: ${i.toStatus}`,
            `USCIS showed this when we checked, at ${i.checkedAt}.`,
            ...(i.isFinal ? ["We'll keep watching it for a year in case anything follows, and email you only if it moves."] : []),
            `See it: ${i.statusUrl}`,
            `Its receipt block: ${i.blockUrl}`,
            ...(i.dolCaseUrl ? [`Your PERM case ${i.dolCaseNumber}: ${i.dolCaseUrl}`] : []),
            "",
          ]),
          "USCIS is the authority on every case. Its own page has today's status: https://egov.uscis.gov/casestatus/landing.do",
          "",
          `Email preferences: ${prefsUrl}`,
          `Stop these alerts: ${unsubscribeUrl}`,
          "",
          "PERM Tracker",
          TEXT_LEGAL_LINE,
        ].join("\n"),
      });

      if (result.status === "failed") {
        log.error("receipt alert send failed", { receipts: items.length, error: result.error });
        await recordError(ctx, "action", "uscisAlerts.sendForAddress", new Error(`Resend: ${result.error}`));
        return null;
      }
      // Set before the record: if recordSent throws, the claim lapses and claimDue finds this email in the outbox.
      delivered = true;
      await ctx.runMutation(internal.uscisAlerts.recordSent, { ids });
    } catch (error) {
      await recordError(ctx, "action", "uscisAlerts.sendForAddress", error);
    } finally {
      if (!delivered) {
        await ctx.runMutation(internal.uscisAlerts.releaseClaims, { ids }).catch((e: unknown) => {
          log.error("releasing a receipt send claim failed; it lapses on its own", { error: e });
        });
      }
    }
    return null;
  },
});

/**
 * Every 30 minutes (convex/crons.ts): the addresses still owed an email (the pool was spent, a send failed, or a
 * receipt's one-hour gap held it) get it now. Cheap when nothing is owed: one indexed read.
 */
export const sendDue = internalMutation({
  args: {},
  returns: v.object({ addresses: v.number() }),
  handler: async (ctx) => {
    const emails = new Set<string>();
    for await (const row of ctx.db.query("uscisWatches").withIndex("by_due", (q) => q.eq("alertDue", true))) {
      emails.add(row.email);
      if (emails.size >= RETRY_ADDRESSES) break;
    }
    let i = 0;
    for (const email of emails) {
      // A second apart, so a backlog doesn't arrive at Resend in one burst.
      await ctx.scheduler.runAfter(i * 1000, internal.uscisAlerts.sendForAddress, { email, retry: true });
      i += 1;
    }
    return { addresses: emails.size };
  },
});

/** Sign-ups nobody confirmed in UNCONFIRMED_WATCH_DAYS, deleted. Run each day from convex/retention.ts. */
export const expireUnconfirmed = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const before = (args.now ?? Date.now()) - UNCONFIRMED_WATCH_DAYS * MS_PER_DAY;
    const old = await ctx.db
      .query("uscisWatches")
      .withIndex("by_confirmed_created", (q) => q.eq("confirmedAt", undefined).lt("createdAt", before))
      .take(EXPIRE_BATCH + 1);
    for (const row of old.slice(0, EXPIRE_BATCH)) await deleteWatch(ctx, row);
    // Guarded on progress, so it can never spin.
    if (old.length > EXPIRE_BATCH) await ctx.scheduler.runAfter(0, internal.uscisAlerts.expireUnconfirmed, { now: args.now });
    return { deleted: Math.min(old.length, EXPIRE_BATCH) };
  },
});
