import { Fragment } from "react";
import { IntentLink } from "@/components/ui/intent-link";

import { YearlyPayNote } from "@/components/data/YearlyPayNote";
import { FromDolLive } from "@/components/entities/FromDolLive";
import type { UnifiedFlagRow } from "@/lib/flagMerge";
import { formatWage } from "@/lib/wageFormat";
import { FilingRows } from "@/components/entities/FilingRows";
import { ROW_LINK } from "@/components/entities/caseRows";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * One employer's newest wage requests and H-1B LCAs, two columns of five.
 *
 * Every row comes from DOL's case-status service; decided ones also carry the
 * wage from its quarterly file. Shared by the PERM employer page (where these are the
 * steps before the PERM) and the page for an employer with no PERM record
 * (where they are the record). Absent when the employer has neither.
 */


export function WageAndLcaFilings({
  name,
  wageReqs,
  lcas,
  heading,
  className = "mt-10",
  level = 2,
}: {
  name: string;
  wageReqs: UnifiedFlagRow[];
  lcas: UnifiedFlagRow[];
  heading: string;
  className?: string;
  /** 3 inside a page part that has its own heading; each list's own heading steps down with it. */
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  const ListHeading = level === 3 ? "h4" : "h3";
  if (wageReqs.length === 0 && lcas.length === 0) return null;
  const lists = [
    { label: "Wage requests", all: "All wage requests", rows: wageReqs, href: `/pwd-cases?q=${encodeURIComponent(name)}` },
    { label: "H-1B LCAs", all: "All H-1B LCAs", rows: lcas, href: `/lca-cases?q=${encodeURIComponent(name)}` },
  ];
  return (
    <section className={`${className}`}>
      <Heading className="font-heading text-xl font-bold">{heading}</Heading>{" "}
      {lists.map((list) => (
        <Fragment key={list.label}>
          {" "}
          <div className="mt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <ListHeading className="text-base font-bold">{keepWhole(list.label)}</ListHeading>{" "}
              <IntentLink href={list.href} className={`${ROW_LINK} text-sm font-semibold`}>
                {list.all} by this employer
              </IntentLink>
            </div>{" "}
            {list.rows.length > 0 ? (
              <FilingRows
                className="mt-2"
                withWage
                rows={list.rows.map((r) => ({
                  caseNumber: r.caseNumber,
                  job: r.jobTitle,
                  date: r.date,
                  status: r.status,
                  wage: formatWage(r.wage, r.wageUnit) ? (
                    <>
                      {formatWage(r.wage, r.wageUnit)}
                      <YearlyPayNote wage={r.wage} unit={r.wageUnit} short />
                    </>
                  ) : null,
                }))}
              />
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None in DOL&apos;s live record yet.</p>
            )}
          </div>
        </Fragment>
      ))}{" "}
      <FromDolLive />
    </section>
  );
}
