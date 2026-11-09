import "server-only";

import { rows } from "./client";

/** Numbers one statement asks about: well under SQLite's bound-parameter limit. */
const CHUNK = 500;

/**
 * How many decided PERM cases DOL's published file names each wage request on, by the request's
 * number, on `idx_pc_pwd_number`. A request no decided case names is left out of the answer, so
 * a missing number means "none decided yet", and a failed read throws rather than answering none.
 */
export async function permsNaming(numbers: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const asked = [...new Set(numbers)];
  for (let i = 0; i < asked.length; i += CHUNK) {
    const chunk = asked.slice(i, i + CHUNK);
    const got = await rows<{ pwd_number: string; n: number | string }>(
      `SELECT pwd_number, COUNT(*) AS n FROM perm_cases WHERE pwd_number IN (${chunk.map(() => "?").join(",")}) GROUP BY pwd_number`,
      chunk,
    );
    // libSQL returns integers as strings.
    for (const r of got) out.set(String(r.pwd_number), Number(r.n));
  }
  return out;
}
