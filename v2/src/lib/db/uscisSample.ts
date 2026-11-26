import "server-only";

import { cache } from "react";

import type { IssuedRun } from "@/lib/uscisIssued";
import type { SampleBlocksDoc, SampleMonthsDoc } from "@/lib/uscisSample";

import { one, rows } from "./client";

/**
 * The reads behind the receipt-block pages and a receipt's last status (Batch 3): the USCIS sample's figures
 * (perm_docs 'uscis_sample' and 'uscis_sample_blocks') and its tables (uscis_sample_cases, one row per number with a
 * case; uscis_sample_events, each status change), all loaded nightly by scripts/ingest_uscis_sample.py. Receipt
 * numbers leave this module in three reads: a typed number's own last status, the checked numbers around it, and each
 * block's list of checked numbers (the Privacy Policy, "Our sample of USCIS cases"; those pages stay out of search).
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

export const getSampleMonths = cache(async (): Promise<SampleMonthsDoc | null> => doc<SampleMonthsDoc>("uscis_sample_months"));

/** The census's runs that reached each block's newest number ('uscis_sample_issued'): cases issued between two runs. */
export const getSampleIssued = cache(async (): Promise<IssuedRun[]> => {
  const d = await doc<{ as_of: string; runs: IssuedRun[] }>("uscis_sample_issued");
  return d?.runs ?? [];
});

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

export interface SampleCaseRow {
  receipt: string;
  form: string | null;
  grp: string;
  status: string;
  checked_on: string;
  since_on: string;
}

const caseRow = (r: Record<string, unknown>): SampleCaseRow => ({
  receipt: String(r.receipt),
  form: r.form === null || r.form === undefined ? null : String(r.form),
  grp: String(r.grp),
  status: String(r.status),
  checked_on: String(r.checked_on),
  since_on: String(r.since_on),
});

/** One page of the numbers the sample checked in a block, in number order, and how many there are in all. */
export async function getBlockCases(block: string, page: number, per: number): Promise<{ total: number; rows: SampleCaseRow[] }> {
  if (!/^IOE\d{5}$/.test(block)) return { total: 0, rows: [] };
  const [count, got] = await Promise.all([
    one<{ n: number | string }>("SELECT COUNT(*) AS n FROM uscis_sample_cases WHERE receipt >= ? AND receipt < ?", [block, `${block}~`]),
    rows<Record<string, unknown>>(
      `SELECT receipt, form, grp, status, checked_on, since_on FROM uscis_sample_cases
        WHERE receipt >= ? AND receipt < ? ORDER BY receipt LIMIT ? OFFSET ?`,
      [block, `${block}~`, per, Math.max(0, page - 1) * per],
    ),
  ]);
  return { total: Number(count?.n) || 0, rows: got.map(caseRow) };
}

/** Where a number falls in its block's list: how many checked numbers come before it. */
export async function blockPlace(receipt: string): Promise<number> {
  if (!/^IOE\d{10}$/.test(receipt)) return 0;
  const r = await one<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM uscis_sample_cases WHERE receipt >= ? AND receipt < ?",
    [receipt.slice(0, 8), receipt],
  );
  return Number(r?.n) || 0;
}

/** The numbers the sample checked within `span` of a receipt, either side, in number order (the receipt itself left out). */
export async function getCasesAround(receipt: string, span = 500): Promise<SampleCaseRow[]> {
  const m = /^([A-Z]{3})(\d{10})$/.exec(receipt);
  if (!m) return [];
  const n = Number(m[2]);
  const at = (k: number) => `${m[1]}${String(Math.max(0, k)).padStart(10, "0")}`;
  const got = await rows<Record<string, unknown>>(
    `SELECT receipt, form, grp, status, checked_on, since_on FROM uscis_sample_cases
      WHERE receipt >= ? AND receipt <= ? AND receipt <> ? ORDER BY receipt LIMIT ?`,
    [at(n - span), at(n + span), receipt, span * 2 + 1],
  );
  return got.map(caseRow);
}

export interface BlockMixRows {
  as_of: string;
  /** Each group's count, and each waiting step's by USCIS's words (status "" for an outcome, or the rarer steps). */
  rows: { grp: string; status: string; n: number }[];
}

/**
 * One block's counts for its card ('uscis_sample_block_mix', counted by the nightly load): only that block's part of
 * the document is read. Null before the first load; a block the sample holds no case in reads as no rows.
 */
export const getBlockMix = cache(async (block: string): Promise<BlockMixRows | null> => {
  if (!/^IOE\d{5}$/.test(block)) return null;
  const row = await one<{ as_of: string | null; mix: string | null }>(
    "SELECT json_extract(json, '$.as_of') AS as_of, json_extract(json, ?) AS mix FROM perm_docs WHERE key = 'uscis_sample_block_mix'",
    [`$.by_block.${block}`],
  );
  if (!row || !row.as_of) return null;
  const got = row.mix ? (JSON.parse(String(row.mix)) as [string, string, number | string][]) : [];
  return { as_of: String(row.as_of), rows: got.map(([grp, status, n]) => ({ grp: String(grp), status: String(status), n: Number(n) || 0 })) };
});

/** Several blocks' counts in one read (the list of blocks counted in full): each block's part of the document only. */
export const getBlockMixes = cache(async (blocks: readonly string[]): Promise<Record<string, BlockMixRows["rows"]>> => {
  const wanted = blocks.filter((b) => /^IOE\d{5}$/.test(b));
  if (!wanted.length) return {};
  const got = await rows<{ block: string; mix: string }>(
    `SELECT j.key AS block, j.value AS mix FROM perm_docs, json_each(perm_docs.json, '$.by_block') AS j
      WHERE perm_docs.key = 'uscis_sample_block_mix' AND j.key IN (${wanted.map(() => "?").join(", ")})`,
    [...wanted],
  );
  return Object.fromEntries(
    got.map((r) => [
      String(r.block),
      (JSON.parse(String(r.mix)) as [string, string, number | string][]).map(([grp, status, n]) => ({ grp: String(grp), status: String(status), n: Number(n) || 0 })),
    ]),
  );
});
