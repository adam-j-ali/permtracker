/**
 * The checker's line of receipt blocks, as it POSTs it to /block-queue-state (convex/blockRequests.ts recordQueue).
 * The whole body is refused if anything in it is misshapen, so a bad send never half-replaces the line.
 *
 * @module
 */

import { BLOCK_RE } from "./blockUpdate";

export type BlockQueueItem = { block: string; position: number; status: "walking" | "waiting"; handed: number; votes: number };
export type BlockQueueState = {
  at: number;
  running: boolean;
  perMinute?: number;
  items: BlockQueueItem[];
  walked: { block: string; at: number }[];
};

const MAX_ITEMS = 400;
const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
const isTime = (n: unknown): n is number => isInt(n, 1_600_000_000_000, 4_000_000_000_000);

export function parseBlockQueue(body: unknown): BlockQueueState | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isTime(b.at) || typeof b.running !== "boolean") return null;
  const per = b.perMinute;
  if (per !== null && per !== undefined && !(typeof per === "number" && Number.isFinite(per) && per >= 0 && per <= 1_000_000)) return null;
  if (!Array.isArray(b.items) || b.items.length > MAX_ITEMS) return null;
  if (!Array.isArray(b.walked) || b.walked.length > MAX_ITEMS) return null;
  const items: BlockQueueItem[] = [];
  for (const raw of b.items) {
    if (typeof raw !== "object" || raw === null) return null;
    const i = raw as Record<string, unknown>;
    if (typeof i.block !== "string" || !BLOCK_RE.test(i.block)) return null;
    if (!isInt(i.position, 1, MAX_ITEMS) || !isInt(i.handed, 0, 100_000) || !isInt(i.votes, 0, 1_000_000)) return null;
    if (i.status !== "walking" && i.status !== "waiting") return null;
    items.push({ block: i.block, position: i.position, status: i.status, handed: i.handed, votes: i.votes });
  }
  const walked: { block: string; at: number }[] = [];
  for (const raw of b.walked) {
    if (typeof raw !== "object" || raw === null) return null;
    const w = raw as Record<string, unknown>;
    if (typeof w.block !== "string" || !BLOCK_RE.test(w.block) || !isTime(w.at)) return null;
    walked.push({ block: w.block, at: w.at });
  }
  return { at: b.at, running: b.running, perMinute: typeof per === "number" ? per : undefined, items, walked };
}
