"use client";

import { ArrowClockwiseIcon } from "@phosphor-icons/react";

import { buttonVariants } from "@/components/ui/button";

/**
 * The error screen for a shared recruitment record (recruitment/[token]/page.tsx): the record couldn't be read just
 * now. A link that's off or doesn't exist is the 404 instead, so this never says the link is the problem.
 *
 * It reports nothing from the browser: this page's address is the link's key, and the server records its own
 * failure. A reload asks for the record again.
 */
export default function SharedRecordError() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="font-heading text-lg font-bold">PERM Tracker</p>{" "}
      <h1 className="mt-8 font-heading text-3xl font-bold">This record couldn&apos;t be loaded just now</h1>{" "}
      <p className="mt-3 max-w-prose text-lg text-soft">
        The problem is on our side, not with your link. Try again in a minute.
      </p>{" "}
      <button type="button" onClick={() => window.location.reload()} className={buttonVariants({ className: "mt-8 min-h-11" })}>
        <ArrowClockwiseIcon aria-hidden="true" className="size-4" weight="bold" /> Try again
      </button>
    </main>
  );
}
