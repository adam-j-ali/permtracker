/**
 * The server's POST /block-update body, checked before any mutation sees it (convex/http.ts): every block's counts by
 * form after a USCIS sample load. Anything misshapen is refused whole, never stored in part.
 */

export const BLOCK_RE = /^IOE\d{5}$/;
/** A USCIS form's number as the sample writes it (I-765, I-485, N-400, I-129F). */
export const FORM_RE = /^[A-Z]{1,3}-\d{1,4}[A-Z]{0,2}$/;
const MAX_BLOCKS = 2000;
const MAX_FORMS = 40;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BlockCounts {
  total: number;
  approved: number;
  denied: number;
  rfe: number;
  waiting: number;
}
export interface BlockUpdate {
  asOf: string;
  blocks: { block: string; every: boolean; checked: number; byForm: Record<string, BlockCounts> }[];
}

const count = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1_000_000 ? x : null);

export function parseBlockUpdate(body: unknown): BlockUpdate | null {
  if (typeof body !== "object" || body === null) return null;
  const { asOf, blocks } = body as Record<string, unknown>;
  if (typeof asOf !== "string" || !DAY_RE.test(asOf) || !Array.isArray(blocks) || blocks.length > MAX_BLOCKS) return null;
  const out: BlockUpdate["blocks"] = [];
  for (const b of blocks) {
    if (typeof b !== "object" || b === null) return null;
    const { block, every, checked, byForm } = b as Record<string, unknown>;
    const n = count(checked);
    if (typeof block !== "string" || !BLOCK_RE.test(block) || typeof every !== "boolean" || n === null) return null;
    if (typeof byForm !== "object" || byForm === null) return null;
    const entries = Object.entries(byForm as Record<string, unknown>);
    if (entries.length > MAX_FORMS) return null;
    const forms: Record<string, BlockCounts> = {};
    for (const [form, c] of entries) {
      if (!FORM_RE.test(form) || typeof c !== "object" || c === null) return null;
      const r = c as Record<string, unknown>;
      const vals = [count(r.total), count(r.approved), count(r.denied), count(r.rfe), count(r.waiting)];
      if (vals.some((v) => v === null)) return null;
      const [total, approved, denied, rfe, waiting] = vals as number[];
      forms[form] = { total: total!, approved: approved!, denied: denied!, rfe: rfe!, waiting: waiting! };
    }
    out.push({ block, every, checked: n, byForm: forms });
  }
  return { asOf, blocks: out };
}
