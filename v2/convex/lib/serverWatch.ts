/**
 * The off-server check on the server: pure rules, tested in serverWatch.test.ts.
 *
 * WHY IT LIVES OFF THE SERVER. On Oct 10 2026 the server's disk filled and
 * every monitor ON the server (the watchdog, the defense, the health sampler)
 * went blind with it; the owner heard at the 7:30 AM report, two hours later.
 * The server now alarms on itself (scripts/oracle/bin/permtracker-alarm), but
 * nothing on a machine can report that machine being gone. Convex runs
 * elsewhere, so it reads the health report the server writes every 10 minutes
 * (perm_docs['server_health'], scripts/oracle/bin/permtracker-health) and
 * emails when that report goes quiet, when the database stops answering, or
 * when the report says the disk is nearly full. It pushes to the owner's phone
 * too (convex/lib/phonePush.ts), once on start and once on recovery: urgent
 * when the server can't be heard from at all, high for the disk.
 *
 * The database not answering mails only after two checks in a row (30 minutes):
 * a 15-minute blip sent a start and a clear for something that fixed itself
 * (Nov 2026). One miss is kept a day in `blips`, for the morning report.
 *
 * Where each kind goes, its push's level and its reminders are the routing list's
 * (scripts/data/alert_routes.json, convex/lib/alertRoutes.ts): watch.quiet,
 * watch.database, watch.disk and watch.blip.
 */
import { isSentNow, levelOf, remindMsOf } from "./alertRoutes";
import type { PushLevel } from "./phonePush";

/** The sampler writes every 10 minutes; three missed writes is an alarm. */
export const STALE_MS = 35 * 60 * 1000;
/** Reminders while an alarm lasts, for a kind the routing list doesn't name. */
export const REMIND_MS = 6 * 60 * 60 * 1000;
/** Disk use the report itself flags (the server's own alarm acts at 25 GB free, about 83%). */
export const DISK_PCT = 90;
/** How long a single database miss stays in `blips` for the morning report. */
export const BLIP_KEEP_MS = 24 * 60 * 60 * 1000;
/** judge's words for a database that didn't answer: the one reason a single check may be a blip. */
export const DB_MISS = "the server's database did not answer";

export type WatchRoute = "watch.quiet" | "watch.database" | "watch.disk";

/** The routing list's kind for one of judge's reasons. */
export function routeOfReason(reason: string): WatchRoute {
  if (reason.startsWith(DB_MISS)) return "watch.database";
  if (reason.startsWith("the server's disk")) return "watch.disk";
  return "watch.quiet";
}

export interface HealthRow {
  computed_at: number | string | null;
  json: string | null;
}

/** Why the server needs a look, or null when its report is fresh and the disk has room. */
export function judge(row: HealthRow | null, now: number, readError?: string): string | null {
  if (readError) return `${DB_MISS} (${readError.slice(0, 160)})`;
  if (!row || row.computed_at === null) return "the server has never written its health report";
  const age = now - Number(row.computed_at);
  if (!(age <= STALE_MS)) {
    return `the server's health report is ${Math.round(age / 60000)} minutes old (it writes one every 10)`;
  }
  try {
    const doc = JSON.parse(row.json ?? "{}") as { now?: { diskPct?: number } };
    const disk = doc.now?.diskPct;
    if (typeof disk === "number" && disk >= DISK_PCT) return `the server's disk is ${disk}% full`;
  } catch {
    return "the server's health report could not be read";
  }
  return null;
}

export interface WatchState {
  down: boolean;
  since: number;
  mailedAt: number;
  reason: string;
  /** A database miss not yet mailed: when the check saw it, and its words. */
  pendingSince?: number;
  pendingReason?: string;
  /** Single database misses in the last day, each followed by a check that answered. */
  blips?: number[];
}

/** since: when the trouble started (for a clear, the start of the trouble that ended). */
export type WatchMail = { kind: "start" | "still" | "clear"; reason: string; since: number } | null;

/**
 * The push for this email, or null: a start or a clear pushes when the routing list sends its kind by phone, at the
 * kind's level; a reminder never does.
 */
export function pushFor(mail: WatchMail): { level: PushLevel; title: string; todo: string } | null {
  if (!mail || mail.kind === "still") return null;
  const route = routeOfReason(mail.reason);
  const level = levelOf(route);
  if (level === null) return null;
  if (mail.kind === "clear") return { level: "clear", title: "PERM Tracker server: reporting again", todo: "" };
  return route === "watch.disk"
    ? { level, title: "PERM Tracker server: disk nearly full", todo: "ssh permtracker and follow the runbook's disk steps." }
    : { level, title: "PERM Tracker server: can't be heard from", todo: "Open permtracker.app; if it's down, ssh permtracker and check its services." };
}

/** True when the routing list sends this email's kind as it happens; false leaves it to the report or the admin page. */
export function mailsNow(mail: WatchMail): boolean {
  return mail !== null && isSentNow(routeOfReason(mail.reason));
}

/**
 * The next state, and the email this check should send (start, reminder, recovery, or none). Every field is set,
 * `undefined` included, so a patch with it clears what's over.
 */
export function step(prev: WatchState | null, reason: string | null, now: number): { next: WatchState; mail: WatchMail } {
  const blips = (prev?.blips ?? []).filter((t) => now - t < BLIP_KEEP_MS);
  const settled = { pendingSince: undefined, pendingReason: undefined, blips };
  if (reason) {
    if (!prev || !prev.down) {
      // A first database miss waits for the next check while the routing list keeps one miss (watch.blip) off the
      // email; anything else, or a second check in trouble, mails now.
      if (reason.startsWith(DB_MISS) && prev?.pendingSince === undefined && !isSentNow("watch.blip")) {
        return {
          next: { down: false, since: prev?.since ?? now, mailedAt: prev?.mailedAt ?? 0, reason: "",
                  pendingSince: now, pendingReason: reason, blips },
          mail: null,
        };
      }
      const since = prev?.pendingSince ?? now;
      return { next: { down: true, since, mailedAt: now, reason, ...settled }, mail: { kind: "start", reason, since } };
    }
    const remind = remindMsOf(routeOfReason(reason), REMIND_MS);
    if (remind !== null && now - prev.mailedAt >= remind) {
      return { next: { ...prev, mailedAt: now, reason, ...settled }, mail: { kind: "still", reason, since: prev.since } };
    }
    return { next: { ...prev, reason, ...settled }, mail: null };
  }
  if (prev?.down) {
    return {
      next: { down: false, since: now, mailedAt: now, reason: "", ...settled },
      mail: { kind: "clear", reason: prev.reason, since: prev.since },
    };
  }
  const missed = prev?.pendingSince === undefined ? [] : [prev.pendingSince];
  return {
    next: { down: false, since: prev?.since ?? now, mailedAt: prev?.mailedAt ?? 0, reason: "", ...settled,
            blips: [...blips, ...missed] },
    mail: null,
  };
}
