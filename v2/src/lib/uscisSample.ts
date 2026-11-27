import { MONTH_NAMES } from "@convex/lib/months";
import { formatAsOf } from "@/lib/dolFormat";
import { formatShareOf } from "@/lib/format";
import { normaliseReceipt } from "@/lib/uscis/receipt";
import type { CaseStatusTint } from "@/lib/statusTone";

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
export type BlockFigures = Record<string, FormFigure | number | string>;

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

const isForm = (key: string, v: FormFigure | number | string | undefined): v is FormFigure =>
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

/** One form's figures in a block or a month, or null when the sample counted none of it there. */
export function formFigure(figures: BlockFigures, form: string): FormFigure | null {
  const f = figures[form];
  return isForm(form, f) && f.counted > 0 ? f : null;
}

/** The forms with the most sampled cases across every block (or month), most first. */
export function topFormsIn(byPlace: Record<string, BlockFigures>, n = 5): string[] {
  const total = new Map<string, number>();
  for (const figures of Object.values(byPlace))
    for (const f of blockForms(figures)) total.set(f.form, (total.get(f.form) ?? 0) + f.counted);
  return [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([f]) => f);
}

/** The forms with the most sampled cases across every block, most first. */
export function topForms(doc: SampleBlocksDoc, n = 5): string[] {
  return topFormsIn(doc.by_block, n);
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

export interface SampleMonthsDoc {
  as_of: string;
  groups: readonly string[];
  by_month: Record<string, BlockFigures>;
}

export interface MonthRow {
  month: string;
  counted: number;
  approved: GroupFigure;
  rfe: GroupFigure;
  waiting: GroupFigure;
  /** The cases still waiting, estimated, with the range its margin gives (pendingEstimate). */
  pending: { estimated: number; low: number; high: number } | null;
  /** True when part of the month was walked number by number (counted whole), the rest estimated from the draw. */
  walked: boolean;
}

/** Each receipt month holding `form`, newest first, with the form's figures and whether part of the month was walked. */
export function monthFigures(doc: SampleMonthsDoc, form: string): { month: string; figure: FormFigure; walked: boolean }[] {
  return Object.keys(doc.by_month)
    .sort()
    .reverse()
    .flatMap((month) => {
      const m = doc.by_month[month] ?? {};
      const figure = formFigure(m, form);
      if (!figure) return [];
      return [{ month, figure, walked: typeof m._walked_share === "number" && m._walked_share > 0 }];
    });
}

/**
 * How many of a form-month's cases are still waiting (Batch 3, pending by month): the waiting group's estimated count,
 * and its range from the share's 95% margin applied to every case the month holds. Null for a month with none.
 */
export function pendingEstimate(f: FormFigure): { estimated: number; low: number; high: number } | null {
  const total = SAMPLE_GROUPS.reduce((n, g) => n + (f.groups[g]?.estimated ?? 0), 0);
  const w = f.groups.waiting;
  if (!w || total <= 0) return null;
  return { estimated: Math.round(w.estimated), low: Math.round(w.low * total), high: Math.round(w.high * total) };
}

/** One row per receipt month holding `form`, newest first: what the month table shows. */
export function monthRows(doc: SampleMonthsDoc, form: string): MonthRow[] {
  return monthFigures(doc, form).map(({ month, figure: f, walked }) => ({
    month,
    counted: f.counted,
    approved: f.groups.approved,
    rfe: f.groups.rfe,
    waiting: f.groups.waiting,
    pending: pendingEstimate(f),
    walked,
  }));
}

/** One receipt month's decided share for a form (scripts/ingest_uscis_sample.py reached_by_month), with its range. */
export interface DecidedMonth {
  month: string;
  counted: number;
  decided: number;
  low: number;
  high: number;
}

/** perm_docs 'uscis_sample_reached': each form's newest receipt months, oldest first. */
export interface SampleReachedDoc {
  as_of: string;
  forms: Record<string, DecidedMonth[]>;
}

/**
 * How far USCIS has got with a form, by receipt month: the newest month whose cases our sample checked are at least
 * half decided (at least `min` of them), and the month after it. Shares, never counts, so a month the walk happened
 * to check in full weighs no more than one it sampled. Null when no month is half decided.
 */
export function decidedThrough(doc: SampleReachedDoc, form: string, min = 30): { reached: DecidedMonth; next: DecidedMonth | null } | null {
  const rows = [...(doc.forms[form] ?? [])].sort((a, b) => a.month.localeCompare(b.month));
  let at = -1;
  rows.forEach((r, i) => {
    if (r.counted >= min && r.decided >= 0.5) at = i;
  });
  if (at < 0) return null;
  return { reached: rows[at]!, next: rows[at + 1] ?? null };
}

/** The online blocks whose cases were received in a month (from each block's received dates), first and last. */
export function blocksInMonth(doc: { by_block: Record<string, BlockFigures> }, month: string): [string, string] | null {
  const start = `${month}-01`;
  const end = `${month}-31`;
  const hits = Object.keys(doc.by_block)
    .filter((b) => {
      const f = doc.by_block[b];
      const from = f?._received_from;
      const to = f?._received_to;
      return typeof from === "string" && typeof to === "string" && from <= end && to >= start;
    })
    .sort();
  return hits.length ? [hits[0]!, hits[hits.length - 1]!] : null;
}

export interface SampleMonth {
  month: string;
  counted: number;
  approved: GroupFigure;
}

/**
 * A form's newest months that have ended, newest first, each with the cases the sample holds of it: the small figure
 * the form and center pages show (Batch 8). The month the sample is dated in is still filling, so it's left out. A
 * month with few cases still shows, its margin and count beside it, never hidden (the owner's call, Nov 25 2026).
 */
export function newestCompleteMonths(doc: SampleMonthsDoc, form: string, n = 3): SampleMonth[] {
  const filling = doc.as_of.slice(0, 7);
  return monthRows(doc, form)
    .filter((r) => r.month < filling)
    .slice(0, n)
    .map((r) => ({ month: r.month, counted: r.counted, approved: r.approved }));
}

/**
 * Whether a typed receipt shows the last status the sample saw for that exact number. On since Nov 25 2026, when the
 * Privacy Policy gained "Our sample of USCIS cases" (section 18), which describes this display.
 */
export const RECEIPT_LAST_STATUS_SHOWN = true;

/** A sample group's word and its colour on the site's one status code (certified green, denied red, waiting yellow, withdrawn purple). */
export const SAMPLE_GROUP_WORD: Record<string, string> = {
  approved: "Approved",
  denied: "Denied",
  revoked: "Revoked",
  rejected: "Rejected as filed",
  withdrawn: "Withdrawn",
  rfe: "Evidence request",
  waiting: "Waiting",
  closed: "Closed",
  decided: "Decided",
  other: "Other",
};

export const SAMPLE_GROUP_TINT: Record<string, CaseStatusTint> = {
  approved: "good",
  denied: "bad",
  revoked: "bad",
  rejected: "bad",
  withdrawn: "withdrawn",
  rfe: "wait",
  waiting: "wait",
  closed: "flat",
  decided: "flat",
  other: "flat",
};

/** How many of `rows` sit in each group, the groups in the order SAMPLE_GROUP_WORD names them, empty ones left out. */
export function groupCounts(rows: readonly { grp: string }[]): { grp: string; n: number }[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.grp, (n.get(r.grp) ?? 0) + 1);
  return Object.keys(SAMPLE_GROUP_WORD)
    .filter((g) => n.get(g))
    .map((g) => ({ grp: g, n: n.get(g) ?? 0 }))
    .concat([...n].filter(([g]) => !(g in SAMPLE_GROUP_WORD)).map(([g, k]) => ({ grp: g, n: k })));
}

/** The rows per page a block's list of numbers offers, the first being the default. */
export const BLOCK_NUMBERS_PER = [25, 50, 100] as const;

/** The block card's outcome groups, in the site's one status code. "other" gathers the rarer decisions. */
export const BLOCK_MIX_GROUPS = [
  { key: "approved", label: "Approved", fill: "bg-chart-green", from: ["approved"] },
  { key: "denied", label: "Denied", fill: "bg-chart-red", from: ["denied"] },
  { key: "rfe", label: "Evidence request", fill: "bg-chart-orange", from: ["rfe"] },
  { key: "withdrawn", label: "Withdrawn", fill: "bg-chart-purple", from: ["withdrawn"] },
  { key: "other", label: "Other outcomes", fill: "bg-chart-sage", from: ["closed", "rejected", "revoked", "decided", "other"] },
  { key: "waiting", label: "Waiting", fill: "bg-chart-yellow", from: ["waiting"] },
] as const;

export interface BlockMixGroup {
  key: (typeof BLOCK_MIX_GROUPS)[number]["key"];
  label: string;
  fill: string;
  n: number;
  share: number;
  /** What the group holds, each named as SAMPLE_GROUP_WORD names it, with its count (the tooltip's lines). */
  parts: [string, number][];
}

export interface BlockMix {
  total: number;
  groups: BlockMixGroup[];
  /** The waiting cases by the step USCIS's page names, largest first; the rarer steps together, last. */
  waiting: { label: string; n: number; share: number }[];
}

/** The waiting steps people ask about, by USCIS's own words; any other waiting status counts under "Other waiting steps". */
const WAITING_STEPS: [RegExp, string][] = [
  [/currently processing|actively reviewed/i, "Being processed"],
  [/^case was received(?! at another)/i, "Received"],
  [/^interview was scheduled/i, "Interview scheduled"],
  [/^response to uscis'? request for evidence was received/i, "Evidence sent back"],
];
const OTHER_STEPS = "Other waiting steps";

/**
 * One block's status mix from every case the sample holds there, each at its newest status: the outcome groups (empty
 * ones left out) and the waiting steps, each a share of the block's cases. Counts may arrive as strings (libSQL).
 */
export function blockStatusMix(rows: readonly { grp: string; status: string; n: number }[]): BlockMix {
  const byGrp = new Map<string, number>();
  const steps = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (n <= 0) continue;
    total += n;
    byGrp.set(r.grp, (byGrp.get(r.grp) ?? 0) + n);
    if (r.grp === "waiting") {
      const step = WAITING_STEPS.find(([re]) => re.test(r.status))?.[1] ?? OTHER_STEPS;
      steps.set(step, (steps.get(step) ?? 0) + n);
    }
  }
  if (!total) return { total: 0, groups: [], waiting: [] };
  const known = new Set<string>(BLOCK_MIX_GROUPS.flatMap((g) => [...g.from]));
  const groups: BlockMixGroup[] = [];
  for (const g of BLOCK_MIX_GROUPS) {
    const from: string[] = [...g.from];
    // A group the kit adds later is counted with the rarer decisions, so the total always adds up.
    if (g.key === "other") from.push(...[...byGrp.keys()].filter((k) => !known.has(k)));
    const parts = from.flatMap((k): [string, number][] => (byGrp.get(k) ? [[SAMPLE_GROUP_WORD[k] ?? k, byGrp.get(k) ?? 0]] : []));
    const n = parts.reduce((s, [, k]) => s + k, 0);
    if (n) groups.push({ key: g.key, label: g.label, fill: g.fill, n, share: n / total, parts });
  }
  const waiting = [...steps]
    .filter(([label]) => label !== OTHER_STEPS)
    .sort((a, b) => b[1] - a[1])
    .concat(steps.has(OTHER_STEPS) ? [[OTHER_STEPS, steps.get(OTHER_STEPS) ?? 0]] : [])
    .map(([label, n]) => ({ label, n, share: n / total }));
  return { total, groups, waiting };
}

/** A receipt block's numbers, 00000 to 99999. */
const BLOCK_NUMBERS = 100_000;

/**
 * Whether every number in a block was checked, or how much of it: the larger of the census's walked share (from the
 * estimate) and the block's own count of numbers with an answer, so a block walked out of the census's order counts.
 */
export interface BlockCoverage {
  every: boolean;
  walkedShare: number;
  /** Numbers of the block with an answer, when the kit counted them. */
  checked?: number;
  /** The days its cases were received, from USCIS's own words (the middle 90% of the dated ones). */
  received?: { from: string; to: string };
}

export function blockCoverage(figures: BlockFigures | undefined): BlockCoverage {
  const walked = figures && typeof figures._walked_share === "number" ? figures._walked_share : 0;
  const count = figures && typeof figures._checked === "number" ? figures._checked : undefined;
  const checked = count !== undefined ? Math.min(1, count / BLOCK_NUMBERS) : 0;
  const w = Math.max(walked, checked);
  const from = figures?._received_from;
  const to = figures?._received_to;
  return {
    every: w >= 0.9995,
    walkedShare: w,
    ...(count !== undefined ? { checked: count } : {}),
    ...(typeof from === "string" && typeof to === "string" ? { received: { from, to } } : {}),
  };
}

/** A received range in words: "April 3 to 10, 2026", "February 26 to March 5, 2026", or across years in full. */
export function receivedSpan(r: { from: string; to: string }): string {
  const [fy, fm, fd] = r.from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = r.to.split("-").map(Number) as [number, number, number];
  const month = (m: number) => MONTH_NAMES[m - 1] ?? "";
  if (r.from === r.to) return `${month(fm)} ${fd}, ${fy}`;
  if (fy !== ty) return `${month(fm)} ${fd}, ${fy} to ${month(tm)} ${td}, ${ty}`;
  if (fm !== tm) return `${month(fm)} ${fd} to ${month(tm)} ${td}, ${ty}`;
  return `${month(fm)} ${fd} to ${td}, ${ty}`;
}

/** A block and the n blocks either side of it, in order (none below IOE00000). */
export function blockRange(block: string, n: number): string[] {
  const k = Number(block.slice(3));
  const out: string[] = [];
  for (let i = Math.max(0, k - n); i <= k + n; i++) out.push(`${block.slice(0, 3)}${String(i).padStart(5, "0")}`);
  return out;
}

/**
 * The block in one line to paste into a chat: its cases (one form's, when one is chosen), each group's share, and the
 * page's address typed out, opening on that form.
 */
export function blockShareLine(
  block: string,
  asOf: string,
  mix: BlockMix,
  coverage: { every: boolean; received?: { from: string; to: string } },
  form?: { key: string; label: string },
): string {
  const when = formatAsOf(asOf) ?? asOf;
  const got = coverage.received ? `received about ${receivedSpan(coverage.received)}, ` : "";
  const head = `${got}${coverage.every ? `every number checked by ${when}` : `the cases checked by ${when}`}`;
  const words = form ? BLOCK_FORM_WORDS[form.key] : undefined;
  const which = form && form.key !== "all" ? `${form.key}${words ? ` (${words})` : ""} cases, ` : "";
  const parts = mix.groups.map((g, i) => `${i === 0 ? g.label : g.label.toLowerCase()} ${formatShareOf(g.n, mix.total)}`);
  const hash = form && form.key !== "all" ? `#form=${form.key}` : "";
  return `${block}, ${which}${head}: ${mix.total.toLocaleString("en-US")} cases. ${parts.join(", ")}. permtracker.app/uscis-receipt-blocks/${block}${hash}`;
}

/** Each form as people know it, beside its number on a block's card (the forms a block holds most). */
export const BLOCK_FORM_WORDS: Record<string, string> = {
  "I-765": "work permit",
  "I-485": "green card",
  "I-131": "travel document",
  "I-130": "family petition",
  "I-140": "worker petition",
  "I-129": "work visa petition",
  "I-90": "green card renewal",
  "N-400": "citizenship",
  "I-751": "removing conditions",
  "I-539": "extending a stay",
  "I-129F": "fiancé petition",
  "I-821D": "DACA",
  "I-131A": "travel document abroad",
  "I-601A": "waiver",
  "I-526E": "investor petition",
  "I-589": "asylum",
  "I-360": "special immigrant petition",
  "N-600": "citizenship certificate",
  "I-824": "action on an approval",
};

/** A form needs this many cases in a block for its own choice; fewer stay inside every form together. */
export const BLOCK_FORM_MIN = 30;

export interface BlockFormChoice {
  /** "all", or the form's number ("I-765"). */
  key: string;
  label: string;
  mix: BlockMix;
}

/** A block's choices for its card: every form together first, then each form with BLOCK_FORM_MIN cases, most first. */
export function blockFormChoices(byForm: Record<string, readonly { grp: string; status: string; n: number }[]>): BlockFormChoice[] {
  const all = blockStatusMix(Object.values(byForm).flat());
  const forms = Object.entries(byForm)
    .filter(([form]) => form !== "")
    .map(([form, rows]) => ({ key: form, label: BLOCK_FORM_WORDS[form] ? `${form}, ${BLOCK_FORM_WORDS[form]}` : form, mix: blockStatusMix(rows) }))
    .filter((c) => c.mix.total >= BLOCK_FORM_MIN)
    .sort((a, b) => b.mix.total - a.mix.total || a.key.localeCompare(b.key));
  return [{ key: "all", label: "All forms", mix: all }, ...forms];
}
