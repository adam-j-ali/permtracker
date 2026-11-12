"use client";

import { useEffect, useRef, useState } from "react";

import { BulletinAlertForm } from "@/components/tools/BulletinAlertForm";
import { Button } from "@/components/ui/button";
import { trackUscisInterest } from "@/lib/funnelEvents";

/** The browser's own note that this question was answered here, so one person is one count. */
const ASKED_KEY = "pt_uscis_interest";
const SOURCE = "case-certified";

/**
 * A certified case's next watch: the visa bulletin alert, then one question about what comes after it.
 *
 * THE BULLETIN ALERT COMES FIRST. The case alert ends at certification, and the wait that follows (the bulletin
 * reaching this case's priority date) can run for years. The alert sits where the case alert sat on a pending
 * case, with the priority date beside it, so someone who was watching keeps watching.
 *
 * THE QUESTION COUNTS WHO WANTS USCIS TRACKING. After the bulletin, the case is at USCIS (the I-140, then the
 * I-485), and a person checks a receipt number by hand for months. Pressing the button is counted once per browser
 * (`uscis_interest`, step "pressed"). To be told by email, the reader ticks one box on the alert form above: it adds
 * the news list, which is the list that hears when tracking opens, and the same confirmation covers both.
 *
 * IT NAMES NO PRICE AND NEVER SAYS PAID OR FREE. The question is whether people want it. A test holds the words.
 */
export function CertifiedNextWatch({ anchorId, filingDate }: { anchorId: string; filingDate: string | null }) {
  const [wanted, setWanted] = useState(false);
  const [asked, setAsked] = useState(false);
  const band = useRef<HTMLDivElement>(null);

  // Read after the browser starts, so the server's page and the first paint agree.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(ASKED_KEY) === "1") setAsked(true);
    } catch {
      // No storage (a private window): the question is simply asked again.
    }
  }, []);

  function press() {
    trackUscisInterest("pressed", SOURCE);
    setAsked(true);
    setWanted(true);
    try {
      window.localStorage.setItem(ASKED_KEY, "1");
    } catch {
      // Counted either way.
    }
    // The email box is where the reader goes next, if the form is still open.
    band.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus({ preventScroll: false });
  }

  return (
    <div ref={band} id={anchorId} className="-mx-5 mb-6 scroll-mt-24 border-l-4 border-primary bg-tint px-5 py-5 sm:mx-0">
      <h3 className="font-heading text-lg font-bold leading-snug">Next, the visa bulletin: get an email when your cutoff moves</h3>{" "}
      <div className="mt-2">
        <BulletinAlertForm
          source={SOURCE}
          bare
          priorityDate={filingDate}
          extraOptIn={{
            label: "Also tell me when USCIS case tracking opens. It comes with PERM Tracker's occasional product news.",
            checked: wanted,
            onChange: setWanted,
            sourceSuffix: "-uscis",
            onSigned: () => trackUscisInterest("signed", SOURCE),
          }}
        />
      </div>{" "}
      <div className="mt-6 border-t-2 border-foreground/10 pt-5">
        <h3 className="font-heading text-lg font-bold leading-snug">After that, USCIS: tracking for your I-140 and I-485</h3>{" "}
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-soft">
          We&apos;re working on it. You&apos;d give a receipt number once and get an email when USCIS changes the case,
          the way this page does for PERM.
        </p>{" "}
        {asked ? (
          <p role="status" className="mt-3 max-w-2xl text-base font-semibold leading-relaxed">
            Noted, thank you. To get the email, sign up above with the USCIS box ticked.
          </p>
        ) : (
          <Button type="button" variant="outline" size="lg" className="mt-4" onClick={press}>
            Tell me when it&apos;s ready
          </Button>
        )}
      </div>
    </div>
  );
}
