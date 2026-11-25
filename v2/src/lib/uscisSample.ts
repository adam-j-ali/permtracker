import { normaliseReceipt } from "@/lib/uscis/receipt";

/**
 * The USCIS sample's figures as the site reads them (Batch 3). The sample is a spread of receipt numbers checked on
 * USCIS's public Case Status page; its estimate gives each block of 100,000 online (IOE) numbers, and each receipt
 * month, a share per status group with a 95% margin. These helpers turn the stored figures into what the receipt-block
 * pages show. The figures are loaded by scripts/ingest_uscis_sample.py into perm_docs; src/lib/db/uscisSample.ts
 * reads them.
 */

export const SAMPLE_GROUPS = ["approved", "denied", "withdrawn", "closed", "revoked", "rfe", "waiting"] as const;
export type SampleGroup = (typeof SAMPLE_GROUPS)[number];

export interface GroupFigure {
  count: number;
  estimated: number;
  share: number;
  low: number;
  high: number;
}

export interface FormFigure {
  counted: number;
  walked_cases: number;
  drawn_cases: number;
  rest_unknown: boolean;
  rest_share: number | null;
  groups: Record<SampleGroup, GroupFigure>;
}

/** One block's figures: a FormFigure per form, and the estimate's own counts under keys that start with "_". */
export type BlockFigures = Record<string, FormFigure | number>;

export interface SampleBlocksDoc {
  as_of: string;
  groups: readonly string[];
  by_block: Record<string, BlockFigures>;
}

const BLOCK = /^IOE\d{5}$/;

/** The block a typed block name ("IOE09366") or online receipt means, the way people name blocks; null for anything else. */
export function blockFromInput(input: string): string | null {
  const squeezed = input.toUpperCase().replace(/[\s\-‐-―.]+/g, "");
  if (BLOCK.test(squeezed)) return squeezed;
  const receipt = normaliseReceipt(input);
  return receipt && receipt.startsWith("IOE") && !receipt.includes("*") ? receipt.slice(0, 8) : null;
}

const isForm = (key: string, v: FormFigure | number | undefined): v is FormFigure =>
  !key.startsWith("_") && typeof v === "object" && v !== null;

export interface BlockForm {
  form: string;
  counted: number;
  approved: GroupFigure;
  figure: FormFigure;
}

/** A block's forms, most counted first (then by name), each with its approved share and margin. */
export function blockForms(block: BlockFigures): BlockForm[] {
  return Object.entries(block)
    .filter((e): e is [string, FormFigure] => isForm(e[0], e[1]))
    .filter(([, f]) => f.counted > 0)
    .map(([form, f]) => ({ form, counted: f.counted, approved: f.groups.approved, figure: f }))
    .sort((a, b) => b.counted - a.counted || a.form.localeCompare(b.form));
}

export interface SeriesPoint {
  block: string;
  counted: number;
  approved: GroupFigure;
}

/** One point per block holding `form`, in block order: what the approval-share chart draws. */
export function blockSeries(doc: SampleBlocksDoc, form: string): SeriesPoint[] {
  return Object.keys(doc.by_block)
    .sort()
    .flatMap((block) => {
      const f = doc.by_block[block]?.[form];
      return isForm(form, f) && f.counted > 0 ? [{ block, counted: f.counted, approved: f.groups.approved }] : [];
    });
}

/** The last block in the series with an approval in the sample: where approvals stop, as far as the sample shows. */
export function approvalsStopAfter(series: readonly SeriesPoint[]): string | null {
  for (let i = series.length - 1; i >= 0; i--) if ((series[i]?.approved.count ?? 0) > 0) return series[i]!.block;
  return null;
}

/** The blocks either side of `block` that hold cases. */
export function neighbours(doc: SampleBlocksDoc, block: string): { before: string | null; after: string | null } {
  const held = Object.keys(doc.by_block)
    .filter((b) => blockForms(doc.by_block[b] ?? {}).length > 0)
    .sort();
  const at = held.indexOf(block);
  if (at < 0) {
    const after = held.find((b) => b > block) ?? null;
    const before = [...held].reverse().find((b) => b < block) ?? null;
    return { before, after };
  }
  return { before: held[at - 1] ?? null, after: held[at + 1] ?? null };
}

/** The forms with the most sampled cases across every block, most first. */
export function topForms(doc: SampleBlocksDoc, n = 5): string[] {
  const total = new Map<string, number>();
  for (const block of Object.values(doc.by_block))
    for (const f of blockForms(block)) total.set(f.form, (total.get(f.form) ?? 0) + f.counted);
  return [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([f]) => f);
}

/** What the approval chart draws for each form: one point per block and where approvals stop. I-485 leads when held. */
export function chartSeries(doc: SampleBlocksDoc, forms: readonly string[]) {
  const ordered = forms.includes("I-485") ? ["I-485", ...forms.filter((f) => f !== "I-485")] : [...forms];
  return ordered.map((form) => {
    const series = blockSeries(doc, form);
    return {
      form,
      stopAfter: approvalsStopAfter(series),
      points: series.map((p) => ({
        block: p.block,
        counted: p.counted,
        count: p.approved.count,
        share: p.approved.share,
        low: p.approved.low,
        high: p.approved.high,
      })),
    };
  });
}
