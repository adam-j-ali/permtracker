import "server-only";

import { parseI140Snapshot, type I140Snapshot } from "@/lib/uscisI140Shape";

import { doc } from "./publicData";

/**
 * The newest USCIS I-140 quarter, from the database copy that every complete run of scripts/ingest_uscis_i140.py
 * writes, on the server or on GitHub.
 *
 * The Convex copy that was the fallback was retired on Nov 26 2026: only GitHub held a key to write it, and
 * www.uscis.gov refuses GitHub's runners, so it had stopped at the quarter it last held. A failed read throws, so the page
 * keeps its last good render; null means the database has never held a quarter. The `revalidateSeconds` argument is
 * kept for the callers' signature.
 */
export async function getI140Snapshot(_revalidateSeconds: number): Promise<I140Snapshot | null> {
  return parseI140Snapshot(await doc<unknown>("uscis_i140"));
}
