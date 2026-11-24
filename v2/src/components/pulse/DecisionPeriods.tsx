"use client";

import { Fragment, useEffect, useState } from "react";

import { ChartTips } from "@/components/data/ChartTips";
import { ColumnChart } from "@/components/numbers/ColumnChart";
import { TrendChip, type FigureTrend } from "@/components/data/FigureRow";
import { FinePrint } from "@/components/data/FinePrint";
import { choiceVariants } from "@/components/ui/choice";
import { ChoiceRow } from "@/components/ui/choice-row";
import { PagedTable } from "@/components/ui/paged-table";
import type { WeekdayProfile } from "@/lib/activityStats";
import type { DecisionViews, PeriodAgainst, PeriodCount, PeriodUnit, WeekStanding } from "@/lib/decisionPeriods";
import { formatInt } from "@/lib/format";
import { federalHolidayName } from "@/lib/perm";
import { SHUTDOWN_SOURCE_URL } from "@/lib/permShutdown2025";
import { cn } from "@/lib/utils";
import { MONTH_ABBR, MONTH_NAMES, WEEKDAY_NAMES, longDate, monthDay, monthYear } from "@convex/lib/months";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * PERM decisions over time, by day, week, month or year, each beside the same days a year earlier: one chart with a
 * switch, and beside it the usual shape of the span shown (a week by its days, a year by its months). Every number
 * comes from src/lib/decisionPeriods.ts, built once on the server; this file only draws it and keeps the reader's pick.
 *
 * THE BARS ARE HTML, NOT SVG: SVG text scales with its viewBox and shrank 13px labels to 5.5px in a phone column.
 * A stretch neither record holds is hatched, never drawn as zero. The server renders the day view, so the chart is
 * whole before any script runs.
 */

const UNIT_WORDS: Record<PeriodUnit, { button: string; noun: string; plural: string; column: string }> = {
  day: { button: "Days", noun: "day", plural: "days", column: "Day" },
  week: { button: "Weeks", noun: "week", plural: "weeks", column: "Week" },
  month: { button: "Months", noun: "month", plural: "months", column: "Month" },
  year: { button: "Years", noun: "year", plural: "years", column: "Year" },
};

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const shortWeekday = (iso: string) => WEEKDAY_NAMES[at(iso).getUTCDay()]!.slice(0, 3);

/** "Mon, Nov 16, 2026", "Week of November 9, 2026", "November 2026", "2026". */
function longLabel(p: PeriodAgainst): string {
  if (p.unit === "day") return `${shortWeekday(p.key)}, ${monthDay(p.key)}, ${p.key.slice(0, 4)}`;
  if (p.unit === "week") return `Week of ${longDate(p.start)}`;
  if (p.unit === "month") return monthYear(p.key) ?? p.key;
  return p.key;
}

const GAP_WORDS: Record<NonNullable<PeriodAgainst["gap"]>, string> = {
  shutdown: "DOL was shut",
  holiday: "a federal holiday on one of the two days",
  weekend: "a weekend day",
  part: "too few days to compare",
  "not-counted": "not compared",
};

function changeWords(p: PeriodAgainst): string {
  const pct = p.pct ?? 0;
  const way = `${Math.abs(pct)}% ${pct >= 0 ? "more" : "fewer"}`;
  return p.unit === "day" ? way : `${way} a working day`;
}

function yearEarlierLine(p: PeriodAgainst): string {
  if (!p.then) return "A year earlier: not on record";
  const why = p.pct !== null ? changeWords(p) : p.gap ? GAP_WORDS[p.gap] : "not compared";
  return `A year earlier: ${formatInt(p.then.total)} (${why})`;
}

function tipFor(p: PeriodAgainst, compare: boolean): string {
  const lines = [`${longLabel(p)}${p.toDate ? " (so far)" : ""}`];
  if (!p.now) return [...lines, "Not in our record"].join("\n");
  lines.push(
    `${formatInt(p.now.total)} decided`,
    `${formatInt(p.now.certified)} certified`,
    `${formatInt(p.now.denied)} denied`,
    `${formatInt(p.now.withdrawn)} withdrawn`,
  );
  const holiday = p.unit === "day" ? federalHolidayName(p.key) : null;
  if (holiday) lines.push(`${holiday}: DOL closed`);
  if (p.missingWorkdays > 0) lines.push(`${formatInt(p.missingWorkdays)} working days not in our record`);
  if (compare) lines.push(yearEarlierLine(p));
  return lines.join("\n");
}

const partial = (p: PeriodAgainst) => p.toDate || p.missingWorkdays > 0;

export function DecisionPeriods({
  views,
  highlightDay = null,
  table = false,
  bare = false,
  grow = false,
  id,
  className,
}: {
  views: DecisionViews;
  /** The day the headline above names, outlined in the day view. */
  highlightDay?: string | null;
  /** The list of every period under the chart, with its change against a year earlier. */
  table?: boolean;
  /** The chart alone, for a tile that frames and titles it: the day view, no switch, no side figure, no note. */
  bare?: boolean;
  /** Fill the rest of a tile (bare only). */
  grow?: boolean;
  /** An anchor for the whole chart, its switch and its list. */
  id?: string;
  className?: string;
}) {
  const [unit, setUnit] = useState<PeriodUnit>("day");
  const [compare, setCompare] = useState(true);

  // A link to "#by-month" (or any unit) opens on that view.
  useEffect(() => {
    const m = /^#by-(day|week|month|year)$/.exec(window.location.hash);
    // The hash exists only in the browser, after the server's render.
    if (m && !bare) setUnit(m[1] as PeriodUnit);
  }, [bare]);

  const units = (Object.keys(UNIT_WORDS) as PeriodUnit[]).filter((u) => views.periods[u]?.length);
  const periods = views.periods[unit] ?? [];
  if (periods.length === 0) return null;
  const shown = [...periods].reverse();
  const words = UNIT_WORDS[unit];
  const first = shown[0]!;
  const last = shown[shown.length - 1]!;
  const title =
    unit === "year" ? `Every year on record, ${first.key} to ${last.key}` : `The last ${shown.length} ${words.plural}`;

  const chart = (
    <ColumnChart
      className="mt-4"
      label={`PERM decisions per ${words.noun}, ${longLabel(first)} to ${longLabel(last)}`}
      unit="Decided"
      first={tickLabel(first)}
      last={tickLabel(last)}
      height={grow ? "min-h-44" : "h-40 sm:h-48"}
      grow={grow}
      gapKey={gapKey(views)}
      partialKey="Still running, or only part of it in our record"
      markKey="The same days a year earlier"
      columns={shown.map((p) => ({
        key: p.key,
        value: p.now?.total ?? 0,
        label: longLabel(p),
        tip: tipFor(p, compare),
        gap: !p.now,
        now: unit === "day" && p.key === highlightDay,
        partial: Boolean(p.now) && partial(p),
        href: unit === "day" ? `/perm-updates/${p.key}` : undefined,
        parts: p.now ? OUTCOMES.map((o) => ({ value: p.now![o.key], fill: o.fill, label: o.label })) : undefined,
        mark: compare && p.then ? p.then.total : undefined,
      }))}
    />
  );

  if (bare) {
    return (
      <div className={cn(grow && "flex flex-1 flex-col", className)}>
        <OutcomeKey />
        {chart}
      </div>
    );
  }

  return (
    <div id={id} className={cn("scroll-mt-24", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <ChoiceRow
          label="Count decisions by"
          options={units.map((u) => ({ value: u, label: UNIT_WORDS[u].button }))}
          value={unit}
          onChange={setUnit}
          // One row of four on a phone, where a fourth button wrapped onto a line of its own.
          rowClassName="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2 [&>button]:px-2 sm:[&>button]:px-4"
        />{" "}
        <button
          type="button"
          aria-pressed={compare}
          onClick={() => setCompare((c) => !c)}
          className={choiceVariants({ on: compare })}
        >
          Mark the same days a year earlier
        </button>
      </div>{" "}

      {unit === "week" && views.weekStanding ? (
        <p className="mt-5 max-w-3xl text-base leading-relaxed">{standingLine(views.weekStanding)}</p>
      ) : null}{" "}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <figure className="m-0 flex flex-col bg-card p-5 lg:col-span-2 border-2 shadow-hard-sm border-border">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <span className="text-base font-semibold">{title}</span>{" "}
            <OutcomeKey />
          </figcaption>{" "}
          {chart}
        </figure>{" "}

        {unit === "month" || unit === "year" ? (
          <YearShape year={views.year} />
        ) : (
          <WeekShape
            week={unit === "day" ? views.weekRecent : views.weekSpan}
            over={unit === "day" ? "the last 4 weeks" : `these ${shown.length} weeks`}
          />
        )}
      </div>{" "}

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {unit === "day"
          ? "Counted from DOL's own case status, by the day DOL worked: a change our check saw before 7 AM counts on the day before."
          : sourceNote(views)}
      </p>

      {table ? <PeriodTable periods={periods} unit={unit} views={views} /> : null}
    </div>
  );
}

/** The three outcomes, in the site's status colours: withdrawn is the employer's own step, in the withdrawn purple. */
const OUTCOMES = [
  { key: "certified", label: "Certified", fill: "bg-data-good-ink" },
  { key: "denied", label: "Denied", fill: "bg-data-bad-ink" },
  { key: "withdrawn", label: "Withdrawn by the employer", fill: "bg-chart-purple" },
] as const satisfies readonly { key: keyof PeriodCount; label: string; fill: string }[];

function OutcomeKey() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-soft">
      {OUTCOMES.map((o) => (
        <li key={o.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-3", o.fill)} /> {keepWhole(o.label)}{" "}
        </li>
      ))}
    </ul>
  );
}

/**
 * The newest whole week against the weeks before it, as people pass it around: "The week of Nov 16: 4,619 decided,
 * the most since the week of Aug 31 (4,773)." When counting Monday to Friday alone gives a newer week, the line says
 * the weekend made the difference, with both weekday counts.
 */
function standingLine(s: WeekStanding): string {
  const year = s.week.start.slice(0, 4);
  const week = (iso: string) => `the week of ${monthDay(iso) ?? iso}${iso.slice(0, 4) === year ? "" : `, ${iso.slice(0, 4)}`}`;
  const word = s.kind === "most" ? "the most" : "the fewest";
  const head = s.since
    ? `${word} since ${week(s.since.start)} (${formatInt(s.since.total)})`
    : `${word} of any week back to ${week(s.back)}, as far as our record runs without a gap`;
  const line = `The week of ${monthDay(s.week.start) ?? s.week.start}: ${formatInt(s.week.total)} decided, ${head}.`;
  const wd = s.weekdaysOnly;
  if (!wd) return line;
  const pair = `(${formatInt(wd.total)} against ${formatInt(wd.mine)})`;
  return s.kind === "most" && s.week.weekend > 0
    ? `${line} The weekend made the difference: DOL decided ${formatInt(s.week.weekend)} on Saturday and Sunday, and Monday to Friday alone ${week(wd.start)} had more ${pair}.`
    : `${line} Weekend work made the difference: Monday to Friday alone, ${week(wd.start)} had ${s.kind === "most" ? "more" : "fewer"} ${pair}.`;
}

/** The tick under the first and last column: "Oct 18", "Week of May 25", "Dec 2025", "2008". */
function tickLabel(p: PeriodAgainst): string {
  if (p.unit === "day") return monthDay(p.key) ?? p.key;
  if (p.unit === "week") return `Week of ${monthDay(p.start)}`;
  if (p.unit === "month") return `${MONTH_ABBR[Number(p.key.slice(5, 7)) - 1] ?? ""} ${p.key.slice(0, 4)}`;
  return p.key;
}

/** What an empty frame means, with the record's own dates. */
function gapKey(views: DecisionViews): string {
  const file = longDate(views.fileTo);
  const checks = longDate(views.checksFrom);
  return file && checks
    ? `Not in our record yet: DOL's file ends ${file}, and our daily check began ${checks}`
    : "Not in our record yet";
}

/** Where a week, month or year view's counts come from, read off the records themselves. */
function sourceNote(views: DecisionViews): string {
  const parts: string[] = [];
  if (views.fileTo) parts.push(`DOL's published PERM files, by decision date, through ${longDate(views.fileTo)}`);
  if (views.checksFrom) parts.push(`our daily check of DOL's case status from ${longDate(views.checksFrom)}`);
  return `Counted from ${parts.join(", then ")}. A stretch neither holds is an empty frame, never drawn as zero, and each year-earlier mark covers the same days.`;
}

/** The average day of the week over the span shown: working days in green, the weekend in sage. */
function WeekShape({ week, over }: { week: readonly WeekdayProfile[]; over: string }) {
  const weekMax = Math.max(1, ...week.map((w) => w.mean));
  return (
    <figure className="m-0 bg-card p-5 border-2 shadow-hard-sm border-border">
      <figcaption>
        <span className="block text-base font-semibold">A typical week</span>{" "}
        <span className="block text-sm text-muted-foreground">Average of {over}</span>
      </figcaption>{" "}
      <ChartTips label="Average decisions by day of the week">
        <div className="mt-4 flex h-40 items-end gap-2 sm:h-48" role="img" aria-label={`Average decisions by day of the week over ${over}.`}>
          {week.map((w) => {
            // The profile counts Monday first; the shared names count Sunday first.
            const dayName = WEEKDAY_NAMES[(w.weekday + 1) % 7];
            return (
              <div
                key={w.label}
                data-tip={w.days ? `${dayName}\nAbout ${formatInt(w.mean)} decided\nAverage of ${w.days} ${dayName}s` : `${dayName}\nNone on record yet`}
                className="flex h-full flex-1 flex-col justify-end text-center"
              >
                <span className="mb-1 text-sm font-semibold tabular-nums">{w.days ? formatInt(w.mean) : ""}</span>{" "}
                <div
                  className={cn(w.days && "border-t-2 border-data-good-ink", w.weekday >= 5 ? "bg-chart-sage" : "bg-chart-green")}
                  style={{ height: w.days ? `${Math.max(2, (w.mean / weekMax) * 100)}%` : "0" }}
                />
              </div>
            );
          })}
        </div>
      </ChartTips>{" "}
      <div aria-hidden="true" className="mt-2 flex gap-2 text-center text-sm text-muted-foreground">
        {week.map((w) => (
          <Fragment key={w.label}>
            <span className="flex-1">{w.label.slice(0, 2)}</span>{" "}
          </Fragment>
        ))}
      </div>
    </figure>
  );
}

/** Decisions per working day by calendar month, over the newest complete years in DOL's file. */
function YearShape({ year }: { year: DecisionViews["year"] }) {
  const max = Math.max(1, ...year.months.map((m) => m.perWorkday ?? 0));
  const span = year.years ? (year.years.from === year.years.to ? `${year.years.from}` : `${year.years.from} to ${year.years.to}`) : null;
  return (
    <figure className="m-0 bg-card p-5 border-2 shadow-hard-sm border-border">
      <figcaption>
        <span className="block text-base font-semibold">A typical year</span>{" "}
        <span className="block text-sm text-muted-foreground">
          {span ? `Decisions per working day, ${span}` : "Not enough whole years on record yet"}
        </span>
      </figcaption>{" "}
      {span ? (
        <>
          <ChartTips label="Decisions per working day by month">
            <div className="mt-4 flex h-40 items-end gap-1 sm:h-48" role="img" aria-label={`Decisions per working day in each month, ${span}.`}>
              {year.months.map((m) => (
                <div
                  key={m.month}
                  data-tip={`${MONTH_NAMES[m.month - 1]}\n${m.perWorkday === null ? "No working day" : `About ${formatInt(m.perWorkday)} a working day`}\nAverage of ${span}`}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                >
                  <div
                    className="border-t-2 border-data-good-ink bg-chart-green"
                    style={{ height: m.perWorkday ? `${Math.max(2, (m.perWorkday / max) * 100)}%` : "0" }}
                  />
                </div>
              ))}
            </div>
          </ChartTips>{" "}
          <div aria-hidden="true" className="mt-2 flex gap-1 text-center text-sm text-muted-foreground">
            {year.months.map((m) => (
              <Fragment key={m.month}>
                {/* One letter: twelve columns share a third of the row, and the readout names each month. */}
                <span className="min-w-0 flex-1">{MONTH_NAMES[m.month - 1]!.slice(0, 1)}</span>{" "}
              </Fragment>
            ))}
          </div>
          <div className="sr-only">
            <table>
              <caption>Decisions per working day by month, {span}</caption>
              <thead>
                <tr>
                  <th scope="col">Month{" "}</th>
                  <th scope="col">Per working day{" "}</th>
                </tr>
              </thead>
              <tbody>
                {year.months.map((m) => (
                  <tr key={m.month}>
                    <th scope="row">{MONTH_NAMES[m.month - 1]}{" "}</th>
                    <td>{m.perWorkday ?? "none"}{" "}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </figure>
  );
}

/** Every period of the view, newest first, with the same days a year earlier and the change. */
function PeriodTable({ periods, unit, views }: { periods: readonly PeriodAgainst[]; unit: PeriodUnit; views: DecisionViews }) {
  const words = UNIT_WORDS[unit];
  const began = longDate(views.checksFrom);
  return (
    <section aria-labelledby="by-period-heading" className="mt-8 scroll-mt-24">
      {/* Old links name the month list. */}
      <span id="by-month" className="block scroll-mt-24" />
      <h3 id="by-period-heading" className="font-heading text-xl font-bold">
        Each {words.noun} against a year earlier
      </h3>{" "}
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-soft">
        {unit === "day"
          ? "Each day beside the same weekday 52 weeks before."
          : `Each ${words.noun} beside the same days a year before. The change is in decisions per working day, so a holiday or a ${words.noun} still running doesn't read as DOL slowing down.`}
      </p>{" "}
      <PagedTable
        key={unit}
        className="mt-5 max-w-3xl"
        label={`PERM decisions by ${words.noun}, against a year earlier`}
        noun={words.plural}
        tableClassName="w-full border-collapse text-left tabular-nums"
        caption={<caption className="sr-only">PERM decisions each {words.noun}, the same days a year earlier, and the change</caption>}
        head={
          <thead>
            <tr className="border-b-2 border-border text-sm text-muted-foreground">
              <th scope="col" className="py-1.5 pr-2 font-bold sm:pr-3">
                {words.column}{" "}
              </th>
              <th scope="col" className="py-1.5 pr-2 font-bold sm:pr-3">
                Decided{" "}
              </th>
              <th scope="col" className="py-1.5 pr-2 font-bold sm:pr-3">
                A year earlier{" "}
              </th>
              <th scope="col" className="py-1.5 font-bold">
                {unit === "day" ? "Change" : "Per workday"}{" "}
              </th>
            </tr>
          </thead>
        }
        rows={periods.map((p) => (
          <tr key={p.key} className="border-b border-border/60 align-top">
            <th scope="row" className="py-2.5 pr-2 text-base font-bold sm:pr-3">
              {rowLabel(p)}{" "}
              {p.toDate && p.now ? (
                <span className="block text-sm font-normal text-muted-foreground">through {monthDay(p.now.to) ?? p.now.to} </span>
              ) : null}
              {p.gap === "part" && p.now ? (
                <span className="block text-sm font-normal text-muted-foreground">from {monthDay(p.now.from) ?? p.now.from} </span>
              ) : null}
            </th>
            <Side count={p.now} days={unit !== "day"} />
            <Side count={p.then} days={unit !== "day"} />
            <td className="py-2.5 text-base">
              <Change period={p} />{" "}
            </td>
          </tr>
        ))}
      />{" "}
      <FinePrint summary="How these are counted, and what isn't compared" className="mt-2">
        <p>
          Periods through DOL&apos;s last published quarter are counted from DOL&apos;s own PERM files, by each
          case&apos;s decision date. The days after it are counted from our daily check of DOL&apos;s case status, until
          DOL publishes them. A workday is Monday to Friday, less federal holidays. A week or a day is set beside the same
          weekdays 52 weeks earlier; a month or a year beside the same dates.
        </p>{" "}
        <p className="mt-3">
          DOL stopped processing on October 1, 2025 and started again on November 3 (
          <a href={SHUTDOWN_SOURCE_URL} className="link" target="_blank" rel="noopener noreferrer">
            DOL&apos;s notice
          </a>
          ). A period measured against those weeks reads &quot;DOL was shut&quot; and gets no percent: thousands of
          decisions against a handful is a closed office. The weeks after it read &quot;DOL had just reopened&quot;,
          because DOL was working through what had piled up. A period with a hole in the record is compared only when it
          still holds 20 working days, and then over the same days a year earlier.
          {began
            ? ` Our daily check's first day is ${began}, so the weeks between DOL's last file and that day aren't counted until DOL publishes them.`
            : ""}
        </p>
      </FinePrint>
    </section>
  );
}

/** A row's name: "Mon, Nov 16" on a phone with its year on wider screens, the week's Monday, the month, the year. */
function rowLabel(p: PeriodAgainst) {
  if (p.unit === "month") {
    const [y, m] = p.key.split("-");
    return (
      <>
        <span className="sm:hidden">{`${MONTH_ABBR[Number(m) - 1] ?? m} ${y}`}</span>{" "}
        <span className="max-sm:hidden">{monthYear(p.key) ?? p.key}</span>
      </>
    );
  }
  if (p.unit === "week") return `Week of ${monthDay(p.start)}, ${p.start.slice(0, 4)}`;
  if (p.unit === "day") return `${shortWeekday(p.key)}, ${monthDay(p.key)}, ${p.key.slice(0, 4)}`;
  return p.key;
}

/** A period's count over the working days it covers; "not counted yet" when neither record holds it. */
function Side({ count, days }: { count: PeriodCount | null; days: boolean }) {
  return (
    <td className="py-2.5 pr-2 sm:pr-3">
      {count ? (
        <>
          <span className="block font-mono text-base font-bold">{formatInt(count.total)}</span>{" "}
          {days ? (
            <span className="block whitespace-nowrap text-sm text-muted-foreground">
              {count.workdays === 1 ? "1 workday" : `${formatInt(count.workdays)} workdays`}{" "}
            </span>
          ) : null}
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

/** The change, or the plain reason there isn't one. */
function Change({ period }: { period: PeriodAgainst }) {
  // Short words in the cell; the note under the table says each in full.
  if (period.gap === "shutdown") return <span className="text-sm text-soft">DOL was shut</span>;
  if (period.gap === "holiday") {
    return <span className="text-sm text-soft">{federalHolidayName(period.key) ? "a holiday" : "a holiday a year earlier"}</span>;
  }
  if (period.gap === "weekend") return <span className="text-sm text-muted-foreground">weekend</span>;
  if (period.gap === "part") return <span className="text-sm text-soft">part {period.unit}</span>;
  if (period.gap === "not-counted" || period.pct === null) return <span className="text-sm text-muted-foreground">not compared</span>;
  return (
    <>
      <TrendChip trend={changeTrend(period.pct)} />{" "}
      {period.afterShutdown ? <span className="mt-1 block text-sm text-muted-foreground">DOL had just reopened </span> : null}
    </>
  );
}

/** More decided is good for anyone waiting. Under 5% either way reads as level. */
function changeTrend(pct: number): FigureTrend {
  if (Math.abs(pct) < 5) return { text: "About the same", dir: "level", tone: "neutral" };
  return pct > 0 ? { text: `${pct}% more`, dir: "up", tone: "good" } : { text: `${-pct}% fewer`, dir: "down", tone: "bad" };
}
