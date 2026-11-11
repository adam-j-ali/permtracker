"use client";

import { useEffect, useState } from "react";
import { ShareNetworkIcon } from "@phosphor-icons/react";

import { buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { analytics } from "@/lib/analytics";

/**
 * The day in one line, to paste into a chat.
 *
 * People pass these counts around in group chats every evening. The line is plain text with the page's address
 * typed out (no link preview needed, and a chat that strips links still shows where it came from), it's on the
 * page as text so it can be selected by hand, and on a phone the Share button hands it to the chat app.
 */
export function ShareLine({ line, day, className }: { line: string; day: string; className?: string }) {
  // The share sheet exists on phones and a few desktops. Asked after mount: the server can't know.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  async function share() {
    try {
      await navigator.share({ text: line });
      analytics.capture("daily_line_shared", { day, via: "share-sheet" });
    } catch {
      // Closed without sharing, or refused: the line and the copy button are still there.
    }
  }

  return (
    <div className={className}>
      <p className="max-w-3xl border-l-4 border-foreground bg-tint px-4 py-3 text-base leading-relaxed text-foreground">{line}</p>{" "}
      <div className="mt-3 flex flex-wrap gap-2">
        {canShare ? (
          <button type="button" onClick={share} className={buttonVariants({ variant: "default", size: "default" })}>
            <ShareNetworkIcon size={16} weight="bold" aria-hidden="true" /> Share this
          </button>
        ) : null}{" "}
        <CopyButton
          text={line}
          label="Copy this line"
          variant={canShare ? "outline" : "default"}
          onCopied={() => analytics.capture("daily_line_shared", { day, via: "copy" })}
        />
      </div>
    </div>
  );
}
