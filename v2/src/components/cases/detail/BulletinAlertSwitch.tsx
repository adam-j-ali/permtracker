"use client";

/**
 * The case's visa bulletin alert: one switch for the line the case's category and chargeability name. It turns on
 * the same alert the public bulletin form makes (convex/caseBulletinAlert.ts), sent to the account's own address,
 * and every case on the same line shares it.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { caseWriteErrorMessage } from "@/lib/caseWriteErrors";

export function BulletinAlertSwitch({ caseId }: { caseId: Id<"cases"> }) {
  const alert = useQuery(api.caseBulletinAlert.get, { caseId });
  const setAlert = useMutation(api.caseBulletinAlert.set);
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  if (!alert || !alert.line) return null;
  const on = optimistic ?? alert.state === "on";
  const id = `bulletin-alert-${caseId}`;

  return (
    <div className="space-y-1.5 border-t-2 border-border pt-3">
      <span className="flex min-h-11 items-center gap-3">
        <Switch
          id={id}
          checked={on}
          disabled={busy}
          onCheckedChange={async (next) => {
            setOptimistic(next);
            setBusy(true);
            try {
              const result = await setAlert({ caseId, enabled: next });
              toast.success(result.message);
            } catch (error) {
              toast.error(caseWriteErrorMessage(error, "The alert couldn't be changed. Try again."));
            } finally {
              setOptimistic(null);
              setBusy(false);
            }
          }}
        />{" "}
        <label htmlFor={id} className="text-sm font-semibold">
          Email me when this line moves
        </label>
      </span>{" "}
      <p className="text-sm text-soft">
        {alert.state === "pending"
          ? "Check your inbox to confirm the address first. The alert starts once it's confirmed."
          : "One email when a new bulletin moves this line's Final Action date, with a link to stop."}
      </p>
    </div>
  );
}
