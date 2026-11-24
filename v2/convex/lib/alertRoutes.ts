/**
 * Where each alert goes, from the one list in scripts/data/alert_routes.json (bundled in at deploy, since Convex
 * can't read the repository at run time). The server's scripts read the same file through
 * scripts/oracle/lib/alert_routes.py; scripts/test_alert_routes.py holds the list and every program to each other.
 *
 * An unlisted kind goes by phone and email, so a gap in the list is never silence.
 */
import doc from "../../scripts/data/alert_routes.json";

import type { PushLevel } from "./phonePush";

export type Channel = "phone" | "report" | "email" | "admin";

export interface AlertRoute {
  id: string;
  runs: string;
  channel: Channel;
  what: string;
  repeat: string;
  /** Phone kinds only: the push's priority. */
  level?: "urgent" | "high";
  /** Phone kinds only: hours between reminder emails while it lasts; null for never. */
  remindHours?: number | null;
  /** The morning report's section that records its latest state. */
  section?: string;
}

export const ALERT_ROUTES: readonly AlertRoute[] = doc.routes as AlertRoute[];
export const CHANNEL_WORDS = doc.channels as Record<Channel, string>;
export const RUNS_WORDS = doc.runs as Record<string, string>;
/** The channels in the order the admin page lists them: loudest first. */
export const CHANNEL_ORDER: readonly Channel[] = ["phone", "report", "email", "admin"];

const BY_ID = new Map(ALERT_ROUTES.map((r) => [r.id, r]));

export function routeOf(id: string): AlertRoute | undefined {
  return BY_ID.get(id);
}

/** Where a kind goes; an unlisted kind goes by phone. */
export function channelOf(id: string): Channel {
  return BY_ID.get(id)?.channel ?? "phone";
}

/** True when the kind is sent as it happens (phone or email), not left to the report or the admin page. */
export function isSentNow(id: string): boolean {
  const c = channelOf(id);
  return c === "phone" || c === "email";
}

/** The push's level for a phone kind; null for any other channel. An unlisted kind pushes as high. */
export function levelOf(id: string): Exclude<PushLevel, "clear"> | null {
  const r = BY_ID.get(id);
  if (!r) return "high";
  return r.channel === "phone" ? (r.level ?? "high") : null;
}

/** Milliseconds between reminder emails while a phone kind lasts; null for never. */
export function remindMsOf(id: string, fallbackMs: number): number | null {
  const r = BY_ID.get(id);
  if (!r) return fallbackMs;
  return r.remindHours === null || r.remindHours === undefined ? null : r.remindHours * 3_600_000;
}
