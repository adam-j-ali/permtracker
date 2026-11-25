import "server-only";

import { cache } from "react";

import type { SampleBlocksDoc } from "@/lib/uscisSample";

import { one, rows } from "./client";

/**
 * The reads behind the receipt-block pages and a receipt's last status (Batch 3): the USCIS sample's figures
 * (perm_docs 'uscis_sample' and 'uscis_sample_blocks') and its tables (uscis_sample_cases, one row per number with a
 * case; uscis_sample_events, each status change), all loaded nightly by scripts/ingest_uscis_sample.py. A receipt
 * number leaves this module only in `getReceiptLastStatus`, for that number's own lookup; every other read is counts.
 * Before the first load the docs are missing and these return null, which the pages say in words; a failed read throws.
 */

export interface SampleMeta {
  as_of: string;
  cases: number;
}

const doc = async <T,>(key: string): Promise<T | null> => {
  const row = await one<{ json: string }>("SELECT json FROM perm_docs WHERE key = ?", [key]);
  return row ? (JSON.parse(String(row.json)) as T) : null;
};

export const getSampleMeta = cache(async (): Promise<SampleMeta | null> => {
  const d = await doc<SampleMeta>("uscis_sample");
  return d ? { as_of: String(d.as_of), cases: Number(d.cases) || 0 } : null;
});

export const getSampleBlocks = cache(async (): Promise<SampleBlocksDoc | null> => doc<SampleBlocksDoc>("uscis_sample_blocks"));

export interface BlockMove {
  on_day: string;
  form: string | null;
  /** The kit's group: the estimate's seven, or rejected, decided (unnamed) or other. */
  to_grp: string;
  n: number;
}

/** The newest status changes the sample saw in a block, counted by day, form and new group (no receipt numbers). */
export const getBlockMoves = cache(async (block: string, limit = 8): Promise<BlockMove[]> => {
  if (!/^IOE\d{5}$/.test(block)) return [];
  const got = await rows<{ on_day: string; form: string | null; to_grp: string; n: number | string }>(
    `SELECT on_day, form, to_grp, COUNT(*) AS n FROM uscis_sample_events
      WHERE receipt >= ? AND receipt < ?
      GROUP BY on_day, form, to_grp ORDER BY on_day DESC, n DESC LIMIT ?`,
    [block, `${block}~`, limit],
  );
  return got.map((r) => ({ on_day: String(r.on_day), form: r.form, to_grp: String(r.to_grp), n: Number(r.n) }));
});

export interface ReceiptLastStatus {
  form: string | null;
  grp: string;
  status: string;
  checked_on: string;
  since_on: string;
}

/** The newest status the sample saw for one receipt, for that receipt's own lookup only; null when it wasn't sampled. */
export async function getReceiptLastStatus(receipt: string): Promise<ReceiptLastStatus | null> {
  if (!/^[A-Z]{3}\d{10}$/.test(receipt)) return null;
  const r = await one<{ form: string | null; grp: string; status: string; checked_on: string; since_on: string }>(
    "SELECT form, grp, status, checked_on, since_on FROM uscis_sample_cases WHERE receipt = ?",
    [receipt],
  );
  return r
    ? { form: r.form, grp: String(r.grp), status: String(r.status), checked_on: String(r.checked_on), since_on: String(r.since_on) }
    : null;
}
