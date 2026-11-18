import "server-only";

import { cache } from "react";

import { parseUscisMonthly, type UscisMonthly } from "@/lib/uscisMonthly";
import { one } from "./client";

/**
 * perm_docs['uscis_monthly_forms'], written by scripts/ingest_uscis_monthly_forms.py on the server each morning.
 * Null when the doc doesn't exist yet or can't be parsed; a failed read throws, so a page keeps its last good render.
 */
export const getUscisMonthly = cache(async (): Promise<UscisMonthly | null> => {
  try {
    const r = await one<{ json: string }>("SELECT json FROM perm_docs WHERE key = 'uscis_monthly_forms'");
    return r ? parseUscisMonthly(String(r.json)) : null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
});
