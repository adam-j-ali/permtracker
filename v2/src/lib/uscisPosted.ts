/**
 * USCIS's processing-times page as posted, every posting since March 2022: the pure half.
 *
 * `scripts/ingest_uscis_posted_times.py` writes `perm_docs['uscis_posted_times']` from the daily copies an
 * open-source project keeps of USCIS's page (the script says why and how). Every figure is USCIS's, dated by USCIS's
 * own posting date; the site's typed figures (`i140ProcessingTimes.ts`) are the fallback when the doc is missing or
 * older than USCIS's own longest gap between postings allows.
 */

import { formatAsOf } from "@/lib/dolFormat";
import { MS_PER_DAY } from "../../convex/lib/time";
import { getI140ProcessingTime, PROCESSING_TIMES_AS_OF, type I140Category, type I140Subtype } from "@/lib/processing-times/i140ProcessingTimes";

export interface PostedRow {
  form: string;
  subtype: string;
  office: string;
  /** Months, the figure USCIS's page prints; null where it prints a note instead. */
  posted: number | null;
  postedText: string | null;
  /** The receipt date before which a case may ask USCIS about itself. */
  requestDate: string | null;
  label: string | null;
  officeLabel: string | null;
}

export interface PostedSeries {
  form: string;
  subtype: string;
  office: string;
  label: string | null;
  officeLabel: string | null;
  /** [USCIS's posting date, months], oldest first. */
  points: [string, number][];
}

export interface UscisPosted {
  /** USCIS's newest posting date (ISO). */
  published: string;
  postings: string[];
  newest: PostedRow[];
  series: PostedSeries[];
  /** The longest gap between two postings since 2022, in days. */
  longestGapDays: number | null;
  project: string;
}

/** The office USCIS posts every I-140 subtype under since Sep 5 2025 (the Nebraska and Texas centers before). */
export const I140_OFFICE = "SCD";
/** USCIS posts about monthly; past this many days without a posting, the typed figures stand in. */
const FLOOR_FRESH_DAYS = 75;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseUscisPosted(json: string): UscisPosted | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(raw) || typeof raw.published !== "string" || !ISO.test(raw.published)) return null;
  const newest: PostedRow[] = (Array.isArray(raw.newest) ? raw.newest : []).filter(isObj).flatMap((r) => {
    const form = str(r.form);
    const subtype = str(r.subtype);
    const office = str(r.office);
    if (!form || !subtype || !office) return [];
    return [{ form, subtype, office, posted: num(r.posted), postedText: str(r.postedText),
      requestDate: typeof r.requestDate === "string" && ISO.test(r.requestDate) ? r.requestDate : null,
      label: str(r.label), officeLabel: str(r.officeLabel) }];
  });
  const series: PostedSeries[] = (Array.isArray(raw.series) ? raw.series : []).filter(isObj).flatMap((s) => {
    const form = str(s.form);
    const subtype = str(s.subtype);
    const office = str(s.office);
    if (!form || !subtype || !office) return [];
    const points = (Array.isArray(s.points) ? s.points : []).flatMap((p): [string, number][] =>
      Array.isArray(p) && typeof p[0] === "string" && ISO.test(p[0]) && num(p[1]) !== null ? [[p[0], p[1] as number]] : []);
    return [{ form, subtype, office, label: str(s.label), officeLabel: str(s.officeLabel), points }];
  });
  const postings = (Array.isArray(raw.postings) ? raw.postings : []).filter((d): d is string => typeof d === "string" && ISO.test(d));
  return { published: raw.published, postings, newest, series, longestGapDays: num(raw.longestGapDays),
    project: str(raw.project) ?? "https://github.com/jzebedee/uscis" };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Whether the newest posting is recent enough to stand for "now": USCIS's longest gap so far, with room. */
export function isCurrent(doc: UscisPosted, today: string): boolean {
  const allowed = Math.max(FLOOR_FRESH_DAYS, Math.round((doc.longestGapDays ?? 0) * 1.5));
  return daysBetween(doc.published, today) <= allowed;
}

/** "136A-E21" -> "E21": the subtype code the typed figures and USCIS's labels use. */
export const i140Code = (subtype: string) => subtype.split("-").pop() ?? subtype;

export interface I140Figures {
  subtypes: I140Subtype[];
  /** USCIS's posting date when the figures are posted ones, else the day they were last read by hand. */
  asOf: string;
  /** "posted": USCIS's own posting, from the daily copies; "read": the typed fallback. */
  from: "posted" | "read";
}

const CATEGORIES: I140Category[] = ["EB-1", "EB-2", "EB-2-NIW", "EB-3"];

/**
 * The I-140 subtypes with USCIS's newest posted figure in place of the typed one, when the doc is current. A
 * subtype the posting lacks, or prints only a note for, keeps its typed figure; when none can be taken, every one
 * does, with the day it was read.
 */
export function i140Figures(doc: UscisPosted | null, today: string): I140Figures {
  const typed = CATEGORIES.flatMap((c) => getI140ProcessingTime(c)?.subtypes ?? []);
  if (!doc || !isCurrent(doc, today)) return { subtypes: typed, asOf: PROCESSING_TIMES_AS_OF, from: "read" };
  const posted = new Map(
    doc.newest.filter((r) => r.form === "I-140" && r.office === I140_OFFICE && r.posted !== null).map((r) => [i140Code(r.subtype), r.posted as number]),
  );
  if (posted.size === 0) return { subtypes: typed, asOf: PROCESSING_TIMES_AS_OF, from: "read" };
  return {
    subtypes: typed.map((s) => (posted.has(s.code) ? { ...s, months80: posted.get(s.code) as number } : s)),
    asOf: doc.published,
    from: "posted",
  };
}

/** Each I-140 subtype's line at Service Center Operations, in the typed order, with at least two postings. */
export function i140Series(doc: UscisPosted | null): (PostedSeries & { code: string; name: string })[] {
  if (!doc) return [];
  const typed = CATEGORIES.flatMap((c) => getI140ProcessingTime(c)?.subtypes ?? []);
  return typed.flatMap((t) => {
    const s = doc.series.find((x) => x.form === "I-140" && x.office === I140_OFFICE && i140Code(x.subtype) === t.code);
    return s && s.points.length >= 2 ? [{ ...s, code: t.code, name: t.label }] : [];
  });
}

/** One category of a form, as USCIS's newest posting prints it. */
export interface PostedCategory {
  subtype: string;
  /** USCIS's own name for the category, or its code where the posting gave none. */
  label: string;
  /** How many offices USCIS posts this category under. */
  offices: number;
  /** The shortest and the longest posted months across those offices: the same figure where one office posts it. */
  min: number | null;
  max: number | null;
  /** The receipt date before which a case may ask USCIS about itself, where one office posts the category. */
  requestDate: string | null;
  /** USCIS's own words where it prints a note and no figure. */
  note: string | null;
}

/**
 * What USCIS's newest posting says for each category of one form, in the posting's own order. A form's own page
 * prints these beside its quarterly median: the posted figure is the time within which USCIS finished 80% of the
 * cases it decided, by category, which is the question a person with one case is asking.
 */
export function postedByCategory(doc: UscisPosted | null, form: string): PostedCategory[] {
  if (!doc) return [];
  const bySubtype = new Map<string, PostedRow[]>();
  for (const r of doc.newest) {
    if (r.form !== form) continue;
    const held = bySubtype.get(r.subtype);
    if (held) held.push(r);
    else bySubtype.set(r.subtype, [r]);
  }
  return [...bySubtype.entries()].map(([subtype, rows]) => {
    const months = rows.flatMap((r) => (r.posted === null ? [] : [r.posted]));
    const one = rows.length === 1 ? rows[0] : undefined;
    return {
      subtype,
      label: rows.find((r) => r.label)?.label ?? subtype,
      offices: rows.length,
      min: months.length > 0 ? Math.min(...months) : null,
      max: months.length > 0 ? Math.max(...months) : null,
      requestDate: one ? one.requestDate : null,
      note: months.length === 0 ? (rows.find((r) => r.postedText)?.postedText ?? null) : null,
    };
  });
}

/** USCIS's two posted routes for an H-4 spouse's work permit (Form I-765, category (c)(26)), in its own words. */
const H4_ROUTES = [
  { subtype: "147-539C26", key: "with-i539", name: "Filed with the H-4 extension (I-539)" },
  { subtype: "147-C26", key: "alone", name: "Filed on its own" },
] as const;

export interface H4EadTimes {
  published: string;
  rows: { key: string; name: string; months: number; text: string }[];
}

/**
 * The H-4 work permit's two posted times, while USCIS's newest posting is current, else null. USCIS labels them
 * "filed with I-539 H4" and "Standalone; not filed with I-539 H4" (uscis_posted_labels, Nov 4 2026).
 */
export function h4EadTimes(doc: UscisPosted | null, today: string): H4EadTimes | null {
  if (!doc || !isCurrent(doc, today)) return null;
  const rows = H4_ROUTES.flatMap((r) => {
    const row = doc.newest.find((n) => n.form === "I-765" && n.subtype === r.subtype && n.posted !== null);
    return row ? [{ key: r.key, name: r.name, months: row.posted!, text: `${row.posted} months` }] : [];
  });
  return rows.length === H4_ROUTES.length ? { published: doc.published, rows } : null;
}

export interface WaitPapers {
  published: string;
  /** The work permit based on a pending I-485 (I-765 category (c)(9)), at the National Benefits Center when posted. */
  ead: PaperTime | null;
  /** Advance parole (I-131), at the office USCIS posts it under. */
  ap: PaperTime | null;
}

/** One posted row: its months, USCIS's name for the office, and the codes that find its history. */
export interface PaperTime {
  months: number;
  office: string;
  subtype: string;
  code: string;
}

/**
 * The work permit and travel document a pending I-485 waits on, from USCIS's newest posting. Each row is found by what
 * USCIS calls it (the (c)(9) category, "Advance parole"), never by its subtype code alone. USCIS's page prints the
 * lower number of each pair, the `posted` figure: read on USCIS's own page Nov 18 2026 (I-765 (c)(9) at the National
 * Benefits Center 12 months, advance parole at SCOPS 26.5).
 */
export function waitPapers(doc: UscisPosted | null): WaitPapers | null {
  if (!doc) return null;
  const at = (r: PostedRow | undefined): PaperTime | null =>
    r && r.posted !== null ? { months: r.posted, office: r.officeLabel ?? r.office, subtype: r.subtype, code: r.office } : null;
  const ead = doc.newest.filter((r) => r.form === "I-765" && /\(c\)\(9\)/.test(r.label ?? ""));
  const ap = doc.newest.filter((r) => r.form === "I-131" && /^advance parole$/i.test((r.label ?? "").trim()));
  return {
    published: doc.published,
    ead: at(ead.find((r) => r.office === "NBC") ?? ead[0]),
    ap: at(ap.find((r) => r.posted !== null)),
  };
}

export interface OfficeStanding {
  months: number;
  /** Offices posting a strictly shorter time for the same row. */
  shorter: number;
  /** Offices posting a figure for the row, this one included. */
  of: number;
}

/** Where one office's figure stands among every office USCIS posts the same form and category for, newest posting. */
export function officeStanding(doc: UscisPosted | null, form: string, subtype: string, office: string): OfficeStanding | null {
  if (!doc) return null;
  const figures = doc.newest.flatMap((r) => (r.form === form && r.subtype === subtype && r.posted !== null ? [{ office: r.office, months: r.posted }] : []));
  const mine = figures.find((r) => r.office === office);
  if (!mine) return null;
  return { months: mine.months, shorter: figures.filter((r) => r.months < mine.months).length, of: figures.length };
}

export interface YearChange {
  now: number;
  nowOn: string;
  then: number;
  thenOn: string;
}

/** How far from the anniversary the older posting may be: USCIS posts about monthly, so one usually falls inside. */
const YEAR_SLACK_DAYS = 15;

/**
 * The newest posting against the one closest to a year before it, within 15 days of the anniversary; null when no
 * posting falls there (under a year of history, or a long gap such as the Oct 2025 shutdown's).
 */
export function yearChange(points: readonly [string, number][]): YearChange | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
  let then: [string, number] | undefined;
  let off = Infinity;
  for (const p of points) {
    const miss = Math.abs((at(last[0]) - at(p[0])) / MS_PER_DAY - 365);
    if (miss <= YEAR_SLACK_DAYS && miss < off) {
      then = p;
      off = miss;
    }
  }
  return then ? { now: last[1], nowOn: last[0], then: then[1], thenOn: then[0] } : null;
}

/** "up from 9.5 months in its October 20, 2025 posting", for a sentence that already gives the newest figure. */
export function changeWords(c: YearChange): string {
  const on = formatAsOf(c.thenOn) ?? c.thenOn;
  if (c.now === c.then) return `the same as in its ${on} posting`;
  return `${c.now > c.then ? "up" : "down"} from ${c.then} months in its ${on} posting`;
}
