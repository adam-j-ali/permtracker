import { v, type Infer } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getSecurityAlertEmail, requireAdmin } from "./lib/admin";
import {
  BOARD_OPENS_AT,
  CASE_STOPS,
  CATEGORIES,
  COUNTRIES,
  DATE_FIELDS,
  DECLINE_REASONS,
  MIN_CASE_REPORTERS,
  OFFICE_LIST_OPENS_AT,
  OFFICE_METRIC_IDS,
  PERM_CASE,
  computeMetrics,
  isPermCategory,
  isShown,
  reviewFlags,
  summarizeRfes,
  toBoardRow,
  toOfficeRow,
  validateTimeline,
  type TimelineRecord,
  whoIsWaiting,
} from "./lib/communityTimeline";
import { getResend } from "./lib/email";
import { recordError } from "./lib/errorRecording";
import { SITE_URL } from "./lib/links";
import { createLogger } from "./lib/logging";
import { sendOwnerMail } from "./lib/ownerMail";
import { query as mirrorQuery } from "./lib/publicMirror";
import { checkAndRecordRateLimit } from "./lib/rateLimit";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "./lib/time";
import { officeByCode } from "../src/lib/uscisOffices";

/**
 * Community timelines: a person's dates after PERM, with DOL's own PERM dates
 * beside them. Rules and field lists: `convex/lib/communityTimeline.ts`.
 *
 * ONE STORE. A timeline saved on a case's page, on a USCIS office's page or on
 * the timelines page is one row here, found by the edit key its browser holds.
 * A PERM case number is optional: a case with none (EB-1, a waiver) has none.
 *
 * REVIEWED BEFORE IT SHOWS. A new timeline is `pending` until the owner
 * approves it (Admin > Timelines). Every public read (`board`, `office`,
 * `caseSummary`) counts approved rows only, through `isShown`. The author's
 * own browser reads the row back at once, with its status. An edit to an
 * approved timeline stays approved and is put in front of the owner
 * (`editedAt`); an edit to a declined one goes back to waiting. The owner is
 * told at most once a day, and each decision refreshes the pages that show it.
 *
 * Public endpoint checklist (the routes are in convex/http.ts): every write is
 * an internal mutation behind an HTTP action that narrows the body and hashes
 * the address; cheap shape checks run before any limit is charged; the caps
 * per case and per address are READ before anything is charged, so a refused
 * request leaves no trace; the per-address limit raises the cost of naive
 * abuse and the global daily budget bounds the table whatever addresses
 * rotate; GET never mutates. No field is free text, so nothing a stranger
 * types can reach a page except a date or a choice from a fixed list.
 */

const log = createLogger("CommunityTimelines");

/** Twenty saves an hour from one address, edits included. */
export const PER_IP = { limit: 20, windowMs: MS_PER_HOUR };
/**
 * A thousand new timelines a day across everyone: the cap on the table's
 * growth, kept well inside the board's SCAN_CAP.
 */
export const GLOBAL_BUDGET = { limit: 1000, windowMs: MS_PER_DAY };
/** At most three timelines on one case from one address (a household, not a flood). */
const PER_CASE_PER_IP = 3;
/** And at most three with no case number from one address. */
const NO_CASE_PER_IP = 3;
/** The board's scan bound. A table past this has outgrown a single read. */
const SCAN_CAP = 5_000;
/** Rows the public board lists, newest first. */
const BOARD_ROWS = 200;
/** Rows read for one case: its timelines, or its legacy milestone reports. */
const PER_CASE_READ = 500;
/** Rows read for one USCIS office, newest first, and the most its list prints. */
const PER_OFFICE_READ = 1_000;
const OFFICE_ROWS = 100;
/** Rows the admin page reads for each of its lists. */
const ADMIN_READ = 100;
/** The owner hears that timelines wait at most once a day. */
const NOTICE_LIMIT = { limit: 1, windowMs: MS_PER_DAY };

const HEX64 = /^[0-9a-f]{64}$/;

const statusV = v.union(v.literal("pending"), v.literal("approved"), v.literal("declined"));
const declineReasonV = v.union(v.literal("implausible"), v.literal("duplicate"), v.literal("spam"));

const timelineInput = v.object({
  category: v.optional(v.union(v.string(), v.null())),
  country: v.optional(v.union(v.string(), v.null())),
  route: v.optional(v.union(v.string(), v.null())),
  premium: v.optional(v.union(v.boolean(), v.null())),
  i140Center: v.optional(v.union(v.string(), v.null())),
  fieldOffice: v.optional(v.union(v.string(), v.null())),
  i140FiledOn: v.optional(v.union(v.string(), v.null())),
  i140ApprovedOn: v.optional(v.union(v.string(), v.null())),
  i485FiledOn: v.optional(v.union(v.string(), v.null())),
  biometricsOn: v.optional(v.union(v.string(), v.null())),
  eadOn: v.optional(v.union(v.string(), v.null())),
  apOn: v.optional(v.union(v.string(), v.null())),
  interviewOn: v.optional(v.union(v.string(), v.null())),
  greenCardOn: v.optional(v.union(v.string(), v.null())),
  rfeForm: v.optional(v.union(v.string(), v.null())),
  rfeReason: v.optional(v.union(v.string(), v.null())),
  rfeIssuedOn: v.optional(v.union(v.string(), v.null())),
  rfeRespondedOn: v.optional(v.union(v.string(), v.null())),
  rfeOutcome: v.optional(v.union(v.string(), v.null())),
  public: v.optional(v.union(v.boolean(), v.null())),
});

/** The wire shape of a submission, for the HTTP layer that builds one. */
export type TimelineWire = Infer<typeof timelineInput>;

const saveResult = v.object({
  ok: v.boolean(),
  message: v.string(),
  throttled: v.optional(v.boolean()),
  /** Where the saved timeline stands with the owner, so the form can say it's waiting. */
  status: v.optional(statusV),
});

/** What a new timeline's author is told: saved, and shown once it's been looked at. */
export const SAVED_WAITING = "Your timeline is saved. It shows on the site once we've checked it, usually within a day.";

/** A typed case number as stored, `undefined` for none, `null` for one that isn't a PERM number. */
function readCase(raw: string | undefined): string | undefined | null {
  const c = (raw ?? "").trim().toUpperCase();
  if (c === "") return undefined;
  return c.length <= 24 && PERM_CASE.test(c) ? c : null;
}

/** The self-reported fields of a row, every one written so an edit can clear it. */
const FIELD_KEYS = [
  "category", "country", "route", "premium", "i140Center", "fieldOffice",
  "i140FiledOn", "i140ApprovedOn", "i485FiledOn", "biometricsOn", "eadOn", "apOn", "interviewOn", "greenCardOn",
  "rfeForm", "rfeReason", "rfeIssuedOn", "rfeRespondedOn", "rfeOutcome",
] as const;

/** A row from before reviews existed has no status until `backfillStatus` runs; it was public then, so it reads as approved. */
const statusOf = (r: Doc<"communityTimelines">) => r.status ?? "approved";

/** The row an edit key opens. One key, one row. */
async function rowForKey(ctx: QueryCtx, editKeyHash: string): Promise<Doc<"communityTimelines"> | null> {
  return await ctx.db
    .query("communityTimelines")
    .withIndex("by_editKeyHash", (q) => q.eq("editKeyHash", editKeyHash))
    .first();
}

/** Tell the owner timelines wait: one email a day at most, charged before it's scheduled. */
async function noteWaiting(ctx: MutationCtx): Promise<void> {
  const notice = await checkAndRecordRateLimit(ctx, "admin", "timeline_notice", NOTICE_LIMIT);
  if (notice.allowed) await ctx.scheduler.runAfter(0, internal.communityTimelines.notifyOwner, {});
}

/** Refresh the pages that show a timeline: the board, and each office named. */
async function refresh(ctx: MutationCtx, ...offices: (string | undefined)[]): Promise<void> {
  const codes = [...new Set(offices.filter((o): o is string => typeof o === "string"))];
  await ctx.scheduler.runAfter(0, internal.communityTimelines.refreshPages, { offices: codes });
}

export const save = internalMutation({
  args: {
    caseNumber: v.optional(v.string()),
    editKeyHash: v.string(),
    ipHash: v.string(),
    input: timelineInput,
  },
  returns: saveResult,
  handler: async (ctx, a) => {
    // Cheap shape checks first, before anything is read, charged or written.
    const caseNumber = readCase(a.caseNumber);
    if (caseNumber === null) return { ok: false, message: "That isn't a PERM case number. Leave the box empty if the case has none." };
    if (!HEX64.test(a.editKeyHash) || !HEX64.test(a.ipHash)) return { ok: false, message: "Malformed request." };
    const checked = validateTimeline(a.input);
    if (!checked.ok) return { ok: false, message: checked.message };
    const fields = checked.value;
    if (caseNumber !== undefined && fields.category !== undefined && !isPermCategory(fields.category)) {
      const label = CATEGORIES.find((c) => c.id === fields.category)?.label ?? "That category";
      return { ok: false, message: `${label} has no PERM case. Leave the case number out, or pick the case's category.` };
    }

    const now = Date.now();
    const existing = await rowForKey(ctx, a.editKeyHash);
    const takesCase = caseNumber !== undefined && existing?.caseNumber !== caseNumber;

    // READ the caps before charging anything, so a refusal here leaves no
    // stamp on the address's limit or the global budget.
    if (takesCase) {
      const onCase = await ctx.db
        .query("communityTimelines")
        .withIndex("by_case_ip", (q) => q.eq("caseNumber", caseNumber).eq("ipHash", a.ipHash))
        .take(PER_CASE_PER_IP);
      if (onCase.length >= PER_CASE_PER_IP) {
        return { ok: false, throttled: true, message: `This case already has ${PER_CASE_PER_IP} timelines from this connection, which is the most one connection can add for a case.` };
      }
    }
    if (!existing && caseNumber === undefined) {
      const bare = await ctx.db
        .query("communityTimelines")
        .withIndex("by_case_ip", (q) => q.eq("caseNumber", undefined).eq("ipHash", a.ipHash))
        .take(NO_CASE_PER_IP);
      if (bare.length >= NO_CASE_PER_IP) {
        return { ok: false, throttled: true, message: `This connection has already added ${NO_CASE_PER_IP} timelines with no case number, which is the most it can add.` };
      }
    }

    const perIp = await checkAndRecordRateLimit(ctx, a.ipHash, "timeline-save", PER_IP);
    if (!perIp.allowed) {
      return { ok: false, throttled: true, message: "That's enough saves for one hour. Try again later." };
    }

    // Every field is written, including the ones the person cleared, so an
    // edit that removes a date really removes it. Patching a field to
    // undefined deletes it, which is exactly what a cleared field means.
    const patch: Record<string, unknown> = { public: fields.public, updatedAt: now };
    for (const k of FIELD_KEYS) patch[k] = fields[k];

    if (existing) {
      const was = statusOf(existing);
      if (existing.caseNumber !== caseNumber) {
        // DOL's dates belong to the case they were read for.
        Object.assign(patch, {
          caseNumber,
          permFiledOn: undefined,
          permCertifiedOn: undefined,
          permCertifiedSource: undefined,
          permCheckedAt: undefined,
        });
      }
      // A declined timeline that changed gets a second look. An approved one stays up, marked for the owner.
      if (was === "declined") Object.assign(patch, { status: "pending", reviewedAt: undefined, declineReason: undefined });
      if (was === "approved") patch.editedAt = now;
      await ctx.db.patch(existing._id, patch as Partial<Doc<"communityTimelines">>);
      if (takesCase) await ctx.scheduler.runAfter(0, internal.communityTimelines.verifyCase, { caseNumber });
      if (was !== "pending") await noteWaiting(ctx);
      if (was === "approved" && existing.hiddenAt === undefined) await refresh(ctx, existing.fieldOffice, fields.fieldOffice);
      const status = was === "declined" ? "pending" : was;
      return {
        ok: true,
        status,
        message: status === "approved" ? "Your timeline was updated." : "Your timeline was updated. It shows on the site once we've checked it.",
      };
    }

    const budget = await checkAndRecordRateLimit(ctx, "all", "timeline-save-global", GLOBAL_BUDGET);
    if (!budget.allowed) {
      return { ok: false, throttled: true, message: "New timelines are paused for today. Try again tomorrow." };
    }
    // An insert carries only the fields that have a value.
    const present = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    await ctx.db.insert("communityTimelines", {
      ...(present as Partial<Doc<"communityTimelines">>),
      ...(caseNumber !== undefined ? { caseNumber } : {}),
      editKeyHash: a.editKeyHash,
      ipHash: a.ipHash,
      public: fields.public,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    // DOL's PERM dates for the case, read once now; the daily sweep retries
    // a case DOL has not certified yet.
    if (caseNumber !== undefined) await ctx.scheduler.runAfter(0, internal.communityTimelines.verifyCase, { caseNumber });
    await noteWaiting(ctx);
    return { ok: true, status: "pending" as const, message: SAVED_WAITING };
  },
});

export const remove = internalMutation({
  args: { caseNumber: v.optional(v.string()), editKeyHash: v.string() },
  returns: saveResult,
  handler: async (ctx, a) => {
    const caseNumber = readCase(a.caseNumber);
    if (caseNumber === null || !HEX64.test(a.editKeyHash)) return { ok: false, message: "Malformed request." };
    const row = await rowForKey(ctx, a.editKeyHash);
    // A case's page removes only that case's timeline.
    if (!row || (caseNumber !== undefined && row.caseNumber !== caseNumber)) {
      return { ok: false, message: caseNumber !== undefined ? "There's no timeline from this browser on this case." : "There's no timeline from this browser." };
    }
    await ctx.db.delete(row._id);
    if (isShown(row)) await refresh(ctx, row.fieldOffice);
    return { ok: true, message: "Your timeline was removed." };
  },
});

const mineResult = v.union(
  v.null(),
  v.object({
    input: timelineInput,
    caseNumber: v.union(v.string(), v.null()),
    status: statusV,
    permFiledOn: v.union(v.string(), v.null()),
    permCertifiedOn: v.union(v.string(), v.null()),
  }),
);

/**
 * The caller's own row, found by the edit key its browser holds. With a case
 * number (a case's page) it answers only for that case; without one it's the
 * key's row whatever case it names.
 */
export const mine = internalQuery({
  args: { caseNumber: v.optional(v.string()), editKeyHash: v.string() },
  returns: mineResult,
  handler: async (ctx, a) => {
    const caseNumber = readCase(a.caseNumber);
    if (caseNumber === null || !HEX64.test(a.editKeyHash)) return null;
    const row = await rowForKey(ctx, a.editKeyHash);
    if (!row || (caseNumber !== undefined && row.caseNumber !== caseNumber)) return null;
    const input: Record<string, unknown> = { public: row.public };
    for (const k of FIELD_KEYS) if (row[k] !== undefined) input[k] = row[k];
    return {
      input: input as Infer<typeof timelineInput>,
      caseNumber: row.caseNumber ?? null,
      status: statusOf(row),
      permFiledOn: row.permFiledOn ?? null,
      permCertifiedOn: row.permCertifiedOn ?? null,
    };
  },
});

/** The legacy milestone kinds, mapped onto the timeline's stops. */
const LEGACY_STOP: Record<string, string> = {
  "i140-filed": "i140FiledOn",
  "i140-approved": "i140ApprovedOn",
  "i485-filed": "i485FiledOn",
  "i485-approved": "greenCardOn",
};

const summaryResult = v.object({
  caseNumber: v.string(),
  timelines: v.number(),
  stops: v.array(v.object({ id: v.string(), label: v.string(), verified: v.boolean(), count: v.number() })),
  /** True when fewer than MIN_CASE_REPORTERS have added dates: every count is then 0. */
  withheld: v.boolean(),
});

/** The three-person floor lives with the pure rules, so the consulate reports read the same number. */
export { MIN_CASE_REPORTERS };

/**
 * What people have reported for ONE case: counts per stop, nothing personal.
 * Legacy single-milestone reports count toward their stop.
 */
export const caseSummary = internalQuery({
  args: { caseNumber: v.string() },
  returns: summaryResult,
  handler: async (ctx, a) => {
    const caseNumber = readCase(a.caseNumber) ?? a.caseNumber.trim().toUpperCase().slice(0, 24);
    const valid = PERM_CASE.test(caseNumber);
    const rows = valid
      ? (await ctx.db
          .query("communityTimelines")
          .withIndex("by_case", (q) => q.eq("caseNumber", caseNumber))
          .take(PER_CASE_READ)).filter(shows)
      : [];
    const legacy = valid
      ? await ctx.db
          .query("caseMilestones")
          .withIndex("by_case", (q) => q.eq("caseNumber", caseNumber))
          .take(PER_CASE_READ)
      : [];
    // People, not rows: one address is one person, whether it saved timelines,
    // older single reports or both. Counting rows let one connection post two
    // timelines and read the real applicant's progress off the counts.
    const reporters = new Set([...rows.map((r) => r.ipHash), ...legacy.map((m) => m.ipHash)]).size;
    const withheld = reporters < MIN_CASE_REPORTERS;
    const stops = CASE_STOPS.filter((s) => !s.verified).map((s) => ({
      id: s.id as string,
      label: s.label as string,
      verified: false,
      count: withheld
        ? 0
        : rows.filter((r) => (r as unknown as Record<string, unknown>)[s.id] !== undefined).length +
          legacy.filter((m) => LEGACY_STOP[m.kind] === s.id).length,
    }));
    return { caseNumber, timelines: withheld ? 0 : rows.length, stops, withheld };
  },
});

/** A stored row as the pure helpers read it. */
function asRecord(r: Doc<"communityTimelines">): TimelineRecord {
  return r as unknown as TimelineRecord;
}

/** Approved and not hidden, a legacy row counting as approved. The one gate on every public read. */
const shows = (r: Doc<"communityTimelines">) => isShown({ status: statusOf(r), hiddenAt: r.hiddenAt });

const metricV = v.object({
  id: v.string(),
  label: v.string(),
  verified: v.boolean(),
  n: v.number(),
  median: v.union(v.number(), v.null()),
  p25: v.union(v.number(), v.null()),
  p75: v.union(v.number(), v.null()),
});
const countV = v.object({ id: v.string(), label: v.string(), count: v.number() });
const boardRowV = v.object({
  filedMonth: v.union(v.string(), v.null()),
  category: v.union(v.string(), v.null()),
  country: v.union(v.string(), v.null()),
  route: v.union(v.string(), v.null()),
  premium: v.union(v.boolean(), v.null()),
  stops: v.array(v.object({ id: v.string(), day: v.union(v.number(), v.null()), month: v.union(v.string(), v.null()) })),
  permVerified: v.boolean(),
  rfe: v.union(
    v.null(),
    v.object({ form: v.string(), reason: v.union(v.string(), v.null()), outcome: v.union(v.string(), v.null()) }),
  ),
  office: v.union(v.string(), v.null()),
  updatedMonth: v.string(),
});

/**
 * The public board. PUBLIC on purpose: it returns only what the page prints.
 * No case number, no employer, no exact PERM date, no hash leaves this query.
 * Only approved timelines count. Medians use every one of them (the form says
 * so before saving); the listed rows are only the ones whose owners ticked
 * "show on the board", and only once there are enough of them that no single
 * row stands out. A row names its USCIS office only when that office's own
 * list is open.
 */
export const board = query({
  args: {},
  returns: v.object({
    total: v.number(),
    shared: v.number(),
    /** The scan stopped at SCAN_CAP: figures cover the newest SCAN_CAP timelines only. */
    scanCapped: v.boolean(),
    scanCap: v.number(),
    opensAt: v.number(),
    open: v.boolean(),
    metrics: v.array(metricV),
    rfe: v.object({
      total: v.number(),
      byForm: v.array(countV),
      byReason: v.array(countV),
      byOutcome: v.array(countV),
    }),
    rows: v.array(boardRowV),
    /** The offices whose own lists are open, with how many shared timelines each has. */
    offices: v.array(v.object({ code: v.string(), shared: v.number() })),
    waiting: v.object({
      open: v.boolean(),
      byStage: v.array(v.object({ id: v.string(), label: v.string(), count: v.number() })),
      lines: v.array(
        v.object({
          category: v.string(),
          country: v.string(),
          counts: v.array(v.union(v.number(), v.null())),
          total: v.number(),
        }),
      ),
      unlisted: v.number(),
    }),
  }),
  handler: async (ctx) => {
    // NEWEST first. `take` in creation order keeps the OLDEST 5,000, so past
    // that every new timeline would vanish from the counts and the board.
    // Past the cap the page says the
    // figures cover the newest SCAN_CAP.
    const scanned = await ctx.db.query("communityTimelines").order("desc").take(SCAN_CAP);
    const all = scanned.filter(shows);
    const records = all.map(asRecord);
    const shared = all.filter((r) => r.public);
    const open = shared.length >= BOARD_OPENS_AT;
    const perOffice = new Map<string, number>();
    for (const r of shared) if (r.fieldOffice) perOffice.set(r.fieldOffice, (perOffice.get(r.fieldOffice) ?? 0) + 1);
    const officeOpen = (code: string | undefined) => code !== undefined && (perOffice.get(code) ?? 0) >= OFFICE_LIST_OPENS_AT;
    const rows = open
      ? shared
          .sort((x, y) => y.updatedAt - x.updatedAt)
          .slice(0, BOARD_ROWS)
          .map((r) => toBoardRow(asRecord(r), officeOpen(r.fieldOffice)))
      : [];
    return {
      total: all.length,
      shared: shared.length,
      scanCapped: scanned.length >= SCAN_CAP,
      scanCap: SCAN_CAP,
      opensAt: BOARD_OPENS_AT,
      open,
      metrics: computeMetrics(records),
      rfe: summarizeRfes(records),
      rows,
      offices: [...perOffice.entries()]
        .filter(([code]) => officeOpen(code))
        .map(([code, n]) => ({ code, shared: n }))
        .sort((x, y) => y.shared - x.shared || x.code.localeCompare(y.code)),
      waiting: whoIsWaiting(records),
    };
  },
});

const officeRowV = v.object({
  filedMonth: v.union(v.string(), v.null()),
  category: v.union(v.string(), v.null()),
  country: v.union(v.string(), v.null()),
  stops: v.array(v.object({ id: v.string(), day: v.union(v.number(), v.null()), month: v.union(v.string(), v.null()) })),
  rfe: v.union(v.null(), v.object({ outcome: v.union(v.string(), v.null()) })),
  updatedMonth: v.string(),
});

/**
 * One USCIS office's timelines, for its page. PUBLIC on purpose, and held to
 * the board's rules: approved rows only, no case number, employer, hash or
 * exact date. The list opens at OFFICE_LIST_OPENS_AT shared timelines and a
 * median needs METRIC_MIN_N. An office this site has no page for reads empty.
 */
export const office = query({
  args: { office: v.string() },
  returns: v.object({
    total: v.number(),
    shared: v.number(),
    opensAt: v.number(),
    open: v.boolean(),
    /** The read stopped at its bound: figures cover the newest timelines only. */
    capped: v.boolean(),
    metrics: v.array(metricV),
    rows: v.array(officeRowV),
  }),
  handler: async (ctx, a) => {
    const known = a.office.length <= 8 && officeByCode(a.office) !== undefined;
    const read = known
      ? await ctx.db
          .query("communityTimelines")
          .withIndex("by_fieldOffice", (q) => q.eq("fieldOffice", a.office))
          .order("desc")
          .take(PER_OFFICE_READ)
      : [];
    const all = read.filter(shows);
    const shared = all.filter((r) => r.public);
    const open = shared.length >= OFFICE_LIST_OPENS_AT;
    return {
      total: all.length,
      shared: shared.length,
      opensAt: OFFICE_LIST_OPENS_AT,
      open,
      capped: read.length >= PER_OFFICE_READ,
      metrics: computeMetrics(all.map(asRecord)).filter((m) => OFFICE_METRIC_IDS.includes(m.id)),
      rows: open
        ? shared
            .sort((x, y) => y.updatedAt - x.updatedAt)
            .slice(0, OFFICE_ROWS)
            .map((r) => toOfficeRow(asRecord(r)))
        : [],
    };
  },
});

/** Write DOL's PERM dates onto every row for a case. The only writer of `perm*`. */
export const setPermHalf = internalMutation({
  args: {
    caseNumber: v.string(),
    permFiledOn: v.union(v.string(), v.null()),
    permCertifiedOn: v.union(v.string(), v.null()),
    source: v.union(v.literal("disclosure"), v.literal("observed"), v.null()),
  },
  returns: v.number(),
  handler: async (ctx, a) => {
    const rows = await ctx.db
      .query("communityTimelines")
      .withIndex("by_case", (q) => q.eq("caseNumber", a.caseNumber))
      .take(PER_CASE_READ);
    const now = Date.now();
    for (const r of rows) {
      await ctx.db.patch(r._id, {
        permFiledOn: a.permFiledOn ?? undefined,
        permCertifiedOn: a.permCertifiedOn ?? undefined,
        permCertifiedSource: a.source ?? undefined,
        permCheckedAt: now,
      });
    }
    return rows.length;
  },
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read DOL's record for one case from the public-data database (SELECT only, see
 * lib/publicMirror.ts) and write the PERM half.
 *
 * Filing date: the live status table, else the disclosure file. Certification
 * date: the disclosure file when DOL has published the decision (a real
 * decision date), else the day our own sweep first saw the case certified
 * (`observed`, which can trail DOL by a day), and only while DOL's current
 * status still reads CERTIFIED. A case that is not certified gets no date.
 */
async function verifyOne(ctx: ActionCtx, c: string): Promise<void> {
  let live: Record<string, unknown> | undefined;
  let published: Record<string, unknown> | undefined;
  let observed: Record<string, unknown> | undefined;
  try {
    const [l, p, o] = await mirrorQuery([
      { sql: "SELECT filing_date, current_status FROM perm_case_status WHERE case_number = ?", args: [c] },
      {
        sql: "SELECT received_date, decision_date FROM perm_cases WHERE case_number = ? AND status = 'certified'",
        args: [c],
      },
      {
        sql: "SELECT MIN(changed_at) AS at FROM perm_case_events WHERE case_number = ? AND to_status LIKE 'CERTIFIED%'",
        args: [c],
      },
    ]);
    live = l?.[0];
    published = p?.[0];
    observed = o?.[0];
  } catch (e) {
    // Leave the row unverified; the daily sweep asks again.
    console.warn("[communityTimelines.verify] mirror read failed", String(e));
    return;
  }
  const str = (x: unknown) => (typeof x === "string" && ISO_DATE.test(x.slice(0, 10)) ? x.slice(0, 10) : null);
  const filed = str(live?.filing_date) ?? str(published?.received_date);
  const status = typeof live?.current_status === "string" ? live.current_status.toUpperCase() : "";
  let certified: string | null = str(published?.decision_date);
  let source: "disclosure" | "observed" | null = certified ? "disclosure" : null;
  if (!certified && status.startsWith("CERTIFIED")) {
    const at = Number(observed?.at);
    if (Number.isFinite(at) && at > 0) {
      certified = new Date(at).toISOString().slice(0, 10);
      source = "observed";
    }
  }
  await ctx.runMutation(internal.communityTimelines.setPermHalf, {
    caseNumber: c,
    permFiledOn: filed,
    permCertifiedOn: certified,
    source,
  });
}

export const verifyCase = internalAction({
  args: { caseNumber: v.string() },
  returns: v.null(),
  handler: async (ctx, a): Promise<null> => {
    await verifyOne(ctx, a.caseNumber);
    return null;
  },
});

/** Cases still waiting on a certification date, least recently checked first. */
export const casesToVerify = internalQuery({
  args: { limit: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, a) => {
    const dayAgo = Date.now() - 20 * MS_PER_HOUR;
    const out = new Set<string>();
    let seen = 0;
    for await (const r of ctx.db.query("communityTimelines").withIndex("by_perm_checked")) {
      if (++seen > 2_000) break;
      if (r.permCheckedAt !== undefined && r.permCheckedAt > dayAgo) break;
      // A timeline with no case number has no PERM half to read.
      if (r.permCertifiedOn === undefined && r.caseNumber !== undefined) out.add(r.caseNumber);
      if (out.size >= a.limit) break;
    }
    return [...out];
  },
});

/** Daily: re-read DOL for every case whose timeline has no certification date yet. */
export const verifySweep = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cases: string[] = await ctx.runQuery(internal.communityTimelines.casesToVerify, { limit: 100 });
    for (const c of cases) await verifyOne(ctx, c);
    return cases.length;
  },
});

// ============================================================================
// The owner's review
// ============================================================================

const adminRowV = v.object({
  _id: v.id("communityTimelines"),
  caseNumber: v.union(v.string(), v.null()),
  status: statusV,
  shared: v.boolean(),
  hidden: v.boolean(),
  /** Changed by its author since the owner approved it. */
  edited: v.boolean(),
  office: v.union(v.string(), v.null()),
  category: v.union(v.string(), v.null()),
  country: v.union(v.string(), v.null()),
  route: v.union(v.string(), v.null()),
  premium: v.boolean(),
  /** DOL's PERM dates first, then the person's own, each in the order a case meets them. */
  dates: v.array(v.object({ label: v.string(), on: v.string(), verified: v.boolean() })),
  rfe: v.union(v.null(), v.string()),
  declineReason: v.union(v.string(), v.null()),
  /** What to look at before approving (lib `reviewFlags`). */
  flags: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  reviewedAt: v.union(v.number(), v.null()),
});

const labelOf = <T extends { id: string; label: string }>(list: readonly T[], id: string | undefined) =>
  list.find((x) => x.id === id)?.label ?? null;

function adminRow(r: Doc<"communityTimelines">): Infer<typeof adminRowV> {
  const rec = asRecord(r);
  const dates = [
    ...(r.permFiledOn ? [{ label: "PERM filed", on: r.permFiledOn, verified: true }] : []),
    ...(r.permCertifiedOn ? [{ label: "PERM certified", on: r.permCertifiedOn, verified: true }] : []),
    ...DATE_FIELDS.flatMap((f) => (r[f.id] ? [{ label: f.short as string, on: r[f.id] as string, verified: false }] : [])),
  ];
  const rfe = r.rfeForm
    ? [
        `RFE on the ${r.rfeForm === "i140" ? "I-140" : "I-485"}`,
        r.rfeIssuedOn ? `dated ${r.rfeIssuedOn}` : null,
        r.rfeRespondedOn ? `answered ${r.rfeRespondedOn}` : null,
        r.rfeOutcome ?? null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;
  return {
    _id: r._id,
    caseNumber: r.caseNumber ?? null,
    status: statusOf(r),
    shared: r.public,
    hidden: r.hiddenAt !== undefined,
    edited: r.editedAt !== undefined,
    office: r.fieldOffice ? (officeByCode(r.fieldOffice)?.name ?? r.fieldOffice) : null,
    category: labelOf(CATEGORIES, r.category),
    country: labelOf(COUNTRIES, r.country),
    route: r.route ?? null,
    premium: r.premium === true,
    dates,
    rfe,
    declineReason: labelOf(DECLINE_REASONS, r.declineReason),
    flags: reviewFlags({ ...rec, caseNumber: r.caseNumber, permCheckedAt: r.permCheckedAt }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    reviewedAt: r.reviewedAt ?? null,
  };
}

/**
 * Timelines waiting for the owner (oldest first), approved ones their authors
 * changed since, and the newest decided. SECURITY: requireAdmin; rows carry
 * case numbers.
 */
export const listForAdmin = query({
  args: {},
  returns: v.object({ waiting: v.array(adminRowV), edited: v.array(adminRowV), decided: v.array(adminRowV) }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const byStatus = (s: "pending" | "approved" | "declined", order: "asc" | "desc") =>
      ctx.db.query("communityTimelines").withIndex("by_status_created", (q) => q.eq("status", s)).order(order).take(ADMIN_READ);
    const waiting = await byStatus("pending", "asc");
    const edited = await ctx.db.query("communityTimelines").withIndex("by_editedAt", (q) => q.gt("editedAt", 0)).order("desc").take(ADMIN_READ);
    const decided = [...(await byStatus("approved", "desc")), ...(await byStatus("declined", "desc"))]
      .sort((x, y) => (y.reviewedAt ?? y.createdAt) - (x.reviewedAt ?? x.createdAt))
      .slice(0, ADMIN_READ);
    return { waiting: waiting.map(adminRow), edited: edited.map(adminRow), decided: decided.map(adminRow) };
  },
});

/** Show a timeline: it joins the medians, and the lists if its author asked. SECURITY: requireAdmin. */
export const approve = mutation({
  args: { id: v.id("communityTimelines") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That timeline no longer exists.");
    await ctx.db.patch(id, { status: "approved", reviewedAt: Date.now(), declineReason: undefined, editedAt: undefined });
    log.info("timeline approved", { office: row.fieldOffice ?? "none" });
    await refresh(ctx, row.fieldOffice);
    return null;
  },
});

/** Keep a timeline off every page, with the reason kept. Its author still sees it. SECURITY: requireAdmin. */
export const decline = mutation({
  args: { id: v.id("communityTimelines"), reason: declineReasonV },
  returns: v.null(),
  handler: async (ctx, { id, reason }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That timeline no longer exists.");
    const wasShown = shows(row);
    await ctx.db.patch(id, { status: "declined", reviewedAt: Date.now(), declineReason: reason, editedAt: undefined });
    log.info("timeline declined", { reason });
    if (wasShown) await refresh(ctx, row.fieldOffice);
    return null;
  },
});

/** The owner has looked at an approved timeline's edit and it stays. SECURITY: requireAdmin. */
export const keepEdit = mutation({
  args: { id: v.id("communityTimelines") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That timeline no longer exists.");
    await ctx.db.patch(id, { editedAt: undefined });
    return null;
  },
});

/** Delete a timeline for good: its author asked, or it was a test. SECURITY: requireAdmin. */
export const removeByAdmin = mutation({
  args: { id: v.id("communityTimelines") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That timeline no longer exists.");
    await ctx.db.delete(id);
    log.info("timeline deleted", { wasShown: shows(row) });
    if (shows(row)) await refresh(ctx, row.fieldOffice);
    return null;
  },
});

/** Take a row off every surface without deleting it, or put it back. The admin page's button and the CLI's. */
async function setHidden(ctx: MutationCtx, id: Doc<"communityTimelines">["_id"], hidden: boolean): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row) throw new Error("That timeline no longer exists.");
  await ctx.db.patch(id, { hiddenAt: hidden ? Date.now() : undefined });
  if (statusOf(row) === "approved") await refresh(ctx, row.fieldOffice);
}

/** SECURITY: requireAdmin. */
export const hideByAdmin = mutation({
  args: { id: v.id("communityTimelines"), hidden: v.boolean() },
  returns: v.null(),
  handler: async (ctx, a) => {
    await requireAdmin(ctx);
    await setHidden(ctx, a.id, a.hidden);
    return null;
  },
});

/** The same, from the CLI (`npx convex run`). */
export const hide = internalMutation({
  args: { id: v.id("communityTimelines"), hidden: v.boolean() },
  returns: v.null(),
  handler: async (ctx, a) => {
    await setHidden(ctx, a.id, a.hidden);
    return null;
  },
});

/** What waits for the owner, for the email and the morning report: counts and ages, never a case number. */
export const waitingForOwner = internalQuery({
  args: {},
  returns: v.array(v.object({ edited: v.boolean(), since: v.number(), line: v.string() })),
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("communityTimelines")
      .withIndex("by_status_created", (q) => q.eq("status", "pending"))
      .take(ADMIN_READ);
    const edited = await ctx.db.query("communityTimelines").withIndex("by_editedAt", (q) => q.gt("editedAt", 0)).take(ADMIN_READ);
    const line = (r: Doc<"communityTimelines">) => {
      const a = adminRow(r);
      const own = a.dates.filter((d) => !d.verified);
      const last = own[own.length - 1];
      return [a.office ?? "No office given", a.category, a.country, last ? `${last.label} ${last.on}` : null].filter(Boolean).join(", ");
    };
    return [
      ...pending.map((r) => ({ edited: false, since: r.createdAt, line: line(r) })),
      ...edited.map((r) => ({ edited: true, since: r.editedAt ?? r.updatedAt, line: line(r) })),
    ];
  },
});

/** One email to the owner: the timelines waiting right now. The caller charged the once-a-day limit. */
export const notifyOwner = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const to = getSecurityAlertEmail();
    if (!to) {
      log.warn("no owner address configured; the waiting-timelines email wasn't sent", {});
      return null;
    }
    try {
      const waiting: { edited: boolean; since: number; line: string }[] = await ctx.runQuery(internal.communityTimelines.waitingForOwner, {});
      if (waiting.length === 0) return null;
      const fresh = waiting.filter((w) => !w.edited);
      const edited = waiting.filter((w) => w.edited);
      const text = [
        ...(fresh.length > 0 ? ["These timelines wait for you before they show on the site:", "", ...fresh.slice(0, 20).map((w) => `- ${w.line}`), ""] : []),
        ...(edited.length > 0 ? ["These were changed by their authors after you approved them, and still show:", "", ...edited.slice(0, 20).map((w) => `- ${w.line}`), ""] : []),
        `Approve or decline on the admin page: ${SITE_URL}/admin#timelines`,
        "",
        "A timeline holds only dates and picks from fixed lists. Decline one whose dates can't be right, a second copy, or a test.",
        "You get this at most once a day.",
      ].join("\n");
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html = text
        .split("\n")
        .map((l) => (l ? `<p>${esc(l)}</p>` : ""))
        .join("");
      const result = await sendOwnerMail(ctx, "timeline-review", getResend(), {
        to,
        subject: `Timelines waiting for you: ${waiting.length}`,
        html,
        text,
      });
      if (result.error) await recordError(ctx, "action", "communityTimelines.notifyOwner", new Error(`owner email failed: ${JSON.stringify(result.error)}`));
    } catch (error) {
      await recordError(ctx, "action", "communityTimelines.notifyOwner", error);
    }
    return null;
  },
});

/** Waits before each retry of a refused refresh; after the last, the failure is recorded. */
const REFRESH_RETRY_MS = [MS_PER_MINUTE, 5 * MS_PER_MINUTE, 30 * MS_PER_MINUTE] as const;

/**
 * Refresh the timelines page and each named office's page now, so a decision
 * shows in minutes and not at the end of the pages' window. Needs
 * REVALIDATE_SECRET on the deployment; without it the change shows when the
 * pages next regenerate, and a warning says so. A refused call is retried,
 * then recorded with `recordError`, which emails the owner.
 */
export const refreshPages = internalAction({
  args: { offices: v.array(v.string()), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const key = process.env.REVALIDATE_SECRET;
    if (!key) {
      log.warn("REVALIDATE_SECRET isn't set; the timelines show the change when the pages next regenerate", {});
      return null;
    }
    let failure: string | null = null;
    try {
      const res = await fetch(`${SITE_URL}/api/revalidate-timelines`, {
        method: "POST",
        headers: { "x-revalidate-secret": key, "Content-Type": "application/json" },
        body: JSON.stringify({ offices: args.offices }),
      });
      if (!res.ok) failure = `HTTP ${res.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure === null) return null;
    const attempt = args.attempt ?? 0;
    const wait = REFRESH_RETRY_MS[attempt];
    if (wait !== undefined) {
      log.warn("timelines refresh failed; trying again", { attempt, failure });
      await ctx.scheduler.runAfter(wait, internal.communityTimelines.refreshPages, { offices: args.offices, attempt: attempt + 1 });
      return null;
    }
    await recordError(
      ctx,
      "action",
      "communityTimelines.refreshPages",
      new Error(`The timelines pages weren't refreshed after ${attempt + 1} tries (${failure}); they show the change when they next regenerate.`),
    );
    return null;
  },
});

/**
 * One-time, after the deploy that added reviews: mark every timeline saved
 * before then as approved, because each was already public. Safe to run twice.
 * `npx convex run communityTimelines:backfillStatus --prod`.
 */
export const backfillStatus = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("communityTimelines").take(SCAN_CAP);
    const now = Date.now();
    let marked = 0;
    for (const r of rows) {
      if (r.status !== undefined) continue;
      await ctx.db.patch(r._id, { status: "approved", reviewedAt: now });
      marked += 1;
    }
    return marked;
  },
});
