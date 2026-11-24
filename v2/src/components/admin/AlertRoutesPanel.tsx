"use client";

/**
 * The admin page's list of where every alert goes, from the one routing list (scripts/data/alert_routes.json), each
 * kind with its latest state where it's already recorded (convex/alertState.ts). Grouped by channel, loudest first.
 */

import { useQuery } from "convex/react";

import { api } from "@convex/_generated/api";
import { ALERT_ROUTES, CHANNEL_ORDER, CHANNEL_WORDS, RUNS_WORDS } from "@convex/lib/alertRoutes";
import { type AlertTone, alertState } from "@/lib/admin/alertRouteState";
import { Skeleton } from "@/components/ui/skeleton";

const TONE_WORD: Record<AlertTone, string> = { on: "On now", seen: "Lately", clear: "Clear", unknown: "Latest" };
const TONE_CLASS: Record<AlertTone, string> = {
  on: "text-data-bad-ink",
  seen: "text-data-warn-ink",
  clear: "text-foreground",
  unknown: "text-muted-foreground",
};

export function AlertRoutesPanel() {
  const latest = useQuery(api.alertState.latest);
  if (latest === undefined) return <Skeleton className="h-96" />;

  return (
    <section aria-labelledby="alert-routes-h" className="border-2 border-border bg-card p-5 sm:p-6 shadow-hard">
      <h2 id="alert-routes-h" className="font-heading text-xl font-bold">
        Where each alert goes
      </h2>{" "}
      <p className="mt-2 text-base text-muted-foreground">
        One list decides it for the server, Convex, the morning report, the ingest check and the site audit. Change a
        kind&apos;s channel in scripts/data/alert_routes.json.
      </p>{" "}
      <div className="mt-6 space-y-8">
        {CHANNEL_ORDER.map((channel) => {
          const routes = ALERT_ROUTES.filter((r) => r.channel === channel);
          if (routes.length === 0) return null;
          return (
            <div key={channel}>
              <h3 className="font-heading text-lg font-bold">{CHANNEL_WORDS[channel]}</h3>{" "}
              <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
                {routes.map((r) => {
                  const state = alertState(r, latest);
                  return (
                    <li key={r.id} className="border-2 border-border bg-background p-4">
                      <p className="text-base font-bold [overflow-wrap:anywhere]">{r.what}</p>{" "}
                      <p className="mt-1 text-sm text-muted-foreground">
                        {`${RUNS_WORDS[r.runs] ?? r.runs}. ${r.repeat}`}
                      </p>{" "}
                      <p className={`mt-2 text-sm [overflow-wrap:anywhere] ${TONE_CLASS[state.tone]}`}>
                        <span className="font-bold">{`${TONE_WORD[state.tone]}: `}</span>
                        {state.text}
                      </p>{" "}
                    </li>
                  );
                })}
              </ul>{" "}
            </div>
          );
        })}
      </div>
    </section>
  );
}
