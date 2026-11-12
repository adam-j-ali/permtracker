/**
 * PERM decisions and wage determinations, side by side for each day and each week.
 *
 * Two records hold the counts. PERM's is the daily row our check of DOL's case status writes (`daily_decisions`,
 * `sweep-observed`); the wage count is the determinations issued each day in the wage check's document
 * (`perm_docs['pwd_day_queue']`, src/lib/pwdNow.ts). They're written by different jobs at different hours, so a day
 * one of them hasn't reached is NOT COUNTED (null), never zero: a zero would read as "DOL issued nothing".
 *
 * Only complete days are listed. Today's count is still growing, and a part day beside whole ones reads as a drop.
 * Plain module, so the unit project tests it.
 */
import type { ActivityDay } from "@/lib/activityStats";
import type { FigureTrend } from "@/components/data/FigureRow";
import { formatInt } from "@/lib/format";
import type { PwdQueueDay } from "@/lib/pwdNow";
import { MS_PER_DAY } from "@/lib/time";

export interface DolDay {
  /** ISO day, on DOL's clock. */
  date: string;
  /** PERM decisions DOL made that day (certified, denied or withdrawn); null when the record doesn't cover the day. */
  perm: number | null;
  /** Wage determinations DOL issued that day; null when the record doesn't cover the day or doesn't split it. */
  wage: number | null;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** A record's reading for one day: its count, zero for a day inside its range with no row, null outside it. */
function reader(counts: ReadonlyMap<string, number>): (day: string) => number | null {
  const days = [...counts.keys()].sort();
  const first = days[0];
  const last = days[days.length - 1];
  return (day) => counts.get(day) ?? (first !== undefined && last !== undefined && day >= first && day <= last ? 0 : null);
}

/**
 * The newest `n` complete days, newest first, with each record's count. `today` is DOL's day now (Eastern): it and
 * anything after it are left out. The old end is trimmed to the first day either record covers.
 */
export function dolDays(perm: readonly ActivityDay[], wage: readonly PwdQueueDay[], today: string, n = 28): DolDay[] {
  const permCounts = new Map(perm.filter((d) => d.date < today).map((d) => [d.date, d.total]));
  // A wage day whose exits aren't split by kind has no count of determinations: it's left out, never read as zero.
  const wageCounts = new Map(wage.filter((d) => d.date < today && d.issued !== undefined).map((d) => [d.date, d.issued as number]));
  const newest = [...permCounts.keys(), ...wageCounts.keys()].sort().pop();
  if (!newest) return [];
  const permOn = reader(permCounts);
  const wageOn = reader(wageCounts);
  const out: DolDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = iso(at(newest) - i * MS_PER_DAY);
    out.push({ date, perm: permOn(date), wage: wageOn(date) });
  }
  while (out.length > 0 && out[out.length - 1]!.perm === null && out[out.length - 1]!.wage === null) out.pop();
  return out;
}

export interface WeekTotals {
  /** The newest seven days. */
  last7: number;
  /** The seven days before them, or null when the record doesn't hold all seven. */
  prior7: number | null;
}

/** One record's newest week and the week before, from `dolDays` (newest first). Null when a day of the week wasn't counted. */
export function weekTotals(days: readonly DolDay[], key: "perm" | "wage"): WeekTotals | null {
  const sum = (rows: readonly DolDay[]): number | null => {
    if (rows.length < 7) return null;
    let total = 0;
    for (const r of rows) {
      const v = r[key];
      if (v === null) return null;
      total += v;
    }
    return total;
  };
  const last7 = sum(days.slice(0, 7));
  if (last7 === null) return null;
  return { last7, prior7: sum(days.slice(7, 14)) };
}

/**
 * The week against the week before, for the chip under a figure. More decided is good and fewer is bad, unless a
 * federal holiday fell in the newest week: then the change is the calendar's, and the chip says so in a plain tone.
 * Within 5% either way reads as level. Null with no earlier week, or an earlier week of nothing.
 */
export function weekTrend(t: WeekTotals, holidays: readonly string[]): FigureTrend | null {
  if (t.prior7 === null || t.prior7 <= 0) return null;
  const pct = Math.round(((t.last7 - t.prior7) / t.prior7) * 100);
  const before = `the week before (${formatInt(t.prior7)})`;
  if (Math.abs(pct) < 5) return { text: `About the same as ${before}`, dir: "level", tone: "neutral" };
  const up = pct > 0;
  const text = `${Math.abs(pct)}% ${up ? "more" : "fewer"} than ${before}`;
  if (holidays.length > 0) return { text: `${text}, with ${holidays.join(" and ")} in it`, dir: up ? "up" : "down", tone: "neutral" };
  return { text, dir: up ? "up" : "down", tone: up ? "good" : "bad" };
}
