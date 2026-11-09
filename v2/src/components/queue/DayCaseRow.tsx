import Link from "next/link";
import { Fragment } from "react";

import { caseHref, namedByLabel } from "@/lib/caseLinks";
import { entityHref } from "@/lib/entityPayload";
import type { DayCase } from "@/lib/filingDay";
import { CASE_STATUS_FILL, caseStatusTint, prettyStatus } from "@/lib/statusTone";
import { cn } from "@/lib/utils";
import { longDate } from "@convex/lib/months";

/**
 * One case in a list of a day's filings: its number (the case page), the employer (its page), the
 * job, what DOL's file adds, and the status in the site's status colours. One row for the day page
 * and for the finder that reads the same list, so a case looks the same wherever it's listed. A host
 * may add one control to a row (`action`).
 */
export function DayCaseRow({ c, action }: { c: DayCase; action?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-1 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-center [&>*]:min-w-0">
      <Link href={caseHref(c.caseNumber)} className="link inline-flex min-h-11 items-center font-mono text-sm">
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
      {action ? (
        // A host that acts on a row (the case form's "Use this number") puts its control under the status.
        <span className="flex flex-col items-start gap-2 justify-self-start">
          <span className={cn("px-2 py-1 text-sm font-semibold", CASE_STATUS_FILL[caseStatusTint(c.status)])}>{prettyStatus(c.status)}</span>{" "}
          {action}
        </span>
      ) : (
        <span className={cn("justify-self-start px-2 py-1 text-sm font-semibold", CASE_STATUS_FILL[caseStatusTint(c.status)])}>
          {prettyStatus(c.status)}
        </span>
      )}{" "}
    </li>
  );
}

/**
 * What DOL's file adds to a case: its decision day, the worksite, the wage, where the case is held,
 * and the filings the file ties it to (a decided PERM case's wage request, the decided PERM cases a
 * wage request is named on), each a link to that filing's own page.
 */
function CaseFacts({ c }: { c: DayCase }) {
  const facts: { key: string; node: React.ReactNode }[] = [
    c.decided ? `Decided ${longDate(c.decided) ?? c.decided}` : null,
    c.state,
    c.wage,
    c.source === "file" ? "Only in DOL's published files" : null,
    c.fileDate ? `DOL's file dates it ${longDate(c.fileDate) ?? c.fileDate}` : null,
  ]
    .filter((f): f is string => Boolean(f))
    .map((f) => ({ key: f, node: f }));
  if (c.wageRequest) {
    facts.push({
      key: "wage-request",
      node: (
        <Link href={caseHref(c.wageRequest)} className="link">
          Wage request {c.wageRequest}
        </Link>
      ),
    });
  }
  if (c.namedBy) {
    facts.push({
      key: "named-by",
      node: (
        <Link href={caseHref(c.caseNumber)} className="link">
          {namedByLabel(c.namedBy)}
        </Link>
      ),
    });
  }
  if (facts.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-4 text-sm text-soft">
      {facts.map((f) => (
        <Fragment key={f.key}>
          <span>{f.node}</span>{" "}
        </Fragment>
      ))}
    </span>
  );
}
