"use client";

import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { longDate } from "@convex/lib/months";
import { INVITE_DAYS } from "@convex/lib/reminderRecipients";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { easternDay } from "@/lib/time";
import { toast } from "@/lib/toast";

const BADGE = { waiting: "Waiting to confirm", confirmed: "On", stopped: "Stopped" } as const;

/**
 * "Reminders for someone else" on a case's Overview: the case's deadline reminders sent to a second person too, a
 * paralegal or the employer's HR contact (convex/reminderRecipients.ts). One per case. The address gets one email to
 * confirm; once it does, it gets this case's reminders by the owner's email switches in Settings (the same rule as the
 * owner's own reminder email: emailsDeadlineReminder), each with a one-click stop. A stop, or "Don't invite me again"
 * in the invitation, leaves the row stopped with no address, and that address can't be invited again. The
 * card shows the address and where it stands, and removes it after a confirm.
 */
export function ReminderRecipientCard({ caseId, closed = false }: { caseId: Id<"cases">; closed?: boolean }) {
  const id = useId();
  const recipient = useQuery(api.reminderRecipients.forCase, { caseId });
  const invite = useMutation(api.reminderRecipients.invite);
  const remove = useMutation(api.reminderRecipients.remove);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Type their email address first.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await invite({ caseId, email });
      if (r.ok) {
        setEmail("");
        toast.success("Invitation sent. Their reminders start once they confirm.");
      } else {
        setError(r.message);
      }
    } catch {
      setError("Couldn't send the invitation. Try again.");
    } finally {
      setSending(false);
    }
  };

  const takeOff = async () => {
    setRemoving(true);
    try {
      await remove({ caseId });
      setConfirming(false);
      toast.success("Removed. Nothing more goes to that address.");
    } catch {
      toast.error("Couldn't remove it. Try again.");
    } finally {
      setRemoving(false);
    }
  };

  const day = (ms: number | null) => (ms ? longDate(easternDay(ms)) : null);
  const who = recipient?.email ?? "the second person";
  // Stopped: by a reminder's Stop link, or, never confirmed, by "Don't invite me again" in the invitation.
  const stoppedHow =
    recipient?.confirmedAt === null
      ? "The person you invited asked not to get these reminders"
      : "The second person stopped these reminders";
  const stoppedLine = `${stoppedHow} on ${day(recipient?.stoppedAt ?? null)}, and we deleted their address. That address can't be added again. Remove this to add someone else.`;

  return (
    <section className="detail-card" aria-labelledby={`${id}-h`}>
      <div className="detail-card-head">
        <h2 id={`${id}-h`} className="flex items-center gap-1.5">
          <EnvelopeSimpleIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Reminders for someone else
        </h2>{" "}
        {recipient ? <span className="head-badge">{BADGE[recipient.status]}</span> : null}
      </div>
      <div className="detail-card-body space-y-4">
        <p className="text-base text-muted-foreground">
          Send this case&apos;s deadline reminders to one more person, like a paralegal or the employer&apos;s HR
          contact. They get the reminders your email switches in Settings send you, for this case only. Each email
          names the employer, the job title and the deadlines.
        </p>{" "}
        {closed ? (
          <p className="text-base text-muted-foreground">This case is closed, so it has no reminders to send.</p>
        ) : null}{" "}

        {recipient === undefined ? null : recipient === null ? (
          <form onSubmit={(e) => void send(e)} noValidate className="space-y-3">
            <div className="grid grid-cols-1 gap-2 [&>*]:min-w-0">
              <Label htmlFor={`${id}-email`} className="text-base font-bold">
                Their email address
              </Label>{" "}
              <Input
                id={`${id}-email`}
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : `${id}-help`}
                className="min-h-11"
              />
            </div>{" "}
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-sm font-bold text-destructive">
                {error}
              </p>
            ) : (
              <p id={`${id}-help`} className="text-sm text-muted-foreground">
                We email them once to confirm. Nothing else is sent until they do.
              </p>
            )}{" "}
            <Button type="submit" className="min-h-11" disabled={sending} aria-busy={sending}>
              <EnvelopeSimpleIcon aria-hidden="true" className="h-4 w-4" /> Send invitation
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-base" role="status">
              {recipient.status === "waiting"
                ? recipient.inviteFailed
                  ? `We couldn't send the invitation to ${who}. Remove it and try again.`
                  : `We've invited ${who}. Their reminders start once they confirm. If they don't within ${INVITE_DAYS} days, the invitation and their address are deleted.`
                : recipient.status === "confirmed"
                  ? `${who} gets this case's deadline reminders. They confirmed on ${day(recipient.confirmedAt)}.`
                  : stoppedLine}
            </p>{" "}
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => (open || removing ? null : setConfirming(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {recipient?.status === "stopped" ? "Remove this?" : `Remove ${who}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {recipient?.status === "stopped"
                ? "Then you can add someone else to this case's reminders."
                : "They won't get this case's reminders anymore, and we'll delete their address. You can add someone again after."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void takeOff();
              }}
              disabled={removing}
              aria-busy={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
