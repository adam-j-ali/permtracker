import { TrendChip, type FigureTrend } from "@/components/data/FigureRow";
import { FinePrint } from "@/components/data/FinePrint";
import { PagedTable } from "@/components/ui/paged-table";
import type { MonthAgainst, MonthCount } from "@/lib/decisionMonths";
import { formatInt } from "@/lib/format";
import { SHUTDOWN_SOURCE_URL } from "@/lib/permShutdown2025";
import { MONTH_ABBR, longDate, monthDay, monthYear } from "@convex/lib/months";

/**
 * PERM decisions by month, each against the same days a year earlier (src/lib/decisionMonths.ts).
 *
 * The change is in decisions per working day, so a month with a holiday in it or a month still running isn't read
 * as DOL slowing down. A month the 2025 shutdown emptied is named, never compared: 15,000 against 21 is a closed
 * office, and a percent on it would be the largest and least true figure on the page.
 */
export function DecisionMonths({
  months,
  checksFrom = null,
  headingId = "by-month",
  className,
}: {
  months: readonly MonthAgainst[];
  /** The first day our daily check holds (ISO), read from the record, so the note never states a date the rows contradict. */
  checksFrom?: string | null;
  headingId?: string;
  className?: string;
}) {
  if (months.length === 0) return null;
  const fromChecks = months.some((m) => m.now?.source === "checks");
  const began = longDate(checksFrom);
  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="scroll-mt-24 font-heading text-2xl font-bold">
        Decisions by month, against a year earlier
      </h2>{" "}
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-soft">
        Each month beside the same days a year before. The change is in decisions per workday, so a holiday or a
        month still running doesn&apos;t read as DOL slowing down.
      </p>{" "}
      <PagedTable
        className="mt-5 max-w-3xl"
        label="PERM decisions by month, against a year earlier"
        noun="months"
        tableClassName="w-full border-collapse text-left tabular-nums"
        caption={<caption className="sr-only">PERM decisions each month, the same days a year earlier, and the change per working day</caption>}
        head={
          <thead>
            <tr className="border-b-2 border-border text-sm text-muted-foreground">
              <th scope="col" className="py-1.5 pr-2 font-bold sm:pr-3">
                Month{" "}
              </th>
              <th scope="col" className="py-1.5 pr-2 font-bold sm:pr-3">
                Decided{" "}
              </th>
              <th scope="col" className="py-1.5 pr-2 font-bold sm:pr-3">
                A year earlier{" "}
              </th>
              <th scope="col" className="py-1.5 font-bold">
                Per workday{" "}
              </th>
            </tr>
          </thead>
        }
        rows={months.map((m) => (
          <tr key={m.month} className="border-b border-border/60 align-top">
            <th scope="row" className="py-2.5 pr-2 text-base font-bold sm:pr-3">
              {/* The short month on a phone, where four columns share 358px. */}
              <span className="sm:hidden">{shortMonth(m.month)}</span>{" "}
              <span className="max-sm:hidden">{monthYear(m.month) ?? m.month}</span>{" "}
              {m.toDate && m.now ? (
                <span className="block text-sm font-normal text-muted-foreground">through {monthDay(m.now.to) ?? m.now.to} </span>
              ) : null}
              {m.gap === "part-month" && m.now ? (
                <span className="block text-sm font-normal text-muted-foreground">from {monthDay(m.now.from) ?? m.now.from} </span>
              ) : null}
            </th>
            <Side count={m.now} />
            <Side count={m.then} />
            <td className="py-2.5 text-base">
              <Change month={m} />{" "}
            </td>
          </tr>
        ))}
      />{" "}
      <FinePrint summary="How these are counted, and what isn't compared" className="mt-2">
        <p>
          Months through DOL&apos;s last published quarter are counted from DOL&apos;s own PERM files, by each
          case&apos;s decision date.
          {fromChecks
            ? " The months after it are counted from our daily check of DOL's case status, until DOL publishes them."
            : ""}{" "}
          A workday is Monday to Friday, less federal holidays.
        </p>{" "}
        <p className="mt-3">
          DOL stopped processing on October 1, 2025 and started again on November 3 (
          <a href={SHUTDOWN_SOURCE_URL} className="link" target="_blank" rel="noopener noreferrer">
            DOL&apos;s notice
          </a>
          ). A month measured against those weeks reads &quot;DOL was shut&quot; and gets no percent: thousands
          of decisions against a handful is a closed office. The month after it reads &quot;DOL had just reopened&quot;,
          because DOL was working through what had piled up. A part month has too few days to compare.
          {began
            ? ` Our daily check's first day is ${began}, so the weeks between DOL's last file and that day aren't counted until DOL publishes them.`
            : ""}
        </p>
      </FinePrint>
    </section>
  );
}

/** "2026-11" to "Nov 2026". */
function shortMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_ABBR[Number(m) - 1] ?? m} ${y}`;
}

/** A month's count over the working days it covers; "not counted yet" when neither record holds it. */
function Side({ count }: { count: MonthCount | null }) {
  return (
    <td className="py-2.5 pr-2 sm:pr-3">
      {count ? (
        <>
          <span className="block font-mono text-base font-bold">{formatInt(count.total)}</span>{" "}
          <span className="block whitespace-nowrap text-sm text-muted-foreground">
            {count.workdays === 1 ? "1 workday" : `${formatInt(count.workdays)} workdays`}{" "}
          </span>
        </>
      ) : (
        // The space ends the cell's words: with none, "not counted yet" ran straight into the next cell's number.
        <>
          <span className="text-sm text-muted-foreground">not counted yet</span>{" "}
        </>
      )}
    </td>
  );
}

/** The change per working day, or the plain reason there isn't one. */
function Change({ month }: { month: MonthAgainst }) {
  // Short words in the cell; the note under the table says each in full.
  if (month.gap === "shutdown") return <span className="text-sm text-soft">DOL was shut</span>;
  if (month.gap === "part-month") return <span className="text-sm text-soft">part month</span>;
  if (month.gap === "not-counted" || month.perDayPct === null) return <span className="text-sm text-muted-foreground">not compared</span>;
  return (
    <>
      <TrendChip trend={perDayTrend(month.perDayPct)} />{" "}
      {month.afterShutdown ? <span className="mt-1 block text-sm text-muted-foreground">DOL had just reopened </span> : null}
    </>
  );
}

/** "+37% a day": more decided per working day is good for anyone waiting. Under 5% either way reads as level. */
function perDayTrend(pct: number): FigureTrend {
  if (Math.abs(pct) < 5) return { text: "About the same", dir: "level", tone: "neutral" };
  return pct > 0 ? { text: `${pct}% more`, dir: "up", tone: "good" } : { text: `${-pct}% fewer`, dir: "down", tone: "bad" };
}
