"use client";

import { useId, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ShareNetworkIcon } from "@phosphor-icons/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { longDate } from "@convex/lib/months";
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
import { CopyButton } from "@/components/ui/copy-button";
import { easternDay } from "@/lib/time";
import { toast } from "@/lib/toast";

/**
 * "Share with your client" on a case's Recruitment tab: a private link to a read-only page of this record
 * (convex/recruitmentShares.ts, src/app/share/recruitment). The link is shown once, when it's made, because only
 * its hash is kept; after that the card says when it was made and last opened, and turns it off after a confirm.
 */
export function ShareWithClient({ caseId }: { caseId: Id<"cases"> }) {
  const id = useId();
  const link = useQuery(api.recruitmentShares.forCase, { caseId });
  const create = useAction(api.recruitmentShares.create);
  const turnOff = useMutation(api.recruitmentShares.turnOff);
  const [fresh, setFresh] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [turningOff, setTurningOff] = useState(false);

  const share = async () => {
    setMaking(true);
    try {
      const made = await create({ caseId });
      if (made.ok) setFresh(made.url);
      else toast.error(made.message);
    } catch {
      toast.error("Couldn't make the link. Try again.");
    } finally {
      setMaking(false);
    }
  };

  const stop = async () => {
    setTurningOff(true);
    try {
      await turnOff({ caseId });
      setFresh(null);
      setConfirming(false);
      toast.success("The link is off.");
    } catch {
      toast.error("Couldn't turn off the link. Try again.");
    } finally {
      setTurningOff(false);
    }
  };

  const made = link ? longDate(easternDay(link.createdAt)) : null;
  const opened = link?.lastViewedOn ? longDate(link.lastViewedOn) : null;

  return (
    <section className="detail-card" aria-labelledby={`${id}-h`}>
      <div className="detail-card-head ch-rec">
        <h2 id={`${id}-h`} className="flex items-center gap-1.5">
          <ShareNetworkIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Share with your client
        </h2>{" "}
        {link ? <span className="head-badge">Link on</span> : null}
      </div>
      <div className="detail-card-body space-y-4">
        <p className="text-base text-muted-foreground">
          Send your client a private, read-only page of this record. It shows the employer and the job title, the
          recruitment steps and their dates, the filing window and the applicant log. It updates as you work.
        </p>{" "}
        <p className="text-base text-muted-foreground">
          Anyone with the link can see it, with no sign-in. The beneficiary, notes, documents, case numbers and the wage
          aren&apos;t shown, and neither are your notes on applicants you hired or are still considering.
        </p>{" "}

        {fresh ? (
          <div className="object p-4" role="status">
            <p className="text-base font-bold">Here&apos;s the link. Copy it now: it isn&apos;t shown again.</p>{" "}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all border-2 border-border bg-tint px-3 py-2 font-mono text-sm">{fresh}</code>{" "}
              <CopyButton text={fresh} label="Copy link" className="min-h-11" />
            </div>
          </div>
        ) : null}

        {link === undefined ? null : link ? (
          <div className="space-y-3">
            <p className="text-base">
              {`The link is on. Anyone with it can see this record. Made ${made}. ${opened ? `Last opened ${opened}, by anyone with the link, you included.` : "Not opened yet."}`}
            </p>{" "}
            <p className="text-sm text-muted-foreground">Lost the link? Turn it off, then share again for a new one.</p>{" "}
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(true)}>
              Turn off the link
            </Button>
          </div>
        ) : (
          <Button type="button" className="min-h-11" disabled={making} aria-busy={making} onClick={() => void share()}>
            <ShareNetworkIcon aria-hidden="true" className="h-4 w-4" /> Share with your client
          </Button>
        )}
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => (open || turningOff ? null : setConfirming(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off the link?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone who opens it then sees that it&apos;s off. To share the record again, you&apos;ll make a new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={turningOff}>Keep it on</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void stop();
              }}
              disabled={turningOff}
              aria-busy={turningOff}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Turn off the link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
