import { Fragment } from "react";

import { OfficeCaseTable } from "@/components/community/OfficeCaseTable";
import { PageSection } from "@/components/data/PageSection";
import { PagedTable } from "@/components/ui/paged-table";
import { sheetFor } from "@/lib/communitySheets";
import { formatInt } from "@/lib/format";
import { MEDIAN_FROM, reportedIn, shortSourceName, sourcesIn, transferCohorts, type ReportedCase } from "@/lib/reportedCases";
import { emailStamp } from "@/lib/time";
import { shortDate } from "@convex/lib/months";
import { KeepWhole } from "@/components/ui/keep-whole";

/**
 * The cases people reported for this office, from every source, each person once (src/lib/reportedCases.ts): when
 * each group that moved here was approved, then every case with its dates and where it was reported. Nothing here is
 * checked, so the section says where the cases come from and links each source that has a public page.
 */

const TH = "py-1.5 pr-3 text-left font-bold";
// One line a cell: a date broken over three lines made a phone's table three times as tall; the box scrolls instead.
const TD = "whitespace-nowrap py-1.5 pr-3 tabular-nums";
const day = (iso: string | null, none = "Not given") => shortDate(iso) ?? none;

export function OfficeReportedCases({
  cases,
  builtAt,
  officeName,
}: {
  cases: readonly ReportedCase[];
  builtAt: number | null;
  officeName: string;
}) {
  if (cases.length === 0) return null;
  const approved = cases.filter((c) => c.approvalDate).length;
  const cohorts = transferCohorts(cases);
  const sources = sourcesIn(cases);
  const sheets = sources.map(sheetFor).filter((s) => s !== undefined);

  return (
    <PageSection
      id="reported-cases"
      title="Cases people reported here"
      lede={`${formatInt(cases.length)} employment-based I-485s at ${officeName}, reported by the people themselves in ${reportedIn(sources)}. ${formatInt(approved)} say they were approved.`}
    >
      <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
        Nothing here is checked. People with a fast or a stuck case are likelier to report it. A case reported in two
        places is counted once when three of its dates match, and names, usernames and receipt numbers stay where they
        were posted.
        {builtAt ? ` Updated ${emailStamp(builtAt)}.` : ""}
      </p>{" "}
      {sheets.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-x-6 text-base">
          {sheets.map((s) => (
            <Fragment key={s.key}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="link inline-flex min-h-11 items-center">
                Open the {s.name} sheet
              </a>{" "}
            </Fragment>
          ))}
        </p>
      ) : null}{" "}
      <h3 className="mt-8 font-heading text-xl font-bold">By the day each case moved here</h3>{" "}
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
        A median shows once {MEDIAN_FROM} cases from one day were approved after the move.
      </p>{" "}
      <PagedTable
        className="mt-4"
        label={`Cases people reported by the day they moved to ${officeName}`}
        noun="transfer days"
        head={
          <thead>
            <tr className="border-b-2 border-border text-sm text-muted-foreground">
              <th scope="col" className={TH}>Moved here{" "}</th>
              <th scope="col" className={TH}>Cases{" "}</th>
              <th scope="col" className={TH}>Approved{" "}</th>
              <th scope="col" className={TH}>Median days to approval{" "}</th>
              <th scope="col" className={TH}>Waiting with a visa available{" "}</th>
            </tr>
          </thead>
        }
        rows={cohorts.map((c) => (
          <tr key={c.transferDate} className="border-b border-border">
            <th scope="row" className={`${TD} text-left font-semibold`}>{day(c.transferDate)}{" "}</th>
            <td className={TD}>{formatInt(c.cases)}{" "}</td>
            <td className={TD}>{formatInt(c.approved)}{" "}</td>
            <td className={TD}>{c.medianDays === null ? "Too few" : formatInt(c.medianDays)}{" "}</td>
            <td className={TD}>{formatInt(c.waitingAvailable)}{" "}</td>
          </tr>
        ))}
      />{" "}
      <h3 className="mt-10 font-heading text-xl font-bold">Every case, newest move first</h3>{" "}
      <OfficeCaseTable
        label={`Every case people reported at ${officeName}, newest move first`}
        noun="cases"
        cellClassName={TD}
        head={
          <thead>
            <tr className="border-b-2 border-border text-sm text-muted-foreground">
              <th scope="col" className={TH}>Category{" "}</th>
              <th scope="col" className={TH}>Country{" "}</th>
              <th scope="col" className={TH}>Priority date{" "}</th>
              <th scope="col" className={TH}><KeepWhole>{"I-485 received"}</KeepWhole>{" "}</th>
              <th scope="col" className={TH}>Biometrics{" "}</th>
              <th scope="col" className={TH}>Moved here{" "}</th>
              <th scope="col" className={TH}>Approved{" "}</th>
              <th scope="col" className={TH}>Card{" "}</th>
              <th scope="col" className={TH}>Reported in{" "}</th>
            </tr>
          </thead>
        }
        rows={cases.map(caseCells)}
      />
    </PageSection>
  );
}

/**
 * One case's cells, as the every-case table prints them, in its columns' order. Text only: the table draws the page
 * on screen from these (OfficeCaseTable), so the browser gets each case once, as a short row of words.
 */
export function caseCells(c: ReportedCase): string[] {
  return [
    c.category ?? "Not given",
    c.chargeability ?? "Not given",
    c.priorityDate ? day(c.priorityDate) : (c.priorityNote ?? "Not given"),
    day(c.receiptDate),
    day(c.biometricsDate),
    day(c.transferDate),
    day(c.approvalDate, "Not yet"),
    day(c.cardDate, "Not yet"),
    `${c.sources.map(shortSourceName).join(", ")}${c.maybeRepeats > 0 ? " (may repeat another case)" : ""}`,
  ];
}
