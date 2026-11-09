import Link from "next/link";
import { Fragment } from "react";

import { entityHref } from "@/lib/entityPayload";
import type { DayCase } from "@/lib/filingDay";
import { CASE_STATUS_FILL, caseStatusTint, prettyStatus } from "@/lib/statusTone";
import { cn } from "@/lib/utils";
import { longDate } from "@convex/lib/months";

/**
 * One case in a list of a day's filings: its number (the case page), the employer (its page), the
 * job, what DOL's file adds, and the status in the site's status colours. One row for the day page
 * and for the finder that reads the same list, so a case looks the same wherever it's listed.
 */
export function DayCaseRow({ c }: { c: DayCase }) {
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-1 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-center [&>*]:min-w-0">
      <Link href={`/perm-case-status?case=${encodeURIComponent(c.caseNumber)}`} className="link inline-flex min-h-11 items-center font-mono text-sm">
        {c.caseNumber}
      </Link>{" "}
      <span className="leading-snug">
        {c.employer && c.employerSlug ? (
          <Link href={entityHref("employer", c.employerSlug)} className="link block font-semibold">
            {c.employer}
          </Link>
        ) : (
          <span className="block font-semibold">{c.employer || "Employer not named"}</span>
        )}{" "}
        <span className="block text-sm text-soft">{c.jobTitle}</span>{" "}
        <CaseFacts c={c} />
      </span>{" "}
      <span className={cn("justify-self-start px-2 py-1 text-sm font-semibold", CASE_STATUS_FILL[caseStatusTint(c.status)])}>
        {prettyStatus(c.status)}
      </span>{" "}
    </li>
  );
}

/** What DOL's file adds to a case: its decision day, the worksite, the wage, and where the case is held. */
function CaseFacts({ c }: { c: DayCase }) {
  const facts = [
    c.decided ? `Decided ${longDate(c.decided) ?? c.decided}` : null,
    c.state,
    c.wage,
    c.source === "file" ? "Only in DOL's published files" : null,
    c.fileDate ? `DOL's file dates it ${longDate(c.fileDate) ?? c.fileDate}` : null,
  ].filter(Boolean);
  if (facts.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-4 text-sm text-soft">
      {facts.map((f) => (
        <Fragment key={f}>
          <span>{f}</span>{" "}
        </Fragment>
      ))}
    </span>
  );
}
