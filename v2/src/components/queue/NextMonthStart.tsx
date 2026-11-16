import Link from "next/link";
import { Fragment } from "react";

import { ChartTips } from "@/components/data/ChartTips";
import { FinePrint } from "@/components/data/FinePrint";
import { PageSection } from "@/components/data/PageSection";
import type { BacklogMonth } from "@/lib/backlogMonths";
import { HOLD_STATUS } from "@/lib/employerStages";
import { formatInt } from "@/lib/format";
import type { MonthStart, NextStart } from "@/lib/monthStart";
import { ANALYST_REVIEW } from "@/lib/searchStages";
import { cn } from "@/lib/utils";
import { formatShare, formatShareOf } from "@convex/lib/format";

import { stageOf } from "./stages";
import { MONTH_NAMES, monthDay, monthYear, weekdayName } from "@convex/lib/months";

/**
 * "When does DOL start the next month?", answered from DOL's own record.
 *
 * Everyone waiting on a PERM case asks it, and the answers passed around are
 * rules of thumb. The picture is the month DOL is working down, as a bar of
 * its decided cases, with the share the month before had reached each time
 * DOL began the next one marked on it. Where the bar's end sits against
 * that mark is the answer; the date says it in words, and the last starts
 * below show the mark isn't a guess.
 *
 * The bar leaves out the cases on hold, as the estimate does (DOL set them
 * aside), and says how many it left out. Every figure is printed beside the
 * marks, so the marks are hidden from assistive technology and ChartTips adds
 * the readouts on hover, tap and arrow keys.
 */

const SEGMENTS = [
  { key: "decided", label: "Decided", tone: "bg-data-good" },
  { key: "aside", label: "At RFI, audit or appeal", tone: "bg-chart-blue" },
  { key: "inLine", label: "Still in analyst review", tone: "bg-card bg-hatch text-input" },
] as const;

type SegmentKey = (typeof SEGMENTS)[number]["key"];

/** The current month's cases DOL can decide, split three ways for the bar. */
export function splitMonth(m: BacklogMonth): Record<SegmentKey, number> {
  let decided = 0;
  let aside = 0;
  let inLine = 0;
  for (const s of m.statuses) {
    if (s.isFinal) decided += s.count;
    else if (stageOf(s.status, ANALYST_REVIEW) === "analyst") inLine += s.count;
    else if (s.status !== HOLD_STATUS) aside += s.count;
  }
  return { decided, aside, inLine };
}

/** "March 2026" as "March": the heading's year sits in the title. */
function monthName(ym: string): string {
  return MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym;
}

/** "Friday, Nov 20". */
function day(iso: string): string {
  return `${weekdayName(iso)}, ${monthDay(iso)}`;
}

/** The headline answer, in the fewest words. */
export function answerLine(est: NextStart): string {
  if (est.state === "due") return `Due now: likely ${day(est.from)}`;
  if (!est.from || !est.to) return `After about ${formatInt(est.needHigh)} more ${monthName(est.current)} decisions`;
  if (est.from === est.to) return `Likely ${day(est.from)}`;
  return `Likely between ${day(est.from)} and ${day(est.to)}`;
}

/** "80% to 82%", or one share when the starts agree. */
function shareSpan(est: NextStart): string {
  const lo = formatShare(est.shareLow);
  const hi = formatShare(est.shareHigh);
  return lo === hi ? lo : `${lo} to ${hi}`;
}

/** "the last three months", "the last month". */
function lastOnes(n: number, noun: "month" | "start"): string {
  if (n === 1) return `the last ${noun}`;
  const count = n === 2 ? "two" : n === 3 ? "three" : formatInt(n);
  return `the last ${count} ${noun}s`;
}

export function NextMonthStart({
  est,
  current,
  className,
}: {
  est: NextStart;
  /** The live census month DOL is working down: the bar's split. */
  current: BacklogMonth;
  className?: string;
}) {
  const split = splitMonth(current);
  const workable = split.decided + split.aside + split.inLine;
  const now = monthName(est.current);
  const next = monthName(est.month);
  const pct = (n: number) => `${(n / workable) * 100}%`;
  const decidedShare = formatShareOf(split.decided, workable);
  const lowPct = est.shareLow * 100;
  const highPct = est.shareHigh * 100;

  return (
    <PageSection
      id="next-month"
      title={`When DOL starts ${monthYear(est.month)}`}
      className={className}
      lede={
        <>
          DOL began each of {lastOnes(est.basedOn.length, "month")} once the month before was about {shareSpan(est)}{" "}
          decided.{" "}
          {now} is {decidedShare} decided.
        </>
      }
    >
      <p className="font-heading text-3xl font-bold leading-tight sm:text-4xl">{answerLine(est)}</p>{" "}
      <p className="mt-3 max-w-prose text-base leading-relaxed text-soft">
        <NextSteps est={est} now={now} next={next} />
      </p>{" "}

      <figure className="mt-10">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="text-base font-bold">
            {monthYear(est.current)}: {formatInt(split.decided)} of {formatInt(workable)} decided
          </span>{" "}
          {est.held > 0 ? (
            <span className="text-sm text-muted-foreground">
              {formatInt(est.held)} on hold left out
            </span>
          ) : null}
        </figcaption>{" "}
        <ChartTips label={`${monthYear(est.current)}: decided, and where ${next} began before`} className="mt-10">
          <div className="relative" aria-hidden="true">
            {/* Where the month before stood at each recent start: two ink rules and the span between. */}
            <div
              className="absolute -top-8 bottom-0 border-x-2 border-foreground bg-foreground/15"
              style={{ left: `${lowPct}%`, width: `max(2px, ${highPct - lowPct}%)` }}
              data-tip={`Where ${lastOnes(est.basedOn.length, "month")} began\nThe month before was ${shareSpan(est)} decided`}
            />{" "}
            <span
              className="absolute -top-8 whitespace-nowrap pr-2 text-sm font-bold leading-6"
              style={{ right: `${100 - lowPct}%` }}
            >
              {lastOnes(est.basedOn.length, "month").replace(/^the/, "The")} began here
            </span>{" "}
            <div className="flex h-10 w-full overflow-hidden border border-input sm:h-12">
              {SEGMENTS.map((s) =>
                split[s.key] > 0 ? (
                  <div
                    key={s.key}
                    className={cn("h-full", s.tone)}
                    style={{ width: pct(split[s.key]) }}
                    data-tip={`${s.label}\n${formatInt(split[s.key])} of ${formatInt(workable)} in ${monthYear(est.current)}`}
                  />
                ) : null,
              )}
            </div>
          </div>
        </ChartTips>{" "}
        <div className="mt-2 flex justify-between font-mono text-sm tabular-nums text-muted-foreground" aria-hidden="true">
          <span>0%</span>{" "}
          <span>100%</span>
        </div>{" "}
        <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {SEGMENTS.map((s) => (
            <Fragment key={s.key}>
              {" "}
              <li className="flex items-center gap-2">
                <span className={cn("inline-block size-3.5 shrink-0 border border-input", s.tone)} aria-hidden="true" />{" "}
                <span className="text-soft">{s.label}</span>{" "}
                <span className="font-mono font-semibold tabular-nums">{formatInt(split[s.key])}</span>
              </li>
            </Fragment>
          ))}
        </ul>
      </figure>{" "}

      <div className="mt-12">
        <h3 className="font-heading text-xl font-bold">
          {lastOnes(est.basedOn.length, "start").replace(/^the/, "The")}
        </h3>{" "}
        <ol className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8 [&>*]:min-w-0">
          {[...est.basedOn].reverse().map((s) => (
            <Fragment key={s.month}>
              {" "}
              <PastStart start={s} />
            </Fragment>
          ))}
        </ol>
      </div>{" "}

      <FinePrint summary="How this is estimated" className="mt-10">
        <div className="max-w-prose space-y-3 text-base leading-relaxed text-soft">
          <p>
            A start is the first day DOL decided 50 or more of a month&rsquo;s cases. The month before is read as it
            stood the evening before. Only its cases DOL can decide count, so the ones on hold are left out: DOL set
            them aside.
          </p>{" "}
          <p>
            The pace is {now}&rsquo;s decisions per working day since it began, over the last week at most. Weekends
            and federal holidays aren&rsquo;t working days.
          </p>{" "}
          <p>
            We ran it on the record as it stood each working day before the last two starts. In the two weeks before
            each start, it named the real day or a working day either side of it. Three weeks out, it ran up to four
            working days late.
          </p>{" "}
          <p>
            DOL publishes none of this. PERM Tracker reads it from DOL&rsquo;s own case statuses, case by case, each
            day. Three starts is a short record, and the date moves when DOL&rsquo;s pace does.
          </p>
        </div>
      </FinePrint>
    </PageSection>
  );
}

/**
 * The same answer in one sentence, for the next month's own page: someone who
 * filed in that month asks it there, and the reasoning is a link away.
 */
export function startSentence(est: NextStart): string {
  const label = monthYear(est.month);
  const now = monthName(est.current);
  if (est.state === "due") {
    return `DOL will likely start ${label} on its next working day, ${day(est.from)}: ${now} is past the point where the last months began.`;
  }
  if (!est.from || !est.to) {
    return `DOL will likely start ${label} after about ${formatInt(roundTen(est.needHigh))} more ${now} decisions.`;
  }
  const when = est.from === est.to ? `on ${day(est.from)}` : `between ${day(est.from)} and ${day(est.to)}`;
  return `DOL will likely start ${label} ${when}, once ${now} is about ${shareSpan(est)} decided.`;
}

export function NextStartLine({ est, className }: { est: NextStart; className?: string }) {
  return (
    <p className={cn("max-w-prose text-base leading-relaxed", className)}>
      <b className="font-bold">{startSentence(est)}</b>{" "}
      <Link href="/perm-queue#next-month" className="link">
        How that&rsquo;s worked out
      </Link>
    </p>
  );
}

/** The sentence under the answer: what's left, at what pace. */
function NextSteps({ est, now, next }: { est: NextStart; now: string; next: string }) {
  if (est.state === "due") {
    return (
      <>
        {now} is already past that point, so {next} is due on the next working day DOL decides cases.
      </>
    );
  }
  // An estimate's figures to the nearest ten: "about 603" claims a precision a range doesn't have.
  const low = roundTen(est.needLow);
  const high = roundTen(est.needHigh);
  const need =
    low === high
      ? `About ${formatInt(high)} more ${now} decisions to go.`
      : `About ${formatInt(low)} to ${formatInt(high)} more ${now} decisions to go.`;
  if (est.pace === null) {
    return (
      <>
        {need} {now} only began on {day(est.currentStarted)}, so there isn&rsquo;t a pace to date it by yet.
      </>
    );
  }
  const days = Math.max(1, Math.ceil(est.needHigh / est.pace));
  return (
    <>
      {need} {now} has run about {formatInt(roundTen(est.pace))} a working day since it began on{" "}
      {day(est.currentStarted)}, which takes about {days} working {days === 1 ? "day" : "days"}.
    </>
  );
}

function roundTen(n: number): number {
  return n < 10 ? n : Math.round(n / 10) * 10;
}

/** One past start: the month that began, the day, and the month before as a short bar. */
function PastStart({ start }: { start: MonthStart }) {
  const share = formatShareOf(start.previousDecided, start.previousWorkable);
  return (
    <li className="border-t-2 border-border pt-4">
      <span className="block text-base font-bold">{monthYear(start.month)}</span>{" "}
      <span className="mt-1 block text-base text-soft">Began {day(start.day)}</span>{" "}
      <span className="mt-3 flex h-3 w-full overflow-hidden border border-input" aria-hidden="true">
        <span className="block h-full bg-data-good" style={{ width: `${start.previousShare * 100}%` }} />
        <span className="block h-full flex-1 bg-card bg-hatch text-input" />
      </span>{" "}
      <span className="mt-3 block text-sm leading-relaxed text-soft">
        {monthName(start.previous)} was {share} decided, with {formatInt(start.previousInLine)} still in analyst
        review.
      </span>
    </li>
  );
}
