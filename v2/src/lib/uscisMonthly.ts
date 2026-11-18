/**
 * USCIS's monthly report to Congress (`perm_docs['uscis_monthly_forms']`, written by
 * `scripts/ingest_uscis_monthly_forms.py`): each month's receipts, approvals, denials, pending, pending over six
 * months and average processing time for six forms, the I-485 split by basis. The pure half.
 *
 * Its average processing time is months from receipt to completion over everything finished that month, and USCIS's
 * own note says it "may differ from processing times reported on other USCIS.gov webpages": it is never put beside
 * the posted 8-in-10 time as the same measure.
 */

export interface MonthlyPoint {
  month: string;
  received: number | null;
  approved: number | null;
  denied: number | null;
  pending: number | null;
  pending_6mo: number | null;
  avg_months: number | null;
}

export interface MonthlyLine {
  form: string;
  line: string;
  /** The I-485's basis in USCIS's own word ("Employment", "Family"); empty for the other forms. */
  basis: string;
  points: MonthlyPoint[];
}

export interface UscisMonthly {
  newest: string | null;
  months: string[];
  /** Months between the first and the newest that USCIS's listing doesn't carry. */
  missing: string[];
  lines: MonthlyLine[];
  source: string;
}

const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
const figure = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The doc, checked; null when it's missing or not this shape. */
export function parseUscisMonthly(json: string): UscisMonthly | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.lines) || !Array.isArray(d.months)) return null;
  const lines: MonthlyLine[] = [];
  for (const l of d.lines as Record<string, unknown>[]) {
    if (typeof l?.form !== "string" || typeof l.line !== "string" || !Array.isArray(l.points)) continue;
    lines.push({
      form: l.form,
      line: l.line,
      basis: typeof l.basis === "string" ? l.basis : "",
      points: (l.points as Record<string, unknown>[])
        .filter((p) => isMonth(p?.month))
        .map((p) => ({
          month: p.month as string,
          received: figure(p.received),
          approved: figure(p.approved),
          denied: figure(p.denied),
          pending: figure(p.pending),
          pending_6mo: figure(p.pending_6mo),
          avg_months: figure(p.avg_months),
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    });
  }
  return {
    newest: isMonth(d.newest) ? d.newest : null,
    months: (d.months as unknown[]).filter(isMonth),
    missing: Array.isArray(d.missing) ? (d.missing as unknown[]).filter(isMonth) : [],
    lines,
    source: typeof d.source === "string" ? d.source : "USCIS",
  };
}

/** Which line a form's page leads with: the employment-based I-485 on the I-485 page, the one line elsewhere. */
export function leadLine(doc: UscisMonthly | null, form: string): MonthlyLine | null {
  if (!doc) return null;
  const mine = doc.lines.filter((l) => l.form === form);
  if (form === "I-485") return mine.find((l) => l.basis === "Employment") ?? null;
  return mine.length === 1 ? mine[0]! : null;
}

/** Of the cases decided in a month, the share denied; null without both counts or with none decided. */
export function deniedShare(p: MonthlyPoint): number | null {
  if (p.approved === null || p.denied === null) return null;
  const decided = p.approved + p.denied;
  return decided > 0 ? p.denied / decided : null;
}

/**
 * The last `n` months up to the newest, newest first, with a month USCIS's listing doesn't carry as its own row
 * (`point: null`), never left out or drawn as zero.
 */
export function recentMonths(doc: UscisMonthly, line: MonthlyLine, n = 12): { month: string; point: MonthlyPoint | null }[] {
  const newest = doc.newest ?? line.points[line.points.length - 1]?.month;
  if (!newest) return [];
  const byMonth = new Map(line.points.map((p) => [p.month, p]));
  const out: { month: string; point: MonthlyPoint | null }[] = [];
  let y = Number(newest.slice(0, 4));
  let m = Number(newest.slice(5));
  const first = doc.months[0] ?? newest;
  for (let i = 0; i < n; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key < first) break;
    out.push({ month: key, point: byMonth.get(key) ?? null });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}
