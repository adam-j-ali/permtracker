import { PageSection } from "@/components/data/PageSection";
import { PagedTable } from "@/components/ui/paged-table";
import { MEDIAN_FROM, sheetFor, transferCohorts, type SheetCase } from "@/lib/communitySheets";
import { formatInt } from "@/lib/format";
import { emailStamp } from "@/lib/time";
import { longDate, shortDate } from "@convex/lib/months";

/**
 * The cases a community sheet holds for this office (src/lib/communitySheets.ts): when each group that moved here
 * was approved, then every case with its dates. The sheet is someone else's, kept by the people in it, so the
 * section says whose it is, when it was read and that nothing in it is checked, and links it.
 */

const TH = "py-1.5 pr-3 text-left font-bold";
// One line a cell: a date broken over three lines made a phone's table three times as tall; the box scrolls instead.
const TD = "whitespace-nowrap py-1.5 pr-3 tabular-nums";
const day = (iso: string | null, none = "Not given") => shortDate(iso) ?? none;

export function OfficeSheetCases({
  cases,
  readAt,
  officeName,
}: {
  cases: readonly SheetCase[];
  readAt: number | null;
  officeName: string;
}) {
  const sheet = cases[0] ? sheetFor(cases[0].source) : undefined;
  if (!sheet || cases.length === 0) return null;
  const approved = cases.filter((c) => c.approvalDate).length;
  const cohorts = transferCohorts(cases);

  return (
    <PageSection
      id="community-sheet"
      title={`Cases people track in the ${sheet.name} sheet`}
      lede={`A Google Sheet shared on Reddit (${sheet.sharedWhere}) on ${longDate(sheet.shared)} holds ${formatInt(cases.length)} employment-based I-485s at ${officeName}, entered by the people themselves. ${formatInt(approved)} say they were approved.`}
    >
      <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
        Nothing in it is checked, and anyone with the link can edit it. People with a fast or a stuck case are likelier
        to fill it in. Usernames and receipt numbers stay in the sheet.
        {readAt ? ` Read ${emailStamp(readAt)}.` : ""}{" "}
        <a href={sheet.url} target="_blank" rel="noopener noreferrer" className="link inline-flex min-h-11 items-center">
          Open the {sheet.name} sheet
        </a>
      </p>{" "}
      <h3 className="mt-8 font-heading text-xl font-bold">By the day each case moved here</h3>{" "}
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
        A median shows once {MEDIAN_FROM} cases from one day were approved after the move.
      </p>{" "}
      <PagedTable
        className="mt-4"
        label={`Cases in the ${sheet.name} sheet by the day they moved to ${officeName}`}
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
      <h3 className="mt-10 font-heading text-xl font-bold">Every case in the sheet</h3>{" "}
      <PagedTable
        className="mt-4"
        label={`Every case in the ${sheet.name} sheet, in the sheet's own order`}
        noun="cases"
        head={
          <thead>
            <tr className="border-b-2 border-border text-sm text-muted-foreground">
              <th scope="col" className={TH}>Category{" "}</th>
              <th scope="col" className={TH}>Country{" "}</th>
              <th scope="col" className={TH}>Priority date{" "}</th>
              <th scope="col" className={TH}>I-485 received{" "}</th>
              <th scope="col" className={TH}>Biometrics{" "}</th>
              <th scope="col" className={TH}>Moved here{" "}</th>
              <th scope="col" className={TH}>Approved{" "}</th>
              <th scope="col" className={TH}>Card{" "}</th>
            </tr>
          </thead>
        }
        rows={cases.map((c) => (
          <tr key={`${c.source}-${c.rowNo}`} className="border-b border-border">
            <td className={TD}>{c.category ?? "Not given"}{" "}</td>
            <td className={TD}>{c.country ?? "Not given"}{" "}</td>
            <td className={TD}>{c.priorityDate ? day(c.priorityDate) : (c.priorityNote ?? "Not given")}{" "}</td>
            <td className={TD}>{day(c.receiptDate)}{" "}</td>
            <td className={TD}>{day(c.biometricsDate)}{" "}</td>
            <td className={TD}>{day(c.transferDate)}{" "}</td>
            <td className={TD}>{day(c.approvalDate, "Not yet")}{" "}</td>
            <td className={TD}>{day(c.cardDate, "Not yet")}{" "}</td>
          </tr>
        ))}
      />
    </PageSection>
  );
}
