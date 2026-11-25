"use client";

/**
 * The email alerts sent to the account's own address, on the dashboard: the case status alerts, the receipt alerts,
 * the bulletin alerts (a case's own bulletin line among them), the queue alerts and the employer follows a person set
 * up, each with its own stop. Someone waiting on their own case keeps their watches here rather than in a list
 * they'd have to find in Settings.
 *
 * The rows come from emailPrefs.mine, which reads the account's proved address and nothing a page names, and a stop
 * goes through emailPrefs.turnOffMine, which never touches a row of another address. The rows and their wording are
 * the ones Settings and the emailed preferences page use (subscriptionRows), so an alert reads the same everywhere.
 * The digests and product news stay in Settings, which the heading links.
 *
 * Nothing shows while it loads, for an unproved address, or when the address has no live alert: most accounts that
 * file cases have none, and an empty box would sit on every one of their dashboards.
 */

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { MAIL_KINDS, NOTIFICATION_SETTINGS_PATH, subscriptionRows, type SubscriptionRow } from "@/lib/mailKinds";
import { WIDGET_CONTAINER_CLASSES, WidgetHeader, WidgetLink } from "./widget-primitives";

const rowKey = (row: SubscriptionRow) => `${row.kind}:${row.id ?? ""}`;

export default function MyWatchesWidget(): ReactNode {
  const state = useQuery(api.emailPrefs.mine);
  const turnOff = useMutation(api.emailPrefs.turnOffMine);
  const [busy, setBusy] = useState<string | null>(null);

  if (!state) return null;
  const rows = subscriptionRows(state).alerts;
  if (rows.length === 0) return null;

  const stop = async (row: SubscriptionRow) => {
    setBusy(rowKey(row));
    try {
      await turnOff({ kind: row.kind, id: row.id });
      toast(`${MAIL_KINDS[row.kind].one} stopped`, { description: row.detail });
    } catch {
      toast.error("That didn't save. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="my-alerts" aria-labelledby="my-alerts-title" className={WIDGET_CONTAINER_CLASSES}>
      <WidgetHeader
        id="my-alerts-title"
        title="Your email alerts"
        count={rows.length}
        action={<WidgetLink href={NOTIFICATION_SETTINGS_PATH}>All your email</WidgetLink>}
      />
      <ul className="divide-y divide-border px-5">
        {rows.map((row) => {
          const key = rowKey(row);
          const one = MAIL_KINDS[row.kind].one;
          return (
            <li key={key} className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{one}</p>{" "}
                <p className={`break-words text-sm text-muted-foreground ${row.isCaseNumber ? "font-mono" : ""}`}>
                  {row.detail}
                </p>
                {row.note ? <p className="text-sm text-muted-foreground">{row.note}</p> : null}
              </div>{" "}
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                loading={busy === key}
                disabled={busy !== null}
                aria-label={`Stop the ${one.toLowerCase()} for ${row.detail}`}
                onClick={() => stop(row)}
              >
                Stop
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
