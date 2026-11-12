import { monthDay, monthYear } from "@convex/lib/months";

/** One figure about where DOL is in the PERM line: its label, its value and the small print under it. */
export interface QueueFact {
  label: string;
  value: string;
  note: string;
}

/**
 * Where DOL is in the PERM line today, as figures: the filing month it's deciding by our own daily check
 * (lib/permLine.ts), then the oldest month still open when that's another month.
 *
 * One wording for every place that shows them (the case status page, the embeddable processing-times box).
 * The month DOL is on leads and it's ours: DOL's own page stopped printing a month on Oct 31 2026, and the oldest
 * open month alone reads as the answer to "where is DOL now" when it isn't.
 */
export function queueNowFacts(deciding: { month: string; asOf: string } | null, front: string | null): QueueFact[] {
  const facts: QueueFact[] = [];
  if (deciding) {
    facts.push({
      label: "DOL is deciding now",
      value: monthYear(deciding.month) ?? deciding.month,
      note: `cases filed that month, by our check of DOL's case status on ${monthDay(deciding.asOf) ?? deciding.asOf}`,
    });
  }
  const oldest = oldestOpenFact(deciding, front);
  if (oldest) facts.push(oldest);
  return facts;
}

/** The oldest filing month DOL hasn't substantially decided, when it isn't the month DOL is deciding. */
export function oldestOpenFact(deciding: { month: string } | null, front: string | null): QueueFact | null {
  if (!front || front === deciding?.month) return null;
  return {
    label: "Oldest month still open",
    value: monthYear(front) ?? front,
    note: "the oldest filing month DOL hasn't substantially decided",
  };
}
