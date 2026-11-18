import "server-only";

import { cache } from "react";

import { parseUscisPosted, type UscisPosted } from "@/lib/uscisPosted";
import { one, rows } from "./client";

/**
 * perm_docs['uscis_posted_times'], written by scripts/ingest_uscis_posted_times.py twice a day. Null when the doc
 * doesn't exist yet or can't be parsed, and the pages then print the typed figures with the day they were read. A
 * failed read throws, so a page keeps its last good render instead of dropping to the typed figures for a day.
 */
export const getUscisPosted = cache(async (): Promise<UscisPosted | null> => {
  try {
    const r = await one<{ json: string }>("SELECT json FROM perm_docs WHERE key = 'uscis_posted_times'");
    return r ? parseUscisPosted(String(r.json)) : null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
});

/**
 * One field office's own posted time for family-based I-485s (subtype 131A-FAM), every posting since March 2022,
 * oldest first. USCIS posts no employment-based time per office (131A is posted for all field offices together), so
 * an office's family-based figure is the one measure of that office's own pace it publishes. A failed read throws.
 */
export const getI485OfficePosted = cache(async (office: string): Promise<[string, number][]> => {
  try {
    const got = await rows<{ published: string; posted: number | string }>(
      "SELECT published, posted FROM uscis_posted_times WHERE form = 'I-485' AND subtype = '131A-FAM' AND office = ? AND posted IS NOT NULL ORDER BY published",
      [office],
    );
    return got.map((r) => [String(r.published), Number(r.posted)]);
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
});
