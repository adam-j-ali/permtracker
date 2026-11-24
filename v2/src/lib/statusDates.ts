import { easternDay } from "@/lib/time";

/** The two dates a DOL case-status row carries, as Eastern days. */
export interface StatusDates {
  /** When its status last changed: a row is rewritten only on a change. */
  since: string | null;
  /** The status hasn't changed since the case was first seen, so it held it on that day or earlier. */
  sinceOrEarlier: boolean;
  /** When DOL was last asked: the newest sweep for an open request; null for a decided one, which isn't asked again. */
  checked: string | null;
}

/** A stamp's Eastern day: check dates arrive as days, status stamps as instants. */
function dayOf(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.length > 10 ? easternDay(new Date(v)) : v;
}

export function statusDates(r: {
  isFinal: boolean;
  statusSince: string | null;
  sinceFirstSeen: boolean;
  lastCheckedAt: string | null;
}): StatusDates {
  const since = dayOf(r.statusSince);
  return { since, sinceOrEarlier: since !== null && r.sinceFirstSeen, checked: r.isFinal ? null : dayOf(r.lastCheckedAt) };
}

/** "Nov 16, 2026", with " or earlier" when the status hasn't changed since the case was first seen. */
function sinceWords(d: StatusDates, fmt: (day: string) => string | null): string | null {
  return d.since ? `${fmt(d.since) ?? d.since}${d.sinceOrEarlier ? " or earlier" : ""}` : null;
}

/** A case page's source line: when the status last changed and, for an open case, when DOL was last asked. */
export function statusSourceLine(
  row: Parameters<typeof statusDates>[0],
  fmt: (day: string) => string | null,
): string | undefined {
  const d = statusDates(row);
  const since = sinceWords(d, fmt);
  if (d.checked) {
    const checked = fmt(d.checked) ?? d.checked;
    return since ? `In this status since ${since}, checked with DOL ${checked}` : `Checked with DOL ${checked}`;
  }
  return since ? `DOL showed this status on ${since}` : undefined;
}

/** A case page's two record rows: in this status since, and (for an open case) last checked with DOL. */
export function statusRecordRows(
  row: Parameters<typeof statusDates>[0],
  fmt: (day: string) => string | null,
): { label: string; value: string }[] {
  const d = statusDates(row);
  return [
    { label: "In this status since", value: sinceWords(d, fmt) ?? "Unknown" },
    ...(d.checked ? [{ label: "Last checked with DOL", value: fmt(d.checked) ?? d.checked }] : []),
  ];
}
