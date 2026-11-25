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

export type BulletinAlertState = "off" | "on" | "pending";

/** The switch and its line of explanation, as the alert's state says. */
export function BulletinAlertToggle({
  id,
  state,
  busy,
  onToggle,
}: {
  id: string;
  state: BulletinAlertState;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1.5 border-t-2 border-border pt-3">
      <span className="flex min-h-11 items-center gap-3">
        {/* The track is drawn 24px tall; its tap area reaches 44px, and the label beside it toggles it too. */}
        <Switch
          id={id}
          checked={state === "on"}
          disabled={busy}
          onCheckedChange={onToggle}
          className="relative after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-['']"
        />{" "}
        <label htmlFor={id} className="text-sm font-semibold">
          Email me when this line moves
        </label>
      </span>{" "}
      <p className="text-sm text-soft">
        {state === "pending"
          ? "Check your inbox to confirm the address first. The alert starts once it's confirmed."
          : "One email when a new bulletin moves this line's Final Action date, with a link to stop."}
      </p>
    </div>
  );
}

export function BulletinAlertSwitch({ caseId }: { caseId: Id<"cases"> }) {
  const alert = useQuery(api.caseBulletinAlert.get, { caseId });
  const setAlert = useMutation(api.caseBulletinAlert.set);
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<BulletinAlertState | null>(null);

  if (!alert || !alert.line) return null;

  return (
    <BulletinAlertToggle
      id={`bulletin-alert-${caseId}`}
      state={optimistic ?? alert.state}
      busy={busy}
      onToggle={async (next) => {
        setOptimistic(next ? "on" : "off");
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
    />
  );
}
