"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { captureError } from "@/lib/sentry";
import { toast } from "@/lib/toast";

/**
 * The ask after a policy change that affects information already given (convex/policyConsent.ts): one line, never a
 * dialog, never in the way of the page. Hidden at the baseline, which every account holds, so nobody sees it until
 * the owner moves POLICY_CONSENT_VERSION. Accepting sends the version this banner was shown for, so a tab left open
 * across two changes can't accept the newer text unread.
 *
 * Behind its own error boundary: a failed read throws out of `useQuery`, and without the boundary that would take
 * the whole signed-in app down for a banner almost nobody sees. A failure renders nothing and reaches Sentry.
 */
export default function PolicyConsentBanner() {
  return (
    <ErrorBoundary fallback={<></>} onError={(error) => captureError(error, { operation: "PolicyConsentBanner.myStatus" })}>
      <Banner />
    </ErrorBoundary>
  );
}

function Banner() {
  const status = useQuery(api.policyConsent.myStatus, {});
  const accept = useMutation(api.policyConsent.accept);
  const [busy, setBusy] = useState(false);

  if (!status?.needed) return null;

  const handleAccept = async () => {
    setBusy(true);
    try {
      const r = await accept({ version: status.version });
      if (!r.ok) throw new Error("not the current version");
    } catch {
      toast.error("Couldn’t record that. Try again.");
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label="Policy update" className="relative z-10 border-b-2 border-border bg-muted px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="min-w-0 text-sm text-foreground">
          <span className="font-medium">We updated our Privacy Policy and Terms.</span>{" "}
          {status.summary ? <span>{status.summary}</span> : null}{" "}
          <span>It applies to you only once you accept it.</span>
        </p>{" "}
        <div className="flex flex-shrink-0 items-center gap-3">
          <Link href="/privacy#changes-to-this-policy" className="link inline-flex min-h-11 items-center text-sm font-bold">
            Read what changed
          </Link>{" "}
          <Button size="sm" onClick={handleAccept} disabled={busy}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
