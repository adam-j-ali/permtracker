/**
 * Mutation-side helpers for the USCIS receipt tracking beta, shared by its own module (convex/uscisAlerts.ts), the
 * preference page (convex/emailPrefs.ts) and every stop (convex/lib/listMailOff.ts, which account deletion runs).
 *
 * The one rule they keep: a receipt is held in `uscisReceipts` exactly while a confirmed watch holds it. Every
 * confirmed watch adds one to its receipt's `watchers`, every deleted one takes one off, and the receipt's row and
 * its status go with the last. The beta's counter (`uscisWatchMeta.receipts`) moves with the rows, so the cap is a
 * read of one document.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { dropQueued } from "./alertOutboxStore";
import { MAX_RECEIPTS_PER_ADDRESS, WATCHED_RECEIPTS_CAP } from "./uscisWatch";

type Reader = Pick<QueryCtx, "db">;

/** The beta's one counter row, or null before the first receipt. */
export async function metaRow(ctx: Reader): Promise<Doc<"uscisWatchMeta"> | null> {
  return await ctx.db
    .query("uscisWatchMeta")
    .withIndex("by_key", (q) => q.eq("key", "main"))
    .unique();
}

/** True when the beta watches as many receipts as it may. */
export async function betaFull(ctx: Reader): Promise<boolean> {
  return ((await metaRow(ctx))?.receipts ?? 0) >= WATCHED_RECEIPTS_CAP;
}

async function bumpReceipts(ctx: MutationCtx, by: number): Promise<void> {
  const row = await metaRow(ctx);
  if (row) await ctx.db.patch(row._id, { receipts: Math.max(0, row.receipts + by) });
  else await ctx.db.insert("uscisWatchMeta", { key: "main", receipts: Math.max(0, by) });
}

export async function receiptRow(ctx: Reader, receipt: string): Promise<Doc<"uscisReceipts"> | null> {
  return await ctx.db
    .query("uscisReceipts")
    .withIndex("by_receipt", (q) => q.eq("receipt", receipt))
    .first();
}

/**
 * One more confirmed watch on `receipt`: its row, made if it's new. Null when it's new and the beta is full, and
 * then nothing is written.
 */
export async function addWatcher(ctx: MutationCtx, receipt: string): Promise<Doc<"uscisReceipts"> | null> {
  const held = await receiptRow(ctx, receipt);
  if (held) {
    await ctx.db.patch(held._id, { watchers: held.watchers + 1 });
    return { ...held, watchers: held.watchers + 1 };
  }
  if (await betaFull(ctx)) return null;
  const id = await ctx.db.insert("uscisReceipts", { receipt, watchers: 1 });
  await bumpReceipts(ctx, 1);
  return await ctx.db.get(id);
}

/** One confirmed watch fewer on `receipt`; the last one takes the receipt's row and status with it. */
async function dropWatcher(ctx: MutationCtx, receipt: string): Promise<void> {
  const held = await receiptRow(ctx, receipt);
  if (!held) return;
  if (held.watchers <= 1) {
    await ctx.db.delete(held._id);
    await bumpReceipts(ctx, -1);
  } else {
    await ctx.db.patch(held._id, { watchers: held.watchers - 1 });
  }
}

/** Delete one watch, confirmed or not, keeping the receipt's count true. */
export async function deleteWatch(ctx: MutationCtx, row: Doc<"uscisWatches">): Promise<void> {
  await ctx.db.delete(row._id);
  if (row.confirmedAt !== undefined) await dropWatcher(ctx, row.receipt);
}

/** Every watch an address holds, confirmed or not. Bounded: one address holds MAX_RECEIPTS_PER_ADDRESS at most. */
export async function watchesFor(ctx: Reader, email: string): Promise<Doc<"uscisWatches">[]> {
  return await ctx.db
    .query("uscisWatches")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(MAX_RECEIPTS_PER_ADDRESS + 1);
}

/**
 * Stop every watch of an address: deleted, not tombstoned, so the receipts are no longer held for it, and a
 * replayed confirm link finds nothing to confirm. Whatever was still waiting to go to the address about them is
 * dropped. Returns how many watches went.
 */
export async function deleteWatchesFor(ctx: MutationCtx, email: string): Promise<number> {
  const rows = await watchesFor(ctx, email);
  for (const row of rows) await deleteWatch(ctx, row);
  if (rows.length > 0) await dropQueued(ctx, email, "uscis");
  return rows.length;
}

/** One address's watches as the preference page and Settings list them. */
export interface UscisWatchState {
  id: Id<"uscisWatches">;
  receipt: string;
  confirmed: boolean;
  active: boolean;
  /** USCIS's newest status as the checker last read it, or null before the first check that found the case. */
  status: string | null;
  /** When the checker last asked USCIS, or null before its first check. Never read as "nothing changed". */
  checkedAt: number | null;
  /** True when the newest check found no case under the receipt. */
  notFound: boolean;
}

export async function watchStateFor(ctx: Reader, email: string): Promise<UscisWatchState[]> {
  const out: UscisWatchState[] = [];
  for (const row of await watchesFor(ctx, email)) {
    const held = row.confirmedAt !== undefined ? await receiptRow(ctx, row.receipt) : null;
    out.push({
      id: row._id,
      receipt: row.receipt,
      confirmed: row.confirmedAt !== undefined,
      active: row.confirmedAt !== undefined,
      status: held?.status ?? null,
      checkedAt: held?.checkedAt ?? null,
      notFound: held?.notFound === true,
    });
  }
  return out;
}
