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
 * One posted row's history (a form, a category, an office), every posting since March 2022, oldest first. The site
 * draws it for a field office's own family-based I-485 time (USCIS posts no employment-based time per office, only
 * one for all field offices together) and for the work permit and advance parole rows on the I-765 and I-131 pages.
 * One index seek on the table's key. A failed read throws.
 */
export const getPostedHistory = cache(async (form: string, subtype: string, office: string): Promise<[string, number][]> => {
  try {
    const got = await rows<{ published: string; posted: number | string }>(
      "SELECT published, posted FROM uscis_posted_times WHERE form = ? AND subtype = ? AND office = ? AND posted IS NOT NULL ORDER BY published",
      [form, subtype, office],
    );
    return got.map((r) => [String(r.published), Number(r.posted)]);
  } catch (e) {
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
});
