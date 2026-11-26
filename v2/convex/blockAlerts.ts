/**
 * Following a USCIS receipt block by email (Nov 26 2026): someone who asked about a block in a group, or who reads
 * its page, hears when there's news about it, once each:
 *
 *   - "every": the block's last number has been checked (its card then counts every case);
 *   - "m25", "m50", "m75": the approved share of the form they follow passed a quarter, a half, three quarters;
 *   - "week:<Monday>": the first update of a Monday sums up the week (approvals, denials, evidence requests).
 *
 * The sign-up is double opt-in, exactly as an employer follow is (convex/employerAlerts.ts, whose guards this copies):
 * the unauthenticated POST writes an unconfirmed row and sends one email, and only the confirm page's POST makes it
 * live. The figures come from the server: after each USCIS sample load it posts every block's counts to
 * POST /block-update (convex/http.ts), and `recordUpdate` keeps the newest snapshot and the Monday's, and schedules
 * the sends.
 *
 * Confirmations draw from the case pools ("caseConfirm"), the alerts from "caseAlert", like employer follows: this
 * claims no new line in the ledger (convex/caseAlerts.ts). What the page already showed at the confirming click is
 * never news: the keys it had already earned are marked told then.
 */
import { v } from "convex/values";

import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { FROM_EMAIL, getResend, sendOrQueue } from "./lib/email";
import { recordConsentAtConfirm } from "./lib/policyConsentStore";
import { SITE_URL, actionUrl } from "./lib/links";
import { prefsLink } from "./lib/prefsLink";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./lib/unsubscribeToken";
import { recordError } from "./lib/errorRecording";
import { checkAndRecordRateLimit, checkRateLimit, recordRateLimitAttempt } from "./lib/rateLimit";
import { createLogger } from "./lib/logging";
import { CASE_ALERT_KEY, CONFIRMATION_COOLDOWN_MS, SUBSCRIBE_IP_LIMIT, noteRefusal, windowFor } from "./lib/alertBudgets";
import { deliverAlert } from "./lib/alertDelivery";
import { dropQueued } from "./lib/alertOutboxStore";
import { connectionThrottleReply } from "./lib/throttleReply";
import { admitConfirmation, queueConfirmation, replayArgs } from "./confirmationQueue";
import { MS_PER_HOUR, easternDay } from "./lib/time";
import { isPlausibleEmail } from "./lib/emailShape";
import { TEXT_LEGAL_LINE } from "./lib/textFooter";
import { BLOCK_RE, FORM_RE, type BlockCounts } from "./lib/blockUpdate";

const log = createLogger("BlockAlerts");

export const MAX_BLOCKS_PER_ADDRESS = 50;
/** Follows read for one block's send, at most. */
const FOLLOWS_PER_BLOCK = 2000;
const TOLD_CAP = 100;
const FOLLOW_UP_TRIES = 6;
const NEUTRAL_REPLY = "Check your inbox to confirm.";
export const MILESTONES = [25, 50, 75] as const;

const countsValidator = v.object({
  total: v.number(),
  approved: v.number(),
  denied: v.number(),
  rfe: v.number(),
  waiting: v.number(),
});

function unsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not configured");
  return secret;
}

export function blockUrl(block: string, form?: string): string {
  return `${SITE_URL}/uscis-receipt-blocks/${block}${form ? `#form=${form}` : ""}`;
}

/** The counts a follow reads: its form's, or every form's added up. */
export function countsFor(byForm: Record<string, BlockCounts>, form: string | undefined): BlockCounts | null {
  if (form) return byForm[form] ?? null;
  const all = Object.values(byForm);
  if (!all.length) return null;
  return all.reduce((a, c) => ({
    total: a.total + c.total,
    approved: a.approved + c.approved,
    denied: a.denied + c.denied,
    rfe: a.rfe + c.rfe,
    waiting: a.waiting + c.waiting,
  }));
}

const share = (c: BlockCounts) => (c.total > 0 ? (100 * c.approved) / c.total : 0);

/**
 * The news one follow has earned from a block's snapshot and hasn't been told: its keys, newest state only. A week's
 * summary is due only when the snapshot carries a baseline from the Monday before.
 */
export function dueKeys(
  snap: { every: boolean; byForm: Record<string, BlockCounts>; weekOf?: string; weekByForm?: Record<string, BlockCounts> },
  form: string | undefined,
  told: readonly string[],
  monday: string | null,
): string[] {
  const has = new Set(told);
  const key = form ?? "all";
  const now = countsFor(snap.byForm, form);
  const out: string[] = [];
  if (snap.every && !has.has("every")) out.push("every");
  if (now && now.total > 0) {
    for (const m of MILESTONES) if (share(now) >= m && !has.has(`m${m}:${key}`)) out.push(`m${m}:${key}`);
  }
  if (monday && snap.weekOf === monday && snap.weekByForm && !has.has(`week:${monday}`)) out.push(`week:${monday}`);
  return out;
}

/** Everything a follow has already earned, marked told at its confirming click: what the page showed isn't news. */
export function earnedKeys(snap: { every: boolean; byForm: Record<string, BlockCounts> } | null, form: string | undefined): string[] {
  if (!snap) return [];
  return dueKeys(snap, form, [], null);
}

/** The news's lines and its subject, in plain words. */
export function blockNews(
  block: string,
  form: string | undefined,
  keys: readonly string[],
  snap: { byForm: Record<string, BlockCounts>; weekByForm?: Record<string, BlockCounts> },
): { subject: string; lines: string[] } {
  const now = countsFor(snap.byForm, form);
  const cases = form ? `${form} cases` : "cases";
  const lines: string[] = [];
  let subject = `${block}: news about the block you follow`;
  const n = (x: number) => x.toLocaleString("en-US");
  const pct = (c: BlockCounts) => `${Math.round(share(c))}%`;
  if (keys.includes("every") && now) {
    subject = `${block}: every number checked`;
    lines.push(`All 100,000 receipt numbers in ${block} have now been checked: ${n(now.total)} ${cases}, ${pct(now)} approved.`);
  }
  const top = [...keys].filter((k) => /^m\d/.test(k)).sort((a, b) => Number(a.slice(1).split(":")[0]) - Number(b.slice(1).split(":")[0])).pop();
  if (top && now) {
    const m = top.slice(1).split(":")[0];
    if (!keys.includes("every")) subject = `${block} passed ${m}% approved`;
    lines.push(`${pct(now)} of the block's ${cases} are approved now (${n(now.approved)} of ${n(now.total)}), past ${m}%.`);
  }
  const week = keys.find((k) => k.startsWith("week:"));
  const base = week && snap.weekByForm ? countsFor(snap.weekByForm, form) : null;
  if (week && now && base) {
    const more = Math.max(0, now.approved - base.approved);
    if (!keys.includes("every") && !top) subject = `${block} this week: ${n(more)} more approved`;
    lines.push(
      `This week: ${n(more)} more approved, ${n(Math.max(0, now.denied - base.denied))} more denied, ${n(now.rfe)} evidence requests open, ${n(now.waiting)} still waiting.`,
    );
  }
  return { subject: subject.slice(0, 78), lines };
}

/** The next things to read for the form a reader follows: never back to PERM for someone past it. */
export function nextSteps(form: string | undefined): { label: string; href: string }[] {
  const own = { label: "Watch your own receipt number", href: `${SITE_URL}/uscis-case-status` };
  if (form === "I-765") return [own, { label: "How long a work permit takes, and its automatic extension", href: `${SITE_URL}/tools/ead-extension` }];
  if (form === "I-485")
    return [own, { label: "From the I-485 interview to the green card", href: `${SITE_URL}/guides/i485-interview-to-green-card` }];
  return [own, { label: "USCIS processing times by form", href: `${SITE_URL}/uscis-processing-times` }];
}

// ============================================================================
// Sign up
// ============================================================================

export const subscribe = internalMutation({
  args: {
    email: v.string(),
    block: v.string(),
    form: v.optional(v.string()),
    source: v.optional(v.string()),
    ip: v.optional(v.string()),
    /** Set only by the confirmation queue's drain, which already passed the per-IP limit and the pool's room. */
    fromQueue: v.optional(v.boolean()),
  },
  returns: v.object({ ok: v.boolean(), message: v.string(), throttled: v.optional(v.boolean()), queued: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!isPlausibleEmail(email)) return { ok: false, message: "That email address doesn't look right." };
    if (!BLOCK_RE.test(args.block)) return { ok: false, message: "That isn't a receipt block." };
    const form = args.form && FORM_RE.test(args.form) ? args.form : undefined;

    const ip = args.ip?.trim();
    if (ip && ip !== "unknown" && !args.fromQueue) {
      const perIp = await checkAndRecordRateLimit(ctx, ip, "block_subscribe_ip", SUBSCRIBE_IP_LIMIT);
      if (!perIp.allowed) return { ok: false, message: connectionThrottleReply(perIp.resetInMs), throttled: true };
    }
    const existing = await ctx.db
      .query("blockAlerts")
      .withIndex("by_email_block", (q) => q.eq("email", email).eq("block", args.block))
      .first();
    const forThisAddress = await ctx.db
      .query("blockAlerts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(MAX_BLOCKS_PER_ADDRESS + 1);
    const now = Date.now();
    const lastSent = forThisAddress.reduce((a, r) => Math.max(a, r.lastConfirmationSentAt ?? 0), 0);
    if (lastSent > 0 && now - lastSent < CONFIRMATION_COOLDOWN_MS) {
      const followed = existing !== null && existing.pendingBlock === undefined && existing.confirmedAt !== undefined && existing.unsubscribedAt === undefined;
      const sameAsk = existing !== null && (existing.pendingBlock !== undefined ? existing.pendingForm : existing.form) === form;
      const nothingNew = existing !== null && sameAsk && (followed || existing.pendingBlock !== undefined);
      const room = existing !== null || forThisAddress.length < MAX_BLOCKS_PER_ADDRESS;
      if (!nothingNew && room) {
        const scheduled = forThisAddress.some((r) => r.confirmationOwed === true);
        const staged = { pendingBlock: args.block, pendingForm: form, confirmationOwed: true };
        if (existing) await ctx.db.patch(existing._id, staged);
        else await ctx.db.insert("blockAlerts", { email, block: args.block, createdAt: now, source: args.source, ...staged });
        if (!scheduled) await ctx.scheduler.runAt(lastSent + CONFIRMATION_COOLDOWN_MS, internal.blockAlerts.followUpConfirmation, { email });
      }
      return { ok: true, message: NEUTRAL_REPLY };
    }
    if (!existing && forThisAddress.length >= MAX_BLOCKS_PER_ADDRESS) return { ok: true, message: NEUTRAL_REPLY };

    // Charged BEFORE the write, so a full pool leaves no stamp for a retry to trip over (convex/caseAlerts.ts).
    if (!args.fromQueue) {
      const budget = await admitConfirmation(ctx, "caseConfirm");
      if (!budget.allowed) {
        log.warn("confirmation can't send now (its pool or the day's count); queueing");
        return queueConfirmation(ctx, { kind: "block", pool: "caseConfirm", email, args: replayArgs(args), resetInMs: budget.resetInMs });
      }
    }
    if (existing) {
      await ctx.db.patch(existing._id, { pendingBlock: args.block, pendingForm: form, lastConfirmationSentAt: now });
    } else {
      await ctx.db.insert("blockAlerts", {
        email,
        block: args.block,
        form,
        pendingBlock: args.block,
        pendingForm: form,
        createdAt: now,
        source: args.source,
        lastConfirmationSentAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.blockAlerts.sendConfirmation, { email, block: args.block, form });
    return { ok: true, message: NEUTRAL_REPLY };
  },
});

/** One confirmation for every block an address asked to follow inside another confirmation's ten minutes. */
export const followUpConfirmation = internalMutation({
  args: { email: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("blockAlerts").withIndex("by_email", (q) => q.eq("email", args.email)).take(MAX_BLOCKS_PER_ADDRESS);
    const owed = rows.filter((r) => r.confirmationOwed === true);
    const waiting = owed.filter((r) => r.pendingBlock !== undefined);
    for (const r of owed) if (r.pendingBlock === undefined) await ctx.db.patch(r._id, { confirmationOwed: undefined });
    if (waiting.length === 0) return null;
    const now = Date.now();
    const attempt = args.attempt ?? 0;
    const lastSent = rows.reduce((a, r) => Math.max(a, r.lastConfirmationSentAt ?? 0), 0);
    const inCooldown = lastSent > 0 && now - lastSent < CONFIRMATION_COOLDOWN_MS;
    const budget = inCooldown ? null : await admitConfirmation(ctx, "caseConfirm");
    if (inCooldown || !budget?.allowed) {
      if (attempt + 1 >= FOLLOW_UP_TRIES) {
        for (const r of waiting) await ctx.db.patch(r._id, { confirmationOwed: undefined });
        log.error("a follow-up confirmation gave up; the follows stay staged for a later click or sign-up", { blocks: waiting.length });
        return null;
      }
      const at = inCooldown ? lastSent + CONFIRMATION_COOLDOWN_MS : now + Math.min(budget?.resetInMs ?? MS_PER_HOUR, MS_PER_HOUR);
      await ctx.scheduler.runAt(at, internal.blockAlerts.followUpConfirmation, { email: args.email, attempt: attempt + 1 });
      return null;
    }
    for (const r of waiting) await ctx.db.patch(r._id, { confirmationOwed: undefined, lastConfirmationSentAt: now });
    const [first, ...rest] = [...waiting].sort((a, b) => (a.pendingBlock as string).localeCompare(b.pendingBlock as string));
    await ctx.scheduler.runAfter(0, internal.blockAlerts.sendConfirmation, {
      email: args.email,
      block: first!.pendingBlock as string,
      form: first!.pendingForm,
      also: rest.map((r) => r.pendingBlock as string),
    });
    return null;
  },
});

export const clearConfirmationCooldown = internalMutation({
  args: { email: v.string(), block: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("blockAlerts")
      .withIndex("by_email_block", (q) => q.eq("email", args.email).eq("block", args.block))
      .first();
    if (row) await ctx.db.patch(row._id, { lastConfirmationSentAt: undefined });
    return null;
  },
});

export const sendConfirmation = internalAction({
  args: { email: v.string(), block: v.string(), form: v.optional(v.string()), also: v.optional(v.array(v.string())) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const also = args.also ?? [];
    const freeNamed = async () => {
      for (const block of [args.block, ...also]) await ctx.runMutation(internal.blockAlerts.clearConfirmationCooldown, { email: args.email, block });
    };
    try {
      const token = await makeUnsubscribeToken(args.email, unsubscribeSecret(), "block-confirm");
      const confirmUrl = actionUrl("/block-alert/confirm", token);
      const what = args.form ? `its ${args.form} cases` : "its cases";
      const result = await sendOrQueue(ctx, "block-confirmation", getResend(), {
        from: FROM_EMAIL,
        to: args.email,
        subject: `Confirm: follow block ${args.block} on PERM Tracker`,
        text: [
          `You asked to follow USCIS receipt block ${args.block} on PERM Tracker (${what}).`,
          "",
          "We'll email you when every number in the block has been checked, when the share approved passes a quarter, a half and three quarters, and once a week with what moved.",
          "",
          ...(also.length > 0 ? [`The same click also confirms your follow of: ${also.join(", ")}`, ""] : []),
          "Confirm here:",
          confirmUrl,
          "",
          "If you didn't ask for this, ignore this message. Nothing further will be sent.",
          "",
          "PERM Tracker",
          blockUrl(args.block, args.form),
          TEXT_LEGAL_LINE,
        ].join("\n"),
      });
      if (result.error) {
        await recordError(ctx, "action", "blockAlerts.sendConfirmation", new Error(`Resend: ${result.error.name}: ${result.error.message}`));
        await freeNamed();
      }
    } catch (error) {
      await recordError(ctx, "action", "blockAlerts.sendConfirmation", error);
      await freeNamed();
    }
    return null;
  },
});

// ============================================================================
// Confirm / stop
// ============================================================================

async function rowsForToken(ctx: MutationCtx, token: string, purpose: "block-confirm" | "block-unsubscribe"): Promise<Doc<"blockAlerts">[]> {
  const email = await verifyUnsubscribeToken(token, unsubscribeSecret(), purpose);
  if (!email) return [];
  return await ctx.db.query("blockAlerts").withIndex("by_email", (q) => q.eq("email", email)).take(MAX_BLOCKS_PER_ADDRESS);
}

export const confirmByToken = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.object({ email: v.string(), blocks: v.array(v.string()), already: v.optional(v.boolean()) }), v.null()),
  handler: async (ctx, args) => {
    const all = await rowsForToken(ctx, args.token, "block-confirm");
    const confirmed: string[] = [];
    const active: string[] = [];
    const now = Date.now();
    for (const row of all) {
      if (row.pendingBlock === undefined) {
        if (row.confirmedAt !== undefined && row.unsubscribedAt === undefined) active.push(row.block);
        continue;
      }
      const snap = await ctx.db.query("blockSnapshots").withIndex("by_block", (q) => q.eq("block", row.pendingBlock as string)).first();
      await ctx.db.patch(row._id, {
        confirmedAt: row.confirmedAt ?? now,
        block: row.pendingBlock,
        form: row.pendingForm,
        pendingBlock: undefined,
        pendingForm: undefined,
        confirmationOwed: undefined,
        unsubscribedAt: undefined,
        followingFrom: easternDay(now),
        toldKeys: earnedKeys(snap, row.pendingForm),
      });
      await recordConsentAtConfirm(ctx, row.email);
      confirmed.push(row.pendingBlock as string);
    }
    if (confirmed.length === 0) return active.length > 0 ? { email: all[0]!.email, blocks: active, already: true } : null;
    return { email: all[0]!.email, blocks: confirmed };
  },
});

/** What a confirm link would make live, for the page that asks before it acts. Reads only. */
export const pendingForToken = internalQuery({
  args: { token: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const email = await verifyUnsubscribeToken(args.token, unsubscribeSecret(), "block-confirm");
    if (!email) return [];
    const rows = await ctx.db.query("blockAlerts").withIndex("by_email", (q) => q.eq("email", email)).take(MAX_BLOCKS_PER_ADDRESS);
    return rows.filter((r) => r.pendingBlock !== undefined).map((r) => r.pendingBlock as string);
  },
});

export const unsubscribeByToken = internalMutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const all = await rowsForToken(ctx, args.token, "block-unsubscribe");
    if (all.length === 0) return false;
    const now = Date.now();
    for (const row of all) {
      if (row.unsubscribedAt !== undefined && row.pendingBlock === undefined) continue;
      await ctx.db.patch(row._id, { unsubscribedAt: now, pendingBlock: undefined, pendingForm: undefined, confirmationOwed: undefined });
    }
    await dropQueued(ctx, all[0]!.email, "block");
    return true;
  },
});

// ============================================================================
// The server's counts, and the sends they set off
// ============================================================================

const isLive = (r: Doc<"blockAlerts">) => r.confirmedAt !== undefined && r.unsubscribedAt === undefined && r.pendingBlock === undefined;

/**
 * Every block's counts after a USCIS sample load (POST /block-update): the newest kept, the Monday's kept as the week's
 * baseline, and a send scheduled for each block someone follows.
 */
export const recordUpdate = internalMutation({
  args: {
    asOf: v.string(),
    blocks: v.array(v.object({ block: v.string(), every: v.boolean(), checked: v.number(), byForm: v.record(v.string(), countsValidator) })),
  },
  returns: v.object({ stored: v.number(), scheduled: v.number() }),
  handler: async (ctx, args) => {
    const today = easternDay(Date.now());
    const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1 ? today : null;
    let stored = 0;
    let scheduled = 0;
    for (const b of args.blocks) {
      if (!BLOCK_RE.test(b.block)) continue;
      const snap = await ctx.db.query("blockSnapshots").withIndex("by_block", (q) => q.eq("block", b.block)).first();
      const week =
        monday && snap?.weekOf !== monday
          ? { weekOf: monday, weekByForm: snap?.byForm ?? b.byForm }
          : { weekOf: snap?.weekOf, weekByForm: snap?.weekByForm };
      const row = { block: b.block, asOf: args.asOf, every: b.every, checked: b.checked, byForm: b.byForm, ...week };
      if (snap) await ctx.db.patch(snap._id, row);
      else await ctx.db.insert("blockSnapshots", row);
      stored++;
      const rows = await ctx.db.query("blockAlerts").withIndex("by_block", (q) => q.eq("block", b.block)).take(FOLLOWS_PER_BLOCK);
      if (rows.some(isLive)) {
        await ctx.scheduler.runAfter(0, internal.blockAlerts.sendForBlock, { block: b.block, monday: monday ?? undefined });
        scheduled++;
      }
    }
    return { stored, scheduled };
  },
});

export const followsForBlock = internalQuery({
  args: { block: v.string() },
  returns: v.object({
    snap: v.union(
      v.null(),
      v.object({
        every: v.boolean(),
        byForm: v.record(v.string(), countsValidator),
        weekOf: v.optional(v.string()),
        weekByForm: v.optional(v.record(v.string(), countsValidator)),
      }),
    ),
    follows: v.array(v.object({ id: v.id("blockAlerts"), email: v.string(), form: v.optional(v.string()), told: v.array(v.string()) })),
  }),
  handler: async (ctx, args) => {
    const s = await ctx.db.query("blockSnapshots").withIndex("by_block", (q) => q.eq("block", args.block)).first();
    const rows = await ctx.db.query("blockAlerts").withIndex("by_block", (q) => q.eq("block", args.block)).take(FOLLOWS_PER_BLOCK);
    return {
      snap: s ? { every: s.every, byForm: s.byForm, weekOf: s.weekOf, weekByForm: s.weekByForm } : null,
      follows: rows.filter(isLive).map((r) => ({ id: r._id, email: r.email, form: r.form, told: r.toldKeys ?? [] })),
    };
  },
});

export const claimAlertBudget = internalMutation({
  args: { want: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (args.want <= 0) return 0;
    const state = await checkRateLimit(ctx, "all", CASE_ALERT_KEY, windowFor("caseAlert"));
    if (!state.allowed) {
      await noteRefusal(ctx, "caseAlert", args.want);
      return 0;
    }
    const granted = Math.min(args.want, state.remaining + 1);
    await noteRefusal(ctx, "caseAlert", args.want - granted);
    for (let i = 0; i < granted; i++) await recordRateLimitAttempt(ctx, "all", CASE_ALERT_KEY);
    return granted;
  },
});

export const recordTold = internalMutation({
  args: { id: v.id("blockAlerts"), keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const told = [...(row.toldKeys ?? []), ...args.keys].slice(-TOLD_CAP);
    await ctx.db.patch(args.id, { toldKeys: told, lastAlertSentAt: Date.now(), alertCount: (row.alertCount ?? 0) + 1 });
    return null;
  },
});

/** Each follow of one block: the news it has earned and not been told, in one email, budget claimed first. */
export const sendForBlock = internalAction({
  args: { block: v.string(), monday: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { snap, follows } = await ctx.runQuery(internal.blockAlerts.followsForBlock, { block: args.block });
    if (!snap) return 0;
    let sent = 0;
    for (const f of follows) {
      const keys = dueKeys(snap, f.form, f.told, args.monday ?? null);
      if (keys.length === 0) continue;
      const granted = await ctx.runMutation(internal.blockAlerts.claimAlertBudget, { want: 1 });
      if (granted < 1) break;
      const news = blockNews(args.block, f.form, keys, snap);
      const stop = actionUrl("/block-alert/unsubscribe", await makeUnsubscribeToken(f.email, unsubscribeSecret(), "block-unsubscribe"));
      const prefsUrl = await prefsLink(f.email, unsubscribeSecret(), `block:${f.id}`);
      const result = await deliverAlert(ctx, {
        email: f.email,
        kind: "block",
        ref: `block:${f.id}:${keys.join(",")}`,
        subject: news.subject,
        text: [
          `${args.block}, a USCIS receipt block you follow on PERM Tracker:`,
          "",
          ...news.lines,
          "",
          `See every case in the block: ${blockUrl(args.block, f.form)}`,
          "",
          "Next:",
          ...nextSteps(f.form).map((s) => `${s.label}: ${s.href}`),
          "",
          `Stop following ${args.block}: ${stop}`,
          `All your email settings: ${prefsUrl}`,
          TEXT_LEGAL_LINE,
        ].join("\n"),
        listUnsubscribe: stop,
        summary: { title: args.block, line: news.lines[0] ?? news.subject, url: blockUrl(args.block, f.form), tone: "neutral" },
      });
      if (result.status === "sent" || result.status === "queued") {
        await ctx.runMutation(internal.blockAlerts.recordTold, { id: f.id, keys });
        sent++;
      }
    }
    return sent;
  },
});
