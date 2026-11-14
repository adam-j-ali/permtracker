/**
 * Follow an employer: an email when DOL moves its PERM cases, as a group or case by case.
 *
 * A follow has one of two sizes, chosen on the form and made live by the confirm click (`scope`):
 *
 * - "group" (the default, and every follow from before the choice existed): the employer-wide moves below;
 * - "each": every status change of every one of its cases, for the person who manages them. Read straight from
 *   the event log each sweep (`readCaseMoves`), filtered and worded by src/lib/employerCaseMoves.ts, with a
 *   watermark (`caseToldThrough`) as the change detector. One email a day at most, on days something changed.
 *
 * The census page (`/perm-employers/under-review`) shows where each
 * employer's pending cases stand; this tells a follower when that changes,
 * one employer at a time, from the list of employer-wide moves the daily
 * sweep already writes into `perm_docs['employer_stages']`:
 *
 * - `holdMoves`: a day five or more of the employer's cases went on hold or
 *   came off it;
 * - `decisionMoves`: a day a batch of them was decided, big against both the
 *   employer's queue and its own usual pace.
 *
 * The rules for both live in `scripts/ingest_case_status_direct.py` beside
 * their tests; this module only remembers which moves each follower has been
 * told (`toldMoves`) and mails the rest. Every sentence names who acted: DOL
 * holds, releases, certifies and denies; the employer withdraws. No reason
 * appears, because DOL publishes none.
 *
 * ## Consent and budgets
 *
 * The same grammar as the other three alert kinds: an unauthenticated POST
 * stages a follow, a confirm click makes it live, the token is purpose-scoped
 * (`employer-confirm` / `employer-unsubscribe`), opt-outs are tombstones.
 * The employer's name in every email comes from our own records, looked up
 * by the HTTP route from the slug, never from the form, so nobody can make
 * this send words of their choosing to someone else's inbox.
 *
 * It claims no new line in the Resend arithmetic (convex/caseAlerts.ts):
 * confirmations share the case confirmations' pool, alerts share the case
 * alerts' pool (`convex/lib/alertBudgets.ts`), and every alert leaves through
 * `deliverAlert`, so a follower gets at most one email a day of these and
 * everything else that waits for the daily bundle (a case's own status change
 * goes at once).
 *
 * @module convex/employerAlerts
 */

import type { ReactElement } from "react";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { FROM_EMAIL, getResend, sendOrQueue } from "./lib/email";
import { SITE_URL, actionUrl } from "./lib/links";
import { prefsLink } from "./lib/prefsLink";
import {
  makeUnsubscribeToken,
  verifyUnsubscribeToken,
} from "./lib/unsubscribeToken";
import { one, placeholders, query } from "./lib/publicMirror";
import { recordError } from "./lib/errorRecording";
import {
  checkAndRecordRateLimit,
  checkRateLimit,
  recordRateLimitAttempt,
} from "./lib/rateLimit";
import { stageNewsFor, stageNewsletterFor } from "./lib/newsConsent";
import { createLogger } from "./lib/logging";
import {
  CASE_ALERT_KEY,
  noteRefusal,
  windowFor,
  CONFIRMATION_COOLDOWN_MS,
  SUBSCRIBE_IP_LIMIT,
  SWEEP_RESUME_DELAY_MS,
} from "./lib/alertBudgets";
import { deliverAlert } from "./lib/alertDelivery";
import { scaled } from "./lib/emailAllowance";
import { dropQueued } from "./lib/alertOutboxStore";
import {
  HOLD_STATUS,
  QUEUE_STATUS,
  employerMoves,
  longDate,
  parseEmployerStagesDoc,
  workedLabel,
  type EmployerMove,
  type EmployerStagesDoc,
} from "../src/lib/employerStages";
import {
  BULK_WRITE_ROWS,
  CASE_MOVE_READ_DAYS,
  DIRECT_SOURCE,
  EXPIRY_FROM,
  EXPIRY_TO,
  closingLine,
  filedLabel,
  followPromise,
  followScope,
  groupCaseMoves,
  newestAt,
  realCaseMoves,
  rowsShown,
  unheardCaseMoves,
  type CaseMove,
  type CaseMoveRow,
  type FollowScope,
} from "../src/lib/employerCaseMoves";
import { connectionThrottleReply } from "./lib/throttleReply";
import { admitConfirmation, queueConfirmation, replayArgs } from "./confirmationQueue";
import { MS_PER_DAY, MS_PER_HOUR, easternDay } from "./lib/time";
import { isPlausibleEmail } from "./lib/emailShape";
import { TEXT_LEGAL_LINE } from "./lib/textFooter";

const log = createLogger("EmployerAlerts");

/** Follows one address may hold. A product limit and a read bound. */
export const MAX_EMPLOYERS_PER_ADDRESS = 100;
/** Rows one sweep reads, and alerts one sweep may build. */
const CHECK_BATCH_LIMIT = 300;
const alertBatchLimit = () => scaled(18);
/**
 * A move older than this many days is history, not news, and is never sent.
 * Seven days: the alert pool is shared, so a busy stretch can hold a move for
 * days, and a shorter window would drop it for good.
 */
const FRESH_DAYS = 7;
/** Keys remembered per follow; the doc holds at most 120 days of moves. */
const TOLD_CAP = 200;
const APPEAL_STATUSES = ["RECONSIDERATION APPEALS", "BALCA APPEALS", "REQUEST FOR REVIEW"];

/** Rows one sweep reads from the event log for the "each" follows: far above a real week, so a cut is logged. */
const CASE_MOVE_READ_CAP = 5000;
/** A job title in a case row: enough to recognise the case, never a paragraph. */
const TITLE_MAX = 60;

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

const scopeValidator = v.union(v.literal("group"), v.literal("each"));

const NEUTRAL_REPLY = "Check your inbox to confirm.";

function unsubscribeSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not configured");
  return secret;
}

function employerUrl(slug: string): string {
  return `${SITE_URL}/perm-employers/${slug}`;
}

function caseUrl(caseNumber: string): string {
  return `${SITE_URL}/perm-case-status?case=${encodeURIComponent(caseNumber)}`;
}

/** Shift an ISO date by whole days, no time zone involved. */
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** "Sep 24" for the move rows; the census date takes the long form. */
function shortDate(iso: string): string {
  return longDate(iso).replace(/^(\w{3})\w*/, "$1").replace(/, \d{4}$/, "");
}

// ============================================================================
// Who an employer is, from our own records
// ============================================================================

/**
 * The employer's name for a slug, or null when we hold no such employer.
 *
 * Published employers are in `perm_entities`; ones DOL has not published yet
 * are in `perm_live_only_index`. Both are primary-key reads. Used by the HTTP
 * route BEFORE `subscribe`, so the name in the confirmation email is ours.
 */
export async function employerNameFor(slug: string): Promise<string | null> {
  if (!SLUG_RE.test(slug)) return null;
  const published = await one(
    "SELECT name FROM perm_entities WHERE kind = 'employer' AND slug = ?",
    [slug],
  );
  if (typeof published?.name === "string" && published.name) return published.name;
  const live = await one("SELECT name FROM perm_live_only_index WHERE slug = ?", [slug]);
  return typeof live?.name === "string" && live.name ? live.name : null;
}

// ============================================================================
// Subscribe
// ============================================================================

/** Internal: the only caller is the HTTP route, which verified the name. */
export const subscribe = internalMutation({
  args: {
    email: v.string(),
    slug: v.string(),
    employerName: v.string(),
    source: v.optional(v.string()),
    /** "each" for every case's status change; anything else is the group follow. */
    scope: v.optional(scopeValidator),
    news: v.optional(v.boolean()),
    newsletter: v.optional(v.boolean()),
    ip: v.optional(v.string()),
    /**
     * Set only by the confirmation queue's drain (convex/confirmationQueue.ts)
     * when it replays a request a full pool held back: the per-IP limit was
     * passed on the first call and the drain measured the account's room, so
     * both are skipped. Every per-address check still runs.
     */
    fromQueue: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    message: v.string(),
    throttled: v.optional(v.boolean()),
    /** True when a full pool queued it (convex/confirmationQueue.ts). */
    queued: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!isPlausibleEmail(email)) {
      return { ok: false, message: "That email address doesn't look right." };
    }
    if (!SLUG_RE.test(args.slug)) {
      return { ok: false, message: "We don't know that employer." };
    }

    const ip = args.ip?.trim();
    if (ip && ip !== "unknown" && !args.fromQueue) {
      const perIp = await checkAndRecordRateLimit(ctx, ip, "employer_subscribe_ip", SUBSCRIBE_IP_LIMIT);
      if (!perIp.allowed) return { ok: false, message: connectionThrottleReply(perIp.resetInMs), throttled: true };
    }

    const existing = await ctx.db
      .query("employerAlerts")
      .withIndex("by_email_slug", (q) => q.eq("email", email).eq("slug", args.slug))
      .first();
    const forThisAddress = await ctx.db
      .query("employerAlerts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(MAX_EMPLOYERS_PER_ADDRESS + 1);
    const now = Date.now();
    const lastSent = forThisAddress.reduce((a, r) => Math.max(a, r.lastConfirmationSentAt ?? 0), 0);
    if (lastSent > 0 && now - lastSent < CONFIRMATION_COOLDOWN_MS) {
      // No second email inside the ten minutes, and no lost request: held, and named by one follow-up when they
      // end (`followUpConfirmation`; the reasoning is in convex/caseAlerts.ts, where the same branch lives).
      const followed =
        existing !== null &&
        existing.pendingSlug === undefined &&
        existing.confirmedAt !== undefined &&
        existing.unsubscribedAt === undefined;
      // The same employer at the other size is a change worth holding; the same size again is nothing new.
      const sameAsk = existing !== null && followScope(existing.pendingSlug !== undefined ? existing.pendingScope : existing.scope) === followScope(args.scope);
      const nothingNew = existing !== null && sameAsk && (followed || existing.pendingSlug !== undefined);
      const room = existing !== null || forThisAddress.length < MAX_EMPLOYERS_PER_ADDRESS;
      if (!nothingNew && room) {
        const scheduled = forThisAddress.some((r) => r.confirmationOwed === true);
        const staged = { pendingSlug: args.slug, pendingName: args.employerName, pendingScope: followScope(args.scope), confirmationOwed: true };
        if (existing) await ctx.db.patch(existing._id, staged);
        else await ctx.db.insert("employerAlerts", { email, slug: args.slug, employerName: args.employerName, createdAt: now, source: args.source, ...staged });
        if (!scheduled) {
          await ctx.scheduler.runAt(lastSent + CONFIRMATION_COOLDOWN_MS, internal.employerAlerts.followUpConfirmation, { email });
        }
      }
      return { ok: true, message: NEUTRAL_REPLY };
    }
    if (!existing && forThisAddress.length >= MAX_EMPLOYERS_PER_ADDRESS) {
      return { ok: true, message: NEUTRAL_REPLY };
    }

    // Charged BEFORE the write, so a full pool leaves no stamp for a retry to
    // trip over (see the note in convex/caseAlerts.ts). A full pool
    // queues the request (convex/confirmationQueue.ts).
    if (!args.fromQueue) {
      const budget = await admitConfirmation(ctx, "caseConfirm");
      if (!budget.allowed) {
        log.warn("confirmation can't send now (its pool or the day's count); queueing");
        return queueConfirmation(ctx, {
          kind: "employer",
          pool: "caseConfirm",
          email,
          args: replayArgs(args),
          resetInMs: budget.resetInMs,
        });
      }
    }

    // Staged like the slug: the size a confirmed follower gets changes only on their own click.
    const scope = followScope(args.scope);
    if (existing) {
      await ctx.db.patch(existing._id, {
        pendingSlug: args.slug,
        pendingName: args.employerName,
        pendingScope: scope,
        lastConfirmationSentAt: now,
      });
    } else {
      await ctx.db.insert("employerAlerts", {
        email,
        slug: args.slug,
        employerName: args.employerName,
        pendingSlug: args.slug,
        pendingName: args.employerName,
        pendingScope: scope,
        createdAt: now,
        source: args.source,
        lastConfirmationSentAt: now,
      });
    }

    const includesNews = args.news === true;
    if (includesNews) await stageNewsFor(ctx, email, args.source);
    const includesNewsletter = args.newsletter === true;
    if (includesNewsletter) await stageNewsletterFor(ctx, email, args.source);

    await ctx.scheduler.runAfter(0, internal.employerAlerts.sendConfirmation, {
      email,
      slug: args.slug,
      employerName: args.employerName,
      scope,
      includesNews,
      includesNewsletter,
    });
    return { ok: true, message: NEUTRAL_REPLY };
  },
});

/** Times a follow-up waits for the cooldown or the day's confirmations to free before it gives up. */
const FOLLOW_UP_TRIES = 6;

/**
 * The one confirmation for every employer an address asked to follow inside another confirmation's ten minutes.
 * The twin of `followUpConfirmation` in convex/caseAlerts.ts: nothing when the first email's click already
 * confirmed them, else one charge, one email naming them all, and a bounded wait when the cooldown or the day's
 * confirmations aren't free.
 */
export const followUpConfirmation = internalMutation({
  args: { email: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("employerAlerts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .take(MAX_EMPLOYERS_PER_ADDRESS);
    const owed = rows.filter((r) => r.confirmationOwed === true);
    const waiting = owed.filter((r) => r.pendingSlug !== undefined);
    for (const r of owed) {
      if (r.pendingSlug === undefined) await ctx.db.patch(r._id, { confirmationOwed: undefined });
    }
    if (waiting.length === 0) return null;

    const now = Date.now();
    const attempt = args.attempt ?? 0;
    const lastSent = rows.reduce((a, r) => Math.max(a, r.lastConfirmationSentAt ?? 0), 0);
    const inCooldown = lastSent > 0 && now - lastSent < CONFIRMATION_COOLDOWN_MS;
    const budget = inCooldown ? null : await admitConfirmation(ctx, "caseConfirm");
    if (inCooldown || !budget?.allowed) {
      if (attempt + 1 >= FOLLOW_UP_TRIES) {
        for (const r of waiting) await ctx.db.patch(r._id, { confirmationOwed: undefined });
        log.error("a follow-up confirmation gave up; the follows stay staged for a later click or sign-up", {
          employers: waiting.length,
        });
        return null;
      }
      const at = inCooldown ? lastSent + CONFIRMATION_COOLDOWN_MS : now + Math.min(budget?.resetInMs ?? MS_PER_HOUR, MS_PER_HOUR);
      await ctx.scheduler.runAt(at, internal.employerAlerts.followUpConfirmation, { email: args.email, attempt: attempt + 1 });
      return null;
    }

    for (const r of waiting) {
      await ctx.db.patch(r._id, { confirmationOwed: undefined, lastConfirmationSentAt: now });
    }
    const [first, ...rest] = [...waiting].sort((a, b) => (a.pendingName ?? a.employerName).localeCompare(b.pendingName ?? b.employerName));
    await ctx.scheduler.runAfter(0, internal.employerAlerts.sendConfirmation, {
      email: args.email,
      slug: first!.pendingSlug as string,
      employerName: first!.pendingName ?? first!.employerName,
      scope: followScope(first!.pendingScope),
      also: rest.map((r) => ({
        slug: r.pendingSlug as string,
        name: r.pendingName ?? r.employerName,
        scope: followScope(r.pendingScope),
      })),
    });
    return null;
  },
});

export const clearConfirmationCooldown = internalMutation({
  args: { email: v.string(), slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("employerAlerts")
      .withIndex("by_email_slug", (q) => q.eq("email", args.email).eq("slug", args.slug))
      .first();
    if (row) await ctx.db.patch(row._id, { lastConfirmationSentAt: undefined });
    return null;
  },
});

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

export const sendConfirmation = internalAction({
  args: {
    email: v.string(),
    slug: v.string(),
    employerName: v.string(),
    /** Optional: a confirmation scheduled before the choice existed carries none. */
    scope: v.optional(scopeValidator),
    includesNews: v.optional(v.boolean()),
    includesNewsletter: v.optional(v.boolean()),
    /** Other employers the same click confirms, each named in the email (`followUpConfirmation`). */
    also: v.optional(v.array(v.object({ slug: v.string(), name: v.string(), scope: scopeValidator }))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const also = args.also ?? [];
    /** "Acme Corp (every case)": each of the others, with the size asked for when it's the bigger one. */
    const alsoNames = also.map((e) => (e.scope === "each" ? `${e.name} (every case)` : e.name));
    /** A failed send frees every row this email named, so asking again isn't swallowed. */
    const freeNamed = async () => {
      for (const slug of [args.slug, ...also.map((e) => e.slug)]) {
        await ctx.runMutation(internal.employerAlerts.clearConfirmationCooldown, { email: args.email, slug });
      }
    };
    try {
      const scope = followScope(args.scope);
      const token = await makeUnsubscribeToken(args.email, unsubscribeSecret(), "employer-confirm");
      const confirmUrl = actionUrl("/employer-alert/confirm", token);
      const html = await renderOrTextOnly(ctx, "employerAlerts.sendConfirmation.render", async () => {
        const { EmployerAlertConfirm } = await import("../src/emails/EmployerAlertConfirm");
        return EmployerAlertConfirm({
          employerName: args.employerName,
          confirmUrl,
          scope,
          alsoEmployers: alsoNames,
          includesNews: args.includesNews === true,
          includesNewsletter: args.includesNewsletter === true,
        });
      });
      const result = await sendOrQueue(ctx, "employer-confirmation", getResend(), {
        from: FROM_EMAIL,
        to: args.email,
        subject: `Confirm: follow ${args.employerName} on PERM Tracker`,
        html,
        text: [
          scope === "each"
            ? `You asked to follow ${args.employerName}'s PERM cases, case by case.`
            : `You asked to follow ${args.employerName}'s PERM cases.`,
          "",
          followPromise(scope),
          "",
          ...(alsoNames.length > 0 ? [`The same click also confirms your follow of: ${alsoNames.join(", ")}`, ""] : []),
          "Confirm here:",
          confirmUrl,
          "",
          ...(args.includesNews
            ? ["You also asked for occasional product news. The same click confirms that.", ""]
            : []),
          ...(args.includesNewsletter
            ? ["You also asked for the weekly digest. The same click confirms that.", ""]
            : []),
          "If you didn't ask for this, ignore this message. Nothing further will be sent.",
          "",
          "PERM Tracker",
          employerUrl(args.slug),
          TEXT_LEGAL_LINE,
        ].join("\n"),
      });
      if (result.error) {
        await recordError(
          ctx,
          "action",
          "employerAlerts.sendConfirmation",
          new Error(`Resend: ${result.error.name}: ${result.error.message}`),
        );
        await freeNamed();
      }
    } catch (error) {
      await recordError(ctx, "action", "employerAlerts.sendConfirmation", error);
      await freeNamed();
    }
    return null;
  },
});

// ============================================================================
// Confirm / unsubscribe
// ============================================================================

async function rowsForToken(
  ctx: MutationCtx,
  token: string,
  purpose: "employer-confirm" | "employer-unsubscribe",
): Promise<Doc<"employerAlerts">[]> {
  const email = await verifyUnsubscribeToken(token, unsubscribeSecret(), purpose);
  if (!email) return [];
  return await ctx.db
    .query("employerAlerts")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(MAX_EMPLOYERS_PER_ADDRESS);
}

export const confirmByToken = internalMutation({
  args: { token: v.string() },
  returns: v.union(
    // `already`: nothing was waiting and the address still follows these
    // employers (a repeat click on an old confirmation link). `everyCase`:
    // which of `employers` are followed case by case.
    v.object({
      email: v.string(),
      employers: v.array(v.string()),
      everyCase: v.array(v.string()),
      already: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const all = await rowsForToken(ctx, args.token, "employer-confirm");
    const confirmed: string[] = [];
    const active: string[] = [];
    const everyCase: string[] = [];
    const now = Date.now();
    for (const row of all) {
      // Only a fresh request stages a slug; a replayed link finds nothing to do.
      if (row.pendingSlug === undefined) {
        if (row.confirmedAt !== undefined && row.unsubscribedAt === undefined) {
          active.push(row.employerName);
          if (followScope(row.scope) === "each") everyCase.push(row.employerName);
        }
        continue;
      }
      const moved = row.slug !== row.pendingSlug;
      const scope = followScope(row.pendingScope);
      const name = row.pendingName ?? row.employerName;
      await ctx.db.patch(row._id, {
        confirmedAt: row.confirmedAt ?? now,
        slug: row.pendingSlug,
        employerName: name,
        scope,
        pendingSlug: undefined,
        pendingName: undefined,
        pendingScope: undefined,
        confirmationOwed: undefined,
        unsubscribedAt: undefined,
        followingFrom: easternDay(now),
        // What the page already showed them is not news: case moves count from this click.
        caseToldThrough: now,
        ...(moved || row.unsubscribedAt !== undefined ? { toldMoves: [] } : {}),
      });
      confirmed.push(name);
      if (scope === "each") everyCase.push(name);
    }
    if (confirmed.length === 0) {
      return active.length > 0 ? { email: all[0]!.email, employers: active, everyCase, already: true } : null;
    }
    const email = all[0]!.email;
    // What the page already showed them is not news: mark today's moves told.
    await ctx.scheduler.runAfter(0, internal.employerAlerts.seedTold, { email });
    await ctx.runMutation(internal.emailPrefs.confirmNewsForEmail, { email });
    await ctx.runMutation(internal.emailPrefs.confirmNewsletterForEmail, { email });
    return { email, employers: confirmed, everyCase: everyCase.filter((n) => confirmed.includes(n)) };
  },
});

/**
 * What a confirm link would make live, for the page that asks before it acts: the sizes staged for the token's
 * address. Reads only; the GET that shows the page must not change anything.
 */
export const pendingForToken = internalQuery({
  args: { token: v.string() },
  returns: v.array(scopeValidator),
  handler: async (ctx, args) => {
    const email = await verifyUnsubscribeToken(args.token, unsubscribeSecret(), "employer-confirm");
    if (!email) return [];
    const rows = await ctx.db
      .query("employerAlerts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(MAX_EMPLOYERS_PER_ADDRESS);
    return rows.filter((r) => r.pendingSlug !== undefined).map((r) => followScope(r.pendingScope));
  },
});

export const unsubscribeByToken = internalMutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const all = await rowsForToken(ctx, args.token, "employer-unsubscribe");
    if (all.length === 0) return false;
    const now = Date.now();
    for (const row of all) {
      if (row.unsubscribedAt !== undefined && row.pendingSlug === undefined) continue;
      await ctx.db.patch(row._id, {
        unsubscribedAt: now,
        pendingSlug: undefined,
        pendingName: undefined,
        pendingScope: undefined,
        confirmationOwed: undefined,
      });
    }
    await dropQueued(ctx, all[0]!.email, "employer");
    return true;
  },
});

// ============================================================================
// The census doc
// ============================================================================

async function readDoc(): Promise<EmployerStagesDoc | null> {
  const row = await one("SELECT json, computed_at FROM perm_docs WHERE key = ?", ["employer_stages"]);
  if (!row || typeof row.json !== "string") return null;
  return parseEmployerStagesDoc(row.json, Number(row.computed_at), Date.now());
}

/** The moves still news on `today`: dated inside the freshness window. */
export function freshMoves(doc: EmployerStagesDoc, today: string): Map<string, EmployerMove[]> {
  const floor = isoMinusDays(today, FRESH_DAYS);
  const bySlug = new Map<string, EmployerMove[]>();
  for (const m of employerMoves(doc)) {
    if (!m.slug || m.date < floor) continue;
    const list = bySlug.get(m.slug);
    if (list) list.push(m);
    else bySlug.set(m.slug, [m]);
  }
  return bySlug;
}

/** Which of an employer's fresh moves this follower has not heard. */
export function unheard(
  moves: EmployerMove[] | undefined,
  told: readonly string[] | undefined,
  followingFrom: string | undefined,
): EmployerMove[] {
  const heard = new Set(told ?? []);
  return (moves ?? []).filter((m) => !heard.has(m.key) && (!followingFrom || m.date >= followingFrom));
}

export const forSeeding = internalQuery({
  args: { email: v.string() },
  returns: v.array(v.object({ _id: v.id("employerAlerts"), slug: v.string(), toldMoves: v.optional(v.array(v.string())) })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("employerAlerts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .take(MAX_EMPLOYERS_PER_ADDRESS);
    return rows
      .filter((r) => r.confirmedAt !== undefined && r.unsubscribedAt === undefined)
      .map((r) => ({ _id: r._id, slug: r.slug, toldMoves: r.toldMoves }));
  },
});

export const recordTold = internalMutation({
  args: {
    id: v.id("employerAlerts"),
    keys: v.array(v.string()),
    sent: v.boolean(),
    /** An "each" follow's new watermark: the newest case move this email carried. Never moves backwards. */
    caseToldThrough: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const merged = [...new Set([...(row.toldMoves ?? []), ...args.keys])].slice(-TOLD_CAP);
    const now = Date.now();
    await ctx.db.patch(args.id, {
      toldMoves: merged,
      lastCheckedAt: now,
      ...(args.caseToldThrough !== undefined
        ? { caseToldThrough: Math.max(row.caseToldThrough ?? 0, args.caseToldThrough) }
        : {}),
      ...(args.sent ? { lastAlertSentAt: now, alertCount: (row.alertCount ?? 0) + 1 } : {}),
    });
    return null;
  },
});

/** Mark every current move told for a newly confirmed follow. */
export const seedTold = internalAction({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const doc = await readDoc();
      if (!doc) return null;
      const all = employerMoves(doc);
      for (const row of await ctx.runQuery(internal.employerAlerts.forSeeding, { email: args.email })) {
        const keys = all.filter((m) => m.slug === row.slug).map((m) => m.key);
        if (keys.length > 0) {
          await ctx.runMutation(internal.employerAlerts.recordTold, { id: row._id, keys, sent: false });
        }
      }
    } catch (error) {
      // `followingFrom` still keeps older moves out, so this degrades safely.
      await recordError(ctx, "action", "employerAlerts.seedTold", error);
    }
    return null;
  },
});

// ============================================================================
// The sweep
// ============================================================================

export const dueForCheck = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      _id: v.id("employerAlerts"),
      email: v.string(),
      slug: v.string(),
      employerName: v.string(),
      toldMoves: v.optional(v.array(v.string())),
      followingFrom: v.optional(v.string()),
      scope: scopeValidator,
      caseToldThrough: v.optional(v.number()),
      confirmedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const out: {
      _id: Id<"employerAlerts">;
      email: string;
      slug: string;
      employerName: string;
      toldMoves?: string[];
      followingFrom?: string;
      scope: FollowScope;
      caseToldThrough?: number;
      confirmedAt: number;
    }[] = [];
    for await (const row of ctx.db
      .query("employerAlerts")
      .withIndex("by_alert_sweep", (q) => q.eq("unsubscribedAt", undefined))) {
      if (!row.confirmedAt) continue;
      out.push({
        _id: row._id,
        email: row.email,
        slug: row.slug,
        employerName: row.employerName,
        toldMoves: row.toldMoves,
        followingFrom: row.followingFrom,
        scope: followScope(row.scope),
        caseToldThrough: row.caseToldThrough,
        confirmedAt: row.confirmedAt,
      });
      if (out.length >= args.limit) break;
    }
    return out;
  },
});

export const markChecked = internalMutation({
  args: { ids: v.array(v.id("employerAlerts")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) await ctx.db.patch(id, { lastCheckedAt: now });
    return null;
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

/** "Adobe Inc.: DOL put 215 of its cases on hold", inside an inbox line. */
export function employerSubject(name: string, moves: readonly { sentence: string }[]): string {
  const first = moves[0];
  if (!first) return `${name}: its PERM cases moved`;
  const lead = `${name}: ${first.sentence}`;
  if (moves.length === 1 && lead.length <= 78) return lead;
  const more = `${lead}, and ${moves.length - 1} more`;
  if (moves.length > 1 && more.length <= 78) return more;
  return `${name}: ${moves.length === 1 ? "a change" : `${moves.length} changes`} to its PERM cases`.slice(0, 78);
}

/** Today's pending mix for one employer, from the census row, or null. */
function mixFor(doc: EmployerStagesDoc, slug: string) {
  const row = doc.employers.find((e) => e.slug === slug);
  if (!row) return null;
  const queue = row.byStatus[QUEUE_STATUS] ?? 0;
  const appeal = APPEAL_STATUSES.reduce((a, s) => a + (row.byStatus[s] ?? 0), 0);
  return {
    pending: row.pending,
    queue,
    appeal,
    review: row.pending - queue - appeal,
    held: row.byStatus[HOLD_STATUS] ?? 0,
  };
}

// ============================================================================
// Case by case: the "each" follow's read
// ============================================================================

type Tone = "good" | "bad" | "neutral";
/** A case under a move, as the email prints it. */
interface CaseLine {
  number: string;
  url: string;
  /** "Software Engineer, filed Mar 2025", or "" when DOL's record has neither. */
  note: string;
}
/** One line of an alert. An "each" follow's line carries the cases under it. */
interface AlertRow {
  dateLabel: string;
  sentence: string;
  tone: Tone;
  cases?: CaseLine[];
  /** Cases the line counts and doesn't list. */
  more?: number;
}

/**
 * The followed employers' case moves over the read window, by slug.
 *
 * Two statements in one round trip, both riding `case_events_recent`: the timestamps that are a catch-up write
 * (normally none), and every DOL-direct event in the window joined to its case and its employer's page. The second
 * is driven by the window, about 600 events a day once the lapsed certifications are left out, with three
 * primary-key probes each, and returns only the followed employers' rows (0.3 s over eight days, Nov 13 2026). The slug join is the sweep's own (`_slug_join` in ingest_case_status_direct.py).
 */
async function readCaseMoves(slugs: string[], now: number): Promise<Map<string, CaseMove[]>> {
  const marks = placeholders(slugs.length);
  if (!marks) return new Map();
  const since = now - CASE_MOVE_READ_DAYS * MS_PER_DAY;
  const [bulk, moved] = await query([
    {
      sql: "SELECT changed_at AS at FROM perm_case_events WHERE changed_at >= ? GROUP BY changed_at HAVING COUNT(*) > ?",
      args: [since, BULK_WRITE_ROWS],
    },
    {
      sql: `SELECT COALESCE(l.employer_slug, p.employer_slug) AS slug, e.case_number AS case_number,
                   e.changed_at AS at, e.from_status AS f, e.to_status AS t,
                   c.filing_date AS filed, c.job_title AS title
              FROM perm_case_events e
              JOIN perm_case_status c ON c.case_number = e.case_number
              LEFT JOIN perm_live_recent l ON l.case_number = e.case_number
              LEFT JOIN perm_cases p ON p.case_number = e.case_number
             WHERE e.changed_at >= ? AND e.source = ?
               AND NOT (e.from_status = ? AND e.to_status = ?)
               AND COALESCE(l.employer_slug, p.employer_slug) IN (${marks})
             ORDER BY e.changed_at DESC LIMIT ${CASE_MOVE_READ_CAP}`,
      args: [since, DIRECT_SOURCE, EXPIRY_FROM, EXPIRY_TO, ...slugs],
    },
  ]);
  const rows = moved ?? [];
  if (rows.length >= CASE_MOVE_READ_CAP) {
    log.warn("the case-move read reached its cap; the oldest moves in the window were left out", {
      cap: CASE_MOVE_READ_CAP,
    });
  }
  const text = (v: string | number | null | undefined) => (typeof v === "string" ? v : "");
  const parsed: CaseMoveRow[] = rows.map((r) => ({
    slug: text(r.slug),
    caseNumber: text(r.case_number),
    at: Number(r.at),
    from: text(r.f),
    to: text(r.t),
    filed: text(r.filed) || null,
    jobTitle: text(r.title).trim() || null,
  }));
  const bulkStamps = new Set((bulk ?? []).map((r) => Number(r.at)));
  const bySlug = new Map<string, CaseMove[]>();
  for (const m of realCaseMoves(parsed, bulkStamps)) {
    if (!Number.isFinite(m.at)) continue;
    const list = bySlug.get(m.slug);
    if (list) list.push(m);
    else bySlug.set(m.slug, [m]);
  }
  return bySlug;
}

/** A follower's unheard case moves as alert lines: one per day and kind of change, its cases beneath it. */
export function caseAlertRows(news: readonly CaseMove[]): AlertRow[] {
  const groups = groupCaseMoves(news);
  const shown = rowsShown(groups);
  return groups.map((g, i) => {
    const take = shown[i] ?? 0;
    return {
      dateLabel: shortDate(g.worked),
      sentence: g.sentence,
      tone: g.tone,
      cases: g.cases.slice(0, take).map((c) => ({
        number: c.caseNumber,
        url: caseUrl(c.caseNumber),
        note: [c.jobTitle ? c.jobTitle.slice(0, TITLE_MAX) : "", filedLabel(c.filed)].filter(Boolean).join(", "),
      })),
      more: g.n - take,
    };
  });
}

/** The plain-text lines for one alert line and the cases under it. */
function rowText(r: AlertRow): string[] {
  return [
    `  Recorded ${r.dateLabel}: ${r.sentence}.`,
    ...(r.cases ?? []).map((c) => `    ${c.number}${c.note ? ` (${c.note})` : ""}`),
    ...(r.more && r.more > 0 ? [`    and ${r.more.toLocaleString("en-US")} more, listed on its page`] : []),
  ];
}

// ============================================================================
// The sweep
// ============================================================================

/**
 * Tell each follower what they have not heard: the employer-wide moves for a group follow, every case's change
 * for an "each" follow.
 *
 * Runs after the daily sweeps have written the census (see crons.ts). Reads
 * up to CHECK_BATCH_LIMIT follows least-recently-checked first, bumps every
 * one it looked at, builds at most ALERT_BATCH_LIMIT alerts under the shared
 * daily budget, and hands each to `deliverAlert`. A failed send leaves the
 * moves unheard so the next run tries again; a queued or sent one is told.
 *
 * A failed read of the event log is recorded and sends nothing: the "each" follows keep their watermarks, so the
 * next run asks for the same window, and the group follows still go.
 */
export const sweep = internalAction({
  args: {},
  returns: v.object({ checked: v.number(), sent: v.number(), queued: v.number(), failed: v.number() }),
  handler: async (ctx): Promise<{ checked: number; sent: number; queued: number; failed: number }> => {
    const doc = await readDoc().catch(async (error: unknown) => {
      await recordError(ctx, "action", "employerAlerts.sweep.read", error);
      return null;
    });
    if (!doc) return { checked: 0, sent: 0, queued: 0, failed: 0 };

    const due = await ctx.runQuery(internal.employerAlerts.dueForCheck, { limit: CHECK_BATCH_LIMIT + 1 });
    const batch = due.slice(0, CHECK_BATCH_LIMIT);
    let remaining = due.length > CHECK_BATCH_LIMIT;
    if (batch.length === 0) return { checked: 0, sent: 0, queued: 0, failed: 0 };

    const now = Date.now();
    const today = easternDay(now);
    const moves = freshMoves(doc, today);
    const eachSlugs = [...new Set(batch.filter((b) => b.scope === "each").map((b) => b.slug))];
    // A failed read sends nothing and moves no watermark, so the next run asks for the same window again.
    const caseMoves = await readCaseMoves(eachSlugs, now).catch(async (error: unknown) => {
      await recordError(ctx, "action", "employerAlerts.sweep.caseMoves", error);
      return new Map<string, CaseMove[]>();
    });

    type Due = (typeof batch)[number];
    const notices: { sub: Due; rows: AlertRow[]; keys: string[]; through?: number }[] = [];
    for (const sub of batch) {
      if (sub.scope === "each") {
        const news = unheardCaseMoves(caseMoves.get(sub.slug), sub.caseToldThrough, sub.confirmedAt, now);
        if (news.length > 0) notices.push({ sub, rows: caseAlertRows(news), keys: [], through: newestAt(news) });
        continue;
      }
      const news = unheard(moves.get(sub.slug), sub.toldMoves, sub.followingFrom);
      if (news.length > 0) {
        notices.push({
          sub,
          // The day DOL worked, never the day the sweep recorded it (the 4 AM pass records the evening before's work).
          rows: news.map((m) => ({ dateLabel: workedLabel(m.worked, shortDate), sentence: m.sentence, tone: m.tone })),
          keys: news.map((m) => m.key),
        });
      }
    }
    // When the day's pool runs short, an employer-wide move goes before one case's change. The sort is stable, so
    // each size keeps its least-recently-checked order.
    notices.sort((a, b) => Number(a.sub.scope === "each") - Number(b.sub.scope === "each"));

    await ctx.runMutation(internal.employerAlerts.markChecked, { ids: batch.map((b) => b._id) });
    if (notices.length === 0) return { checked: batch.length, sent: 0, queued: 0, failed: 0 };

    const granted = await ctx.runMutation(internal.employerAlerts.claimAlertBudget, {
      want: Math.min(notices.length, alertBatchLimit()),
    });
    if (granted < notices.length) remaining = true;
    if (granted === 0) {
      log.error("alert budget exhausted; employer alerts wait", { due: notices.length });
      return { checked: batch.length, sent: 0, queued: 0, failed: 0 };
    }

    let sent = 0;
    let queued = 0;
    let failed = 0;
    const asOf = longDate(doc.asOf);
    for (const { sub, rows, keys, through } of notices.slice(0, granted)) {
      try {
        const token = await makeUnsubscribeToken(sub.email, unsubscribeSecret(), "employer-unsubscribe");
        const unsubUrl = actionUrl("/employer-alert/unsubscribe", token);
        const prefsUrl = await prefsLink(sub.email, unsubscribeSecret(), `employer:${sub._id}`);
        const url = employerUrl(sub.slug);
        const mix = mixFor(doc, sub.slug);
        const closing = closingLine(sub.scope, asOf, mix !== null);
        const first = rows[0]!;
        const html = await renderOrTextOnly(ctx, "employerAlerts.sweep.render", async () => {
          const { EmployerMoved } = await import("../src/emails/EmployerMoved");
          return EmployerMoved({
            employerName: sub.employerName,
            employerUrl: url,
            moves: rows,
            mix,
            asOf,
            scope: sub.scope,
            unsubscribeUrl: unsubUrl,
            prefsUrl,
          });
        });
        const result = await deliverAlert(ctx, {
          email: sub.email,
          kind: "employer",
          ref: `employer:${sub._id}`,
          subject: employerSubject(sub.employerName, rows),
          html,
          text: [
            `${sub.employerName}, an employer you follow on PERM Tracker:`,
            "",
            ...rows.flatMap(rowText),
            "",
            ...(mix
              ? [
                  `Its ${mix.pending.toLocaleString("en-US")} pending cases today: ${mix.held.toLocaleString("en-US")} on hold, ${mix.appeal.toLocaleString("en-US")} under appeal, ${mix.queue.toLocaleString("en-US")} waiting for an analyst.`,
                  "",
                ]
              : []),
            closing,
            "",
            `Every figure for ${sub.employerName}: ${url}`,
            "",
            `Stop employer alerts: ${unsubUrl}`,
            "",
            "PERM Tracker",
            TEXT_LEGAL_LINE,
          ].join("\n"),
          listUnsubscribe: unsubUrl,
          summary: {
            title: sub.employerName,
            line: rows.length === 1 ? first.sentence : `${first.sentence}, and ${rows.length - 1} more`,
            url,
            tone: first.tone,
          },
        });
        if (result.status === "failed") {
          failed += 1;
          await recordError(ctx, "action", "employerAlerts.sweep", new Error(`Resend: ${result.error}`));
          continue;
        }
        await ctx.runMutation(internal.employerAlerts.recordTold, {
          id: sub._id,
          keys,
          sent: true,
          ...(through !== undefined ? { caseToldThrough: through } : {}),
        });
        if (result.status === "sent") sent += 1;
        else queued += 1;
      } catch (error) {
        failed += 1;
        await recordError(ctx, "action", "employerAlerts.sweep", error);
      }
    }

    if (remaining && sent + queued > 0) {
      await ctx.scheduler.runAfter(SWEEP_RESUME_DELAY_MS, internal.employerAlerts.sweep, {});
    }
    return { checked: batch.length, sent, queued, failed };
  },
});
