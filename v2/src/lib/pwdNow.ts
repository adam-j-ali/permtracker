/**
 * The wage-request page's cards, from our own daily check of DOL's case
 * status (perm_docs['pwd_day_queue'], written by the PWD sweep): whether DOL
 * is keeping up with new requests, how requests end, and what DOL did each
 * day. Plain module so the unit project tests it; the page reads the document
 * through src/lib/db/pwdDayQueue.ts.
 *
 * Every count is PERM wage requests (P-100 numbers DOL tags PERM or leaves
 * untagged), the line DOL's PERM processing time describes.
 */

export interface PwdQueueDay {
  date: string;
  /** Requests that left IN PROCESS that day, each once. */
  n: number;
  issued?: number;
  withdrawn?: number;
  other?: number;
  /** Requests DOL asked for more information that day. */
  rfi?: number;
}

export interface PwdQueueDoc {
  asOf: string;
  days: PwdQueueDay[];
  filedByDay: [string, number][];
  mix?: { filedSince: string; byStatus: Record<string, number> };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The document, or null when it's missing or has no days to read. */
export function parsePwdQueueDoc(json: string | null): PwdQueueDoc | null {
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw.asOf !== "string" || !DAY.test(raw.asOf) || !Array.isArray(raw.days)) return null;
  const days: PwdQueueDay[] = [];
  for (const d of raw.days as unknown[]) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    if (typeof r.date !== "string" || !DAY.test(r.date) || typeof r.n !== "number") continue;
    const num = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : undefined);
    days.push({ date: r.date, n: r.n, issued: num("issued"), withdrawn: num("withdrawn"), other: num("other"), rfi: num("rfi") });
  }
  const filedByDay: [string, number][] = [];
  if (Array.isArray(raw.filedByDay)) {
    for (const r of raw.filedByDay as unknown[]) {
      if (Array.isArray(r) && typeof r[0] === "string" && DAY.test(r[0]) && Number.isFinite(Number(r[1]))) {
        filedByDay.push([r[0], Number(r[1])]);
      }
    }
  }
  let mix: PwdQueueDoc["mix"];
  const m = raw.mix as { filedSince?: unknown; byStatus?: unknown } | undefined;
  if (m && typeof m.filedSince === "string" && m.byStatus && typeof m.byStatus === "object") {
    const byStatus: Record<string, number> = {};
    for (const [k, v] of Object.entries(m.byStatus as Record<string, unknown>)) {
      if (typeof v === "number" && v > 0) byStatus[k] = v;
    }
    mix = { filedSince: m.filedSince, byStatus };
  }
  if (days.length === 0) return null;
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { asOf: raw.asOf, days, filedByDay, ...(mix ? { mix } : {}) };
}

export interface FlowSpan {
  /** First and last day counted (ISO). */
  from: string;
  to: string;
  /** Requests that left the line: DOL decided them, or the employer withdrew them. */
  out: number;
  issued: number | null;
  withdrawn: number | null;
  /** New requests filed on those days. */
  filed: number;
}

/**
 * Out of the line against new requests, for the newest day DOL worked and for
 * the newest seven days. A day DOL didn't work (a weekend, a holiday) has few
 * of either, so the day view takes the newest day with any exits.
 */
export function catchingUp(doc: PwdQueueDoc): { day: FlowSpan; week: FlowSpan } | null {
  const filed = new Map(doc.filedByDay);
  const worked = [...doc.days].reverse().find((d) => d.n > 0);
  if (!worked) return null;
  const span = (days: PwdQueueDay[]): FlowSpan => {
    const split = days.every((d) => d.issued !== undefined && d.withdrawn !== undefined);
    return {
      from: days[0]!.date,
      to: days[days.length - 1]!.date,
      out: days.reduce((a, d) => a + d.n, 0),
      issued: split ? days.reduce((a, d) => a + (d.issued ?? 0), 0) : null,
      withdrawn: split ? days.reduce((a, d) => a + (d.withdrawn ?? 0), 0) : null,
      filed: days.reduce((a, d) => a + (filed.get(d.date) ?? 0), 0),
    };
  };
  const week = doc.days.slice(-7);
  return { day: span([worked]), week: span(week) };
}

/** "Gaining ground: 88 more out than in", or the opposite, or level. */
export function flowVerdict(f: FlowSpan): { tone: "good" | "bad" | "flat"; text: string } {
  const gap = f.out - f.filed;
  if (gap > 0) return { tone: "good", text: `Gaining ground: ${gap.toLocaleString("en-US")} more left the line than joined it` };
  if (gap < 0) return { tone: "bad", text: `Losing ground: ${(-gap).toLocaleString("en-US")} more joined the line than left it` };
  return { tone: "flat", text: "Holding steady: as many left the line as joined it" };
}

/** How the statuses group. Any status not named here counts as "other". */
const ISSUED = new Set([
  "DETERMINATION ISSUED",
  "REDETERMINATION AFFIRMED",
  "REDETERMINATION MODIFIED",
  "CENTER DIRECTOR REVIEW AFFIRMED DETERMINATION",
  "CENTER DIRECTOR REVIEW MODIFIED DETERMINATION",
  "BALCA AFFIRMED",
  "BALCA OVERTURNED",
]);
const WAITING = new Set(["IN PROCESS", "PENDING REDETERMINATION", "PENDING CENTER DIRECTOR REVIEW", "PENDING BALCA"]);

export interface OutcomeMix {
  filedSince: string;
  waiting: number;
  rfi: number;
  issued: number;
  withdrawn: number;
  /** Returned unprocessed, denied, dismissed, anything else final. */
  other: number;
  /** The requests that ended, and the shares of them. */
  closed: number;
  issuedShare: number | null;
  withdrawnShare: number | null;
}

export function outcomeMix(doc: PwdQueueDoc): OutcomeMix | null {
  if (!doc.mix) return null;
  let waiting = 0;
  let rfi = 0;
  let issued = 0;
  let withdrawn = 0;
  let other = 0;
  for (const [status, n] of Object.entries(doc.mix.byStatus)) {
    const s = status.toUpperCase();
    if (s === "RFI ISSUED") rfi += n;
    else if (WAITING.has(s)) waiting += n;
    else if (ISSUED.has(s)) issued += n;
    else if (s === "WITHDRAWN") withdrawn += n;
    else other += n;
  }
  const closed = issued + withdrawn + other;
  if (closed + waiting + rfi === 0) return null;
  return {
    filedSince: doc.mix.filedSince,
    waiting,
    rfi,
    issued,
    withdrawn,
    other,
    closed,
    issuedShare: closed > 0 ? issued / closed : null,
    withdrawnShare: closed > 0 ? withdrawn / closed : null,
  };
}

/** One month of a wait trend (build_wait_trends.py). */
export interface WaitMonth {
  m: string;
  n: number;
  p25: number;
  p50: number;
  p75: number;
  from: "files" | "sweep";
  partial?: boolean;
}

export interface WaitTrend {
  asOf: string;
  filesThrough: string;
  months: WaitMonth[];
}

const MONTH = /^\d{4}-\d{2}$/;

export function parseWaitTrend(json: string | null): WaitTrend | null {
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw.asOf !== "string" || typeof raw.filesThrough !== "string" || !Array.isArray(raw.months)) return null;
  const months: WaitMonth[] = [];
  for (const r of raw.months as unknown[]) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.m !== "string" || !MONTH.test(o.m)) continue;
    const nums = ["n", "p25", "p50", "p75"].map((k) => o[k]);
    if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    months.push({
      m: o.m,
      n: o.n as number,
      p25: o.p25 as number,
      p50: o.p50 as number,
      p75: o.p75 as number,
      from: o.from === "sweep" ? "sweep" : "files",
      ...(o.partial === true ? { partial: true } : {}),
    });
  }
  if (months.length < 2) return null;
  months.sort((a, b) => (a.m < b.m ? -1 : 1));
  return { asOf: raw.asOf, filesThrough: raw.filesThrough, months };
}

/** The newest whole month against the same month a year before, when both are there. */
export function yearOnYear(t: WaitTrend): { now: WaitMonth; then: WaitMonth } | null {
  const whole = t.months.filter((m) => !m.partial);
  const now = whole[whole.length - 1];
  if (!now) return null;
  const [y, mo] = now.m.split("-");
  const then = whole.find((m) => m.m === `${Number(y) - 1}-${mo}`);
  return then ? { now, then } : null;
}

/**
 * Is it getting faster? The newest whole month's median wait against the same month a year before. Within 5% of
 * that median reads as about the same: a few days either way on a wait of months is not a trend a reader should
 * act on. `answer` leads a "Is it getting faster?" heading; `short` stands alone.
 */
export function speedVerdict(yoy: { now: WaitMonth; then: WaitMonth }): {
  tone: "good" | "bad" | "flat";
  answer: string;
  short: string;
} {
  const days = yoy.then.p50 - yoy.now.p50;
  const n = Math.abs(days).toLocaleString("en-US");
  if (Math.abs(days) <= yoy.then.p50 * 0.05) {
    return { tone: "flat", answer: "About the same as a year ago.", short: "About the same as a year ago" };
  }
  return days > 0
    ? { tone: "good", answer: `Yes: ${n} days faster than a year ago.`, short: `${n} days faster than a year ago` }
    : { tone: "bad", answer: `No: ${n} days slower than a year ago.`, short: `${n} days slower than a year ago` };
}

export type SeriesMonth = { m: string; gap: true } | (WaitMonth & { gap?: false });

/** Every month from the first to the last, a month with no reading marked as a gap (never drawn as zero). */
export function monthSeries(t: WaitTrend): SeriesMonth[] {
  const by = new Map(t.months.map((m) => [m.m, m]));
  const out: SeriesMonth[] = [];
  const first = t.months[0]!.m;
  const last = t.months[t.months.length - 1]!.m;
  let [y, mo] = first.split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    const got = by.get(key);
    out.push(got ? got : { m: key, gap: true });
    if (key === last) break;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return out;
}

export interface WaitWindow {
  /** "fy2015", the window's first fiscal year: unique within a trend, for a tab's id. */
  id: string;
  /** "FY2015 to FY2017", or "Since FY2024" for the newest. */
  label: string;
  /** Its months, gaps included, oldest first. */
  months: SeriesMonth[];
  newest: boolean;
}

/** A month's federal fiscal year: October starts the next one. */
const fiscalYearOf = (m: string) => Number(m.slice(0, 4)) + (Number(m.slice(5, 7)) >= 10 ? 1 : 0);

// Three fiscal years a window, on fixed edges (FY2015 to FY2017, FY2018 to FY2020 and so on), so a window's years
// never move as months are added.
const WINDOW_YEARS = 3;
const WINDOW_EDGE_FY = 2015;
// A newest window under a year joins the one before it, so the first view always holds a year-earlier month.
const MIN_NEWEST_MONTHS = 12;

/**
 * A long monthly series cut into windows of three fiscal years, newest first. One column a month with 3px gaps
 * runs off a 375px phone past about a hundred months, and the PERM trend from FY2015 is about 145; a window holds
 * 47 at most (a newest window under a year joins the one before it).
 */
export function waitWindows(series: readonly SeriesMonth[]): WaitWindow[] {
  const groups = new Map<number, SeriesMonth[]>();
  for (const m of series) {
    const g = Math.floor((fiscalYearOf(m.m) - WINDOW_EDGE_FY) / WINDOW_YEARS);
    const list = groups.get(g);
    if (list) list.push(m);
    else groups.set(g, [m]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => ms);
  if (ordered.length > 1 && ordered[ordered.length - 1]!.length < MIN_NEWEST_MONTHS) {
    const last = ordered.pop()!;
    ordered[ordered.length - 1]!.push(...last);
  }
  return ordered
    .map((months, i) => {
      const newest = i === ordered.length - 1;
      const from = fiscalYearOf(months[0]!.m);
      const to = fiscalYearOf(months[months.length - 1]!.m);
      const label = newest ? `Since FY${from}` : from === to ? `FY${from}` : `FY${from} to FY${to}`;
      return { id: `fy${from}`, label, months, newest };
    })
    .reverse();
}
