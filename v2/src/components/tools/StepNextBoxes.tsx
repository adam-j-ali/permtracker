"use client";

import Link from "next/link";
import { BulletinAlertForm } from "./BulletinAlertForm";
import { cn } from "@/lib/utils";

/**
 * The closing boxes for the steps that aren't a case number (Nov 26 2026: every data page ended asking for a PERM
 * case): the visa bulletin's email alert on the green card line's pages, and the consulates' own pages for the steps
 * abroad. The PERM, DOL and USCIS receipt boxes are CaseNextStep and ReceiptNextStep.
 */
export function BulletinNextStep({ className }: { className?: string }) {
  // The form is its own box, with its own heading ("Email me when my cutoff moves").
  return (
    <section aria-label="Visa bulletin alert" className={className}>
      <BulletinAlertForm source="data-page-end" />
    </section>
  );
}

export function ConsulateNextStep({ className }: { className?: string }) {
  return (
    <section aria-label="Consulates and the National Visa Center" className={cn("object p-5 sm:p-6", className)}>
      <h2 className="text-balance font-heading text-xl font-bold leading-tight">Waiting on a visa interview?</h2>{" "}
      <p className="mt-2 text-base leading-relaxed">
        Each consulate&apos;s wait for an interview, what people who had theirs report, and the National Visa
        Center&apos;s own backlog.
      </p>{" "}
      <ul className="mt-4 flex flex-col gap-3 text-base sm:flex-row sm:gap-8">
        <li>
          <Link href="/consular-posts" className="link font-bold">
            Find your consulate
          </Link>
        </li>{" "}
        <li>
          <Link href="/nvc-waiting-list" className="link font-bold">
            The National Visa Center&apos;s backlog
          </Link>
        </li>
      </ul>
    </section>
  );
}
