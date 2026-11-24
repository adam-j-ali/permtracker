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
