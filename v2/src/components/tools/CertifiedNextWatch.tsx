"use client";

import { BulletinAlertForm } from "@/components/tools/BulletinAlertForm";
import { UscisWatchForm } from "@/components/tools/UscisWatchForm";
import { KeepWhole } from "@/components/ui/keep-whole";

const SOURCE = "case-certified";

/**
 * A certified case's next watch: the visa bulletin alert, then the USCIS receipt alert.
 *
 * THE BULLETIN ALERT COMES FIRST. The case alert ends at certification, and the wait that follows (the bulletin
 * reaching this case's priority date) can run for years. The alert sits where the case alert sat on a pending
 * case, with the priority date beside it, so someone who was watching keeps watching.
 *
 * THEN THE USCIS RECEIPT ALERT. After the bulletin, the case is at USCIS (the I-140, then the I-485). Until Nov 25
 * 2026 this half asked who wanted USCIS tracking and counted the answers; the receipt alert beta now does the job
 * itself, and the Batch 6 plan placed its sign-up here. It names no price and never says paid or free.
 */
export function CertifiedNextWatch({ anchorId, filingDate }: { anchorId: string; filingDate: string | null }) {
  return (
    <div id={anchorId} className="-mx-5 mb-6 scroll-mt-24 border-l-4 border-primary bg-tint px-5 py-5 sm:mx-0">
      <h3 className="font-heading text-lg font-bold leading-snug">Next, the visa bulletin: get an email when your cutoff moves</h3>{" "}
      <div className="mt-2">
        <BulletinAlertForm source={SOURCE} bare priorityDate={filingDate} />
      </div>{" "}
      <div className="mt-6 border-t-2 border-foreground/10 pt-5">
        <h3 className="font-heading text-lg font-bold leading-snug">
          <KeepWhole>{"After that, your I-140 and I-485 at USCIS"}</KeepWhole>
        </h3>{" "}
        <UscisWatchForm source={SOURCE} className="mt-3" />
      </div>
    </div>
  );
}
