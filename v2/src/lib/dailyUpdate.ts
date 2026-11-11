/**
 * One DOL day, summed up: how many cases ended each way, and which filing days the certified ones came from.
 *
 * The daily page (/perm-updates) and its line for pasting into a chat are both built from this, so the page's
 * figures and the sentence a reader shares can't disagree.
 *
 * A PERM DAY IS COUNTED THE WAY THE DAILY SERIES COUNTS IT. The homepage and the activity page print each day's
 * certified, denied and withdrawn from `daily_decisions`, which the ingest fills by its DECISION_BUCKETS: a move
 * into a status that ends the case, bucketed by that status, with a certification's own lapse (CERTIFIED to
 * CERTIFIED - EXPIRED) left out because that's a clock running out. `PERM_BUCKETS` below is the same table, and
 * scripts/fixtures/decision_buckets.json holds both sides to it. So this page can't give Tuesday a different
 * number from the one the homepage gives it.
 *
 * The other programs end well by `isProgramApproval`, their own rule. A letter asking the employer for something
 * is the status table's "action" kind.
 *
 * "8 IN 10" IS THE MIDDLE OF THE FILING DAYS. On Nov 10 2026 DOL certified 766 cases filed between Dec 5 2024 and
 * Feb 26 2026, and 8 in 10 of them were filed inside seven weeks. The whole span says where the stragglers are;
 * the middle says where DOL is working. It's given only for ten dated cases or more.
 */

// One line, deliberately: no-server-only-in-client.test.ts checks each import line on its own.
import type { CaseChange } from "@/lib/db/changes";
import type { ChangeProgram } from "@/lib/changeProgram";
import { canonicalStatus } from "@/lib/caseStatusVocabulary";
import { isProgramApproval } from "@/lib/flagCaseNumber";
import { getStatusMeaning } from "@/lib/permStatus";
import { formatInt } from "@/lib/format";
import type { ActivityDay } from "@/lib/activityStats";
import { isDolWorkday } from "@/lib/pulseStats";
import type { DayCase } from "@/lib/filingDay";
import type { FigureTrend } from "@/components/data/FigureRow";

type Outcome = "certified" | "denied" | "withdrawn";

/** How a PERM status that ends a case is counted. The ingest's DECISION_BUCKETS, status for status. */
export const PERM_BUCKETS: Readonly<Record<string, Outcome>> = {
  CERTIFIED: "certified",
  "CERTIFIED - EXPIRED": "certified",
  "CERTIFIED-EXPIRED": "certified",
  DENIED: "denied",
  "DENIED - BALCA DISMISSED": "denied",
  "DENIED - BALCA AFFIRMED": "denied",
  WITHDRAWN: "withdrawn",
};

/** A certification's own lapse: DOL relabels it when the 180 days run out. Never a decision. */
export const EXPIRY = { from: "CERTIFIED", to: "CERTIFIED - EXPIRED" } as const;

/** Which way a move ended the case, or null when it didn't end it. */
function outcomeOf(program: ChangeProgram, from: string, to: string): Outcome | null {
  if (program === "perm") return from === EXPIRY.from && to === EXPIRY.to ? null : (PERM_BUCKETS[to] ?? null);
  if (isProgramApproval(program, to)) return "certified";
  return to === "DENIED" ? "denied" : to === "WITHDRAWN" ? "withdrawn" : null;
}

/** The fewest dated certifications "8 in 10" is said of. */
export const CORE_NEEDS = 10;

export interface DailyUpdate {
  /** The DOL day, "YYYY-MM-DD". */
  date: string;
  program: ChangeProgram;
  /** Moves that ended a case approved (PERM: certified). */
  certified: number;
  denied: number;
  withdrawn: number;
  /** Cases DOL sent a letter about: an RFI, an audit, a notice. */
  asked: number;
  /** Every other move: into review, into an appeal, a relabel. */
  other: number;
  /** Moves of this program in the day, however they ended. */
  total: number;
  /** The filing days of the certified cases that carry one. */
  certifiedFiled: { oldest: string; newest: string; n: number } | null;
  /** The middle 8 in 10 of those filing days. Null under CORE_NEEDS dated cases. */
  certifiedCore: { from: string; to: string } | null;
  /** The filing day with the most certifications. */
  busiestFilingDay: { day: string; n: number } | null;
  /** Certifications by filing month, oldest first. */
  certifiedByMonth: { month: string; n: number }[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: string | null): v is string =>
  v !== null && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** One program's moves on one DOL day, counted. Moves of other programs are ignored. */
export function summariseDay(date: string, changes: readonly CaseChange[], program: ChangeProgram = "perm"): DailyUpdate {
  const mine = changes.filter((c) => c.program === program);
  const n = { certified: 0, denied: 0, withdrawn: 0, asked: 0, other: 0 };
  const filed: string[] = [];
  for (const c of mine) {
    const to = canonicalStatus(c.toStatus);
    const outcome = outcomeOf(program, canonicalStatus(c.fromStatus), to);
    if (outcome) {
      n[outcome] += 1;
      if (outcome === "certified" && isDay(c.filingDate)) filed.push(c.filingDate);
    } else if (getStatusMeaning(to)?.kind === "action") n.asked += 1;
    else n.other += 1;
  }
  filed.sort();
  const perDay = new Map<string, number>();
  const perMonth = new Map<string, number>();
  for (const d of filed) {
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    perMonth.set(d.slice(0, 7), (perMonth.get(d.slice(0, 7)) ?? 0) + 1);
  }
  // The busiest day; the newer one on a tie, since that's the one a waiting reader is nearer.
  let busiest: { day: string; n: number } | null = null;
  for (const [day, n] of perDay) if (!busiest || n > busiest.n || (n === busiest.n && day > busiest.day)) busiest = { day, n };

  const first = filed[0];
  const last = filed[filed.length - 1];
  const lo = filed[Math.floor((filed.length - 1) * 0.1)];
  const hi = filed[Math.ceil((filed.length - 1) * 0.9)];

  return {
    date,
    program,
    ...n,
    total: mine.length,
    certifiedFiled: first && last ? { oldest: first, newest: last, n: filed.length } : null,
    certifiedCore: filed.length >= CORE_NEEDS && lo && hi ? { from: lo, to: hi } : null,
    busiestFilingDay: busiest,
    certifiedByMonth: [...perMonth].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, n]) => ({ month, n })),
  };
}

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const weekdayAndDay = (iso: string) => at(iso).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
const monthDay = (iso: string) => at(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
const fullDay = (iso: string) => at(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

/** "January 23 and February 2, 2026", or both years when the two days sit in different ones. */
export function daySpan(from: string, to: string): string {
  return from.slice(0, 4) === to.slice(0, 4) ? `${monthDay(from)} and ${fullDay(to)}` : `${fullDay(from)} and ${fullDay(to)}`;
}

/** Where the day's list lives, as people type it into a chat. */
export const UPDATES_PATH = "/perm-updates";
const SITE = "permtracker.app";

/**
 * The day in one line of plain text, for pasting into a chat. `final` is false while DOL is still working the day
 * (the count can still rise), and the line then says "so far".
 */
export function shareLine(u: DailyUpdate, { final }: { final: boolean }): string {
  const day = weekdayAndDay(u.date);
  const also = [u.denied ? `${formatInt(u.denied)} denied` : null, u.withdrawn ? `${formatInt(u.withdrawn)} withdrawn` : null].filter(Boolean).join(", ");
  const decided = u.certified + u.denied + u.withdrawn;
  if (decided === 0 && final) return `DOL recorded no PERM decision on ${day}. Every day: ${SITE}${UPDATES_PATH}`;

  const link = `Every case: ${SITE}${UPDATES_PATH}/${u.date}`;
  if (u.certified === 0) {
    const lead = final ? `DOL certified no PERM case on ${day}.` : `DOL hasn't certified a PERM case yet on ${day}.`;
    return [lead, also ? `${also[0]!.toUpperCase()}${also.slice(1)}.` : null, link].filter(Boolean).join(" ");
  }

  const cases = `${formatInt(u.certified)} PERM ${u.certified === 1 ? "case" : "cases"}`;
  const lead = final ? `DOL certified ${cases} on ${day}` : `DOL has certified ${cases} so far on ${day}`;
  const f = u.certifiedFiled;
  let filed = ".";
  if (u.certifiedCore) filed = `. 8 in 10 were filed between ${daySpan(u.certifiedCore.from, u.certifiedCore.to)}.`;
  else if (f && f.oldest === f.newest) filed = `, filed ${fullDay(f.oldest)}.`;
  else if (f) filed = `, filed between ${daySpan(f.oldest, f.newest)}.`;
  return [`${lead}${filed}`, also ? `${also[0]!.toUpperCase()}${also.slice(1)}.` : null, link].filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ the page's other parts */

/**
 * A day's moves of one program as rows for the day list: the status each case moved to, and the day it was filed.
 * One row per move, so a case DOL moved twice that day is listed for each (a denial, then its reopening).
 */
export function dayCases(changes: readonly CaseChange[], program: ChangeProgram): DayCase[] {
  return changes
    .filter((c) => c.program === program)
    .map((c) => ({
      caseNumber: c.caseNumber,
      status: canonicalStatus(c.toStatus),
      employer: c.employerName ?? "",
      employerSlug: c.employerSlug,
      jobTitle: c.jobTitle ?? "",
      final: c.isFinal,
      ...(isDay(c.filingDate) ? { filedOn: c.filingDate } : {}),
    }));
}

/** Under this many on a usual day, a percentage overstates: 40 denials against 19 is "21 more", never "111% above". */
export const SMALL_USUAL = 50;

/**
 * A count against its usual, for the chip under a figure: which way, by how much, and whether that's good.
 * Within 5% either way (or one case, for a small count) reads as level. A small usual is compared in cases, a
 * large one in percent. Null when there's no usual, or the usual is zero.
 */
export function trendAgainst(n: number, usual: number | null, weekday: string, upIs: "good" | "bad" | "info"): FigureTrend | null {
  if (usual === null || usual <= 0) return null;
  const diff = n - usual;
  const pct = Math.round((diff / usual) * 100);
  const basis = `a usual ${weekday} (${formatInt(usual)})`;
  const small = usual < SMALL_USUAL;
  if (small ? Math.abs(diff) <= 1 : Math.abs(pct) < 5) return { text: `About ${basis}`, dir: "level", tone: "neutral" };
  const up = diff > 0;
  const tone = upIs === "info" ? "info" : (upIs === "good") === up ? "good" : "bad";
  const text = small ? `${formatInt(Math.abs(diff))} ${up ? "more" : "fewer"} than ${basis}` : `${Math.abs(pct)}% ${up ? "above" : "below"} ${basis}`;
  return { text, dir: up ? "up" : "down", tone };
}

/** A month's share below this is drawn with the other small months, as one row. */
export const MONTH_ROW_FLOOR = 0.02;

/**
 * The filing months to draw: each month holding 2% or more of the day's certifications, oldest first, and the
 * rest added up. On Nov 10 2026 eight months held a certification and four of them held 13 cases of 766 between
 * them; a row each put the three months that matter a screen down on a phone.
 */
export function monthsToDraw(months: DailyUpdate["certifiedByMonth"], total: number): { rows: { month: string; n: number }[]; rest: { n: number; months: number } | null } {
  if (total <= 0) return { rows: [], rest: null };
  const rows = months.filter((m) => m.n / total >= MONTH_ROW_FLOOR);
  const small = months.filter((m) => m.n / total < MONTH_ROW_FLOOR);
  // One small month is its own row: "1 other month" would hide its name for nothing.
  if (small.length <= 1) return { rows: [...months], rest: null };
  return { rows, rest: { n: small.reduce((a, m) => a + m.n, 0), months: small.length } };
}

/** A share of the day as a reader says it: "55%", and "under 1%" where rounding would print 0%. */
export function shareLabel(n: number, total: number): string {
  if (total <= 0 || n <= 0) return "0%";
  const pct = Math.round((n / total) * 100);
  return pct < 1 ? "under 1%" : `${pct}%`;
}

/**
 * The `n` days before `date` worth a link, newest first: DOL's working days with a decision, and a weekend or a
 * holiday only when DOL certified something on it (an employer's own withdrawal on a Saturday isn't DOL's day).
 */
export function daysBefore(series: readonly ActivityDay[], date: string, n = 10): ActivityDay[] {
  return series
    .filter((d) => d.date < date && (isDolWorkday(d.date) ? d.total > 0 : d.certified > 0))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}
