import Link from "next/link";

import { FinePrint } from "@/components/data/FinePrint";
import { mostlyScheduleA, startsScale, startsSentence, worthShowing, type EmployerStarts } from "@/lib/employerStarts";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { longDate } from "@convex/lib/months";

/**
 * One employer's wage requests beside its PERM applications, a row a calendar year.
 *
 * A green card through work starts with the wage request and the PERM application follows months later, so the two
 * columns side by side say whether an employer is starting green cards and whether it follows through. Both columns
 * draw on one scale: a bar's length compares down a column and across the row. A year with none prints its zero and
 * draws no bar, because the zero is the news.
 *
 * A nurse or physical therapist employer never files a PERM application (Schedule A), and the note that says so
 * sits in the open: it changes how the second column reads.
 *
 * Plain server markup. Absent under `MIN_STARTS` filings, where the ledger above already says it all.
 */

const HEADING = "Wage requests and PERM applications, by year";

/**
 * One figure and its bar. The figure sits in a fixed column so the digits line up down the table; the bar runs
 * beside it from 640px and under it on a phone, where a track beside the figure would be too short to compare.
 */
function Count({ value, max, tone, last }: { value: number; max: number; tone: string; last?: boolean }) {
  return (
    <td className={cn("py-2.5 align-top", last ? null : "pr-4")}>
      <span className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="w-[6ch] shrink-0 text-right font-mono text-base font-bold">{formatInt(value)}</span>{" "}
        <span aria-hidden="true" className="block h-2.5 w-full bg-sage">
          {value > 0 && max > 0 ? (
            <span data-bar className={cn("block h-full", tone)} style={{ width: `${(value / max) * 100}%` }} />
          ) : null}
        </span>
      </span>
    </td>
  );
}

export function StartYears({
  starts,
  spellings = null,
  headingId = "start-years-h",
  className,
}: {
  starts: EmployerStarts | null;
  /** How many spellings of the employer's name the files were read under, when the nightly map named them. */
  spellings?: number | null;
  headingId?: string;
  className?: string;
}) {
  if (!worthShowing(starts)) return null;
  const { years } = starts;
  const max = startsScale(years);
  const scheduleA = mostlyScheduleA(years);
  const newestWage = longDate(starts.newestWageRequest);
  // Beside a nurse employer, "no PERM application" would read as a pause; the note under it gives the rule instead.
  const sentence =
    scheduleA && !starts.newestPerm
      ? newestWage
        ? `Its newest wage request went in on ${newestWage}.`
        : null
      : startsSentence(starts);
  const thisYear = years[years.length - 1]?.year;
  return (
    <section aria-labelledby={headingId} className={className}>
      <h3 id={headingId} className="font-heading text-lg font-bold">
        {HEADING}
      </h3>{" "}
      {sentence ? <p className="mt-1 max-w-2xl text-base text-soft">{sentence}</p> : null}{" "}
      {scheduleA ? (
        <p className="mt-3 max-w-2xl border-l-4 border-data-warn pl-4 text-base">
          Most of these wage requests are for nurses or physical therapists. Those cases skip the PERM application and
          go straight to USCIS (
          <Link href="/glossary#schedule-a" className="link">
            Schedule A
          </Link>
          ).
        </p>
      ) : null}{" "}
      <table aria-labelledby={headingId} className="mt-4 w-full max-w-2xl table-fixed border-collapse text-left tabular-nums">
        <thead>
          <tr className="border-b-2 border-border text-sm text-muted-foreground">
            <th scope="col" className="w-[7rem] py-1.5 pr-4 font-bold">
              Year{" "}
            </th>
            <th scope="col" className="py-1.5 pr-4 font-bold">
              Wage requests{" "}
            </th>
            <th scope="col" className="py-1.5 font-bold">
              PERM applications{" "}
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((r) => (
            <tr key={r.year} className="border-b border-border/60">
              <th scope="row" className="whitespace-nowrap py-2.5 pr-4 align-top text-base font-bold">
                {r.year}{" "}
                {r.year === thisYear ? <span className="text-sm font-normal text-muted-foreground">so far </span> : null}
              </th>
              <Count value={r.wageRequests} max={max} tone="bg-primary" />
              <Count value={r.permFiled} max={max} tone="bg-chart-blue" last />
            </tr>
          ))}
        </tbody>
      </table>{" "}
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        A wage request comes months before its PERM application, so a year&apos;s requests can show up as the next
        year&apos;s applications.
      </p>{" "}
      <FinePrint summary="How these are counted" className="mt-1">
        <p>
          Each filing is counted in the calendar year the employer sent it. Wage requests are the green card kind, from
          DOL&apos;s quarterly wage file and its live case status, each case once. PERM applications are from
          DOL&apos;s PERM files and its live case list. DOL publishes no employer number, so filings are matched by
          the employer&apos;s legal name
          {spellings && spellings > 1 ? `, read under the ${formatInt(spellings)} spellings DOL's files use for it` : ""}.
          A wage is good for up to a year, and an employer may ask for one it never uses.
        </p>
      </FinePrint>
    </section>
  );
}
