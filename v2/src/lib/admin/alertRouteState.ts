/**
 * Each alert kind's latest state for the admin page's list of where every alert goes, from what's already recorded
 * (convex/alertState.ts): the outside watch's row, the newest recorded error of each kind, and the newest morning
 * report's sections. Pure, for the test.
 */
import type { AlertRoute } from "@convex/lib/alertRoutes";
import { dayLabel } from "@convex/lib/dailyReportCompose";
import { stamp } from "@convex/lib/phonePush";
import { routeOfReason } from "@convex/lib/serverWatch";

export interface AlertLatest {
  watch: { down: boolean; since: number; reason: string; blips: number[] } | null;
  errors: { route: string; at: number; operation: string }[];
  report: { day: string; sections: { key: string; status: string; summary: string }[] } | null;
}

/** "on": it's happening now; "seen": it happened lately; "clear": nothing now; "unknown": nothing recorded. */
export type AlertTone = "on" | "seen" | "clear" | "unknown";

export interface AlertState {
  tone: AlertTone;
  text: string;
}

const REPORT_WORD: Record<string, string> = { fail: "Failing", warn: "Watch", unknown: "Unread", off: "Off", ok: "OK" };

export function alertState(route: AlertRoute, latest: AlertLatest): AlertState {
  const { watch } = latest;
  if (route.id === "watch.blip") {
    if (!watch) return { tone: "unknown", text: "No check recorded yet." };
    const n = watch.blips.length;
    return n === 0
      ? { tone: "clear", text: "None in the last day." }
      : { tone: "seen", text: `${n === 1 ? "Once" : `${n} times`} in the last day, the newest ${stamp(Math.max(...watch.blips))}.` };
  }
  if (route.runs === "watch") {
    if (!watch) return { tone: "unknown", text: "No check recorded yet." };
    return watch.down && routeOfReason(watch.reason) === route.id
      ? { tone: "on", text: `On since ${stamp(watch.since)}: ${watch.reason}.` }
      : { tone: "clear", text: "Clear at the last check." };
  }
  if (route.runs === "errors") {
    const e = latest.errors.find((x) => x.route === route.id);
    return e
      ? { tone: "seen", text: `Last ${stamp(e.at)}: ${e.operation}.` }
      : { tone: "clear", text: "None among the newest recorded errors." };
  }
  const section = route.section ? latest.report?.sections.find((s) => s.key === route.section) : undefined;
  if (section && latest.report) {
    const word = REPORT_WORD[section.status] ?? section.status;
    return {
      tone: section.status === "fail" || section.status === "warn" ? "seen" : section.status === "ok" ? "clear" : "unknown",
      text: `${word} in the ${dayLabel(latest.report.day)} report: ${section.summary}`,
    };
  }
  return route.channel === "email" || route.channel === "phone"
    ? { tone: "unknown", text: "Sent as it happens. Nothing more is recorded here." }
    : { tone: "unknown", text: "Not in the newest report." };
}
