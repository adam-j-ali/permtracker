import Link from "next/link";
import { Fragment } from "react";
import { ClipboardTextIcon, CurrencyDollarIcon } from "@phosphor-icons/react/ssr";

import { Figure, FigureRow } from "@/components/data/FigureRow";
import { FinePrint } from "@/components/data/FinePrint";
import { PagedTable } from "@/components/ui/paged-table";
import { weekTotals, weekTrend, type DolDay, type WeekTotals } from "@/lib/dolDays";
import { formatInt } from "@/lib/format";
import { federalHolidayName } from "@/lib/perm";
import { cn } from "@/lib/utils";
import { monthDay, weekdayName } from "@convex/lib/months";

/**
 * PERM decisions and wage determinations, side by side: the newest week of each against the week before, then a row
 * for each day. A green card through work starts with the wage determination and ends this step with the PERM
 * decision, so the two counts are DOL's pace at both ends of it.
 *
 * The same pairing and the same two colours as the company page's table of wage requests beside PERM applications
 * (StartYears.tsx): wage in lime, PERM in blue. Each bar sits under its own number, so colour never carries it alone.
 *
 * A day one record hasn't reached reads "not counted", never zero (src/lib/dolDays.ts). `rows={false}` draws the two
 * figures only, for a page that links to the full board.
 */
export function DolDaysBoard({
  days,
  rows = true,
  headingId = "dol-days",
  level = 2,
  more,
  className,
}: {
  /** From `dolDays`: complete days, newest first. */
  days: readonly DolDay[];
  /** The day table under the figures. */
  rows?: boolean;
  headingId?: string;
  /** The heading's level: 3 inside a section that has its own heading. */
  level?: 2 | 3;
  /** Where the days and months are, for a page that shows the two figures only. */
  more?: { href: string; label: string };
  className?: string;
}) {
  const newest = days[0];
  if (!newest) return null;
  const perm = weekTotals(days, "perm");
  const wage = weekTotals(days, "wage");
  const holidays = [...new Set(days.slice(0, 7).flatMap((d) => federalHolidayName(d.date) ?? []))];
  const through = monthDay(newest.date) ?? newest.date;
  const max = Math.max(1, ...days.flatMap((d) => [d.perm ?? 0, d.wage ?? 0]));
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <section aria-labelledby={headingId} className={className}>
      <Heading id={headingId} className={cn("scroll-mt-24 font-heading font-bold", level === 3 ? "text-xl" : "text-2xl")}>
        PERM decisions and wage determinations, side by side
      </Heading>{" "}
      {/* One figure a row on a phone: side by side at 358px each chip wrapped to five lines. */}
      <FigureRow className="mt-5 max-sm:[&>*]:basis-full">
        <Figure
          label="PERM decisions, last 7 days"
          icon={<ClipboardTextIcon weight="bold" />}
          value={week(perm)}
          trend={perm ? (weekTrend(perm, holidays) ?? undefined) : undefined}
          note={perm ? `Certified, denied or withdrawn, through ${through}.` : "Our check hasn't reached one of these seven days yet."}
        />{" "}
        <Figure
          label="Wage determinations, last 7 days"
          icon={<CurrencyDollarIcon weight="bold" />}
          value={week(wage)}
          trend={wage ? (weekTrend(wage, holidays) ?? undefined) : undefined}
          note={wage ? `Prevailing wages DOL issued for PERM, through ${through}.` : "Our check hasn't reached one of these seven days yet."}
        />
      </FigureRow>{" "}
      {rows ? (
        <>
          <PagedTable
            className="mt-6 max-w-3xl"
            label="PERM decisions and wage determinations for each day"
            noun="days"
            tableClassName="w-full table-fixed border-collapse text-left tabular-nums"
            caption={<caption className="sr-only">PERM decisions and wage determinations DOL issued each day, newest first</caption>}
            head={
              <thead>
                <tr className="border-b-2 border-border text-sm text-muted-foreground">
                  <th scope="col" className="w-[7.5rem] py-1.5 pr-3 font-bold sm:w-[11rem]">
                    Day{" "}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-bold">
                    PERM decisions{" "}
                  </th>
                  <th scope="col" className="py-1.5 font-bold">
                    Wage determinations{" "}
                  </th>
                </tr>
              </thead>
            }
            rows={days.map((d) => {
              const holiday = federalHolidayName(d.date);
              const dayName = weekdayName(d.date) ?? "";
              const weekend = dayName === "Saturday" || dayName === "Sunday";
              return (
                <tr key={d.date} className={cn("border-b border-border/60", weekend && "bg-muted/40")}>
                  <th scope="row" className="py-2.5 pr-3 align-top text-base font-bold">
                    <span className="whitespace-nowrap">{dayName.slice(0, 3)},</span>{" "}
                    <span className="whitespace-nowrap">{monthDay(d.date) ?? d.date}</span>{" "}
                    {holiday ? <span className="block text-sm font-normal text-muted-foreground">{holiday}, DOL closed </span> : null}
                  </th>
                  <Count value={d.perm} max={max} tone="bg-chart-blue" />
                  <Count value={d.wage} max={max} tone="bg-primary" last />
                </tr>
              );
            })}
          />{" "}
          <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
            Each count is DOL&apos;s own working day, Eastern time. Today joins the list once it&apos;s over.
          </p>{" "}
          <FinePrint summary="How these are counted" className="mt-1">
            <p>
              A PERM decision is a case our daily check of DOL&apos;s case status saw certified, denied or withdrawn that
              day. A wage determination is a PERM prevailing wage request DOL issued a determination on that day, from
              the same kind of check. Both read DOL&apos;s own case status, and each case counts once. A day reads
              &quot;not counted&quot; when one of the two checks hasn&apos;t reached it, which is different from DOL
              issuing nothing.
            </p>
          </FinePrint>{" "}
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-base">
            <Link href="/perm-updates" className="link inline-flex min-h-11 items-center">
              Each day&apos;s PERM decisions, case by case
            </Link>{" "}
            <Link href="/pwd-cases#pwd-now-h" className="link inline-flex min-h-11 items-center">
              What DOL did with wage requests each day
            </Link>
          </p>
        </>
      ) : more ? (
        <p className="mt-3 text-base">
          <Link href={more.href} className="link inline-flex min-h-11 items-center">
            {more.label}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** A week's count, or the words that say it isn't one yet. */
function week(t: WeekTotals | null): string {
  return t ? formatInt(t.last7) : "Not counted yet";
}

/** One day's count over its bar; "not counted" with no bar when the record doesn't cover the day. */
function Count({ value, max, tone, last }: { value: number | null; max: number; tone: string; last?: boolean }) {
  return (
    <td className={cn("py-2.5 align-top", last ? null : "pr-3")}>
      {value === null ? (
        // The space ends the cell's words, so they never run into the next cell's.
        <>
          <span className="text-sm text-muted-foreground">not counted</span>{" "}
        </>
      ) : (
        <Fragment>
          <span className="block font-mono text-base font-bold">{formatInt(value)}</span>{" "}
          <span aria-hidden="true" className="mt-1 block h-2.5 w-full bg-sage">
            {value > 0 ? <span data-bar className={cn("block h-full", tone)} style={{ width: `${(value / max) * 100}%` }} /> : null}
          </span>
        </Fragment>
      )}
    </td>
  );
}
