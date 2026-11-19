import "server-only";
import { cache } from "react";

import type { BulletinRead } from "../bulletinReadCheck";
import { one } from "./client";

/**
 * The newest read of State's bulletin page that got through (`src/lib/bulletinCheck.ts`). One row from a small
 * table read a few times a day as the bulletin pages rebuild; a failed read throws, and the pages fall back to
 * the past years' release days (softFail at the call site).
 */
export const getBulletinRead = cache(async (): Promise<BulletinRead | null> => {
  const r = await one<{ note: string | null; finished_at: number | string | null }>(
    "SELECT note, finished_at FROM ingest_runs WHERE script = ? AND status = 'ok' AND note LIKE 'loaded%' " +
      "ORDER BY finished_at DESC LIMIT 1",
    ["browser-timer:bulletin-read"],
  );
  const at = Number(r?.finished_at);
  if (!r || !Number.isFinite(at) || at <= 0) return null;
  return { checkedAt: at, note: String(r.note ?? "") };
});
