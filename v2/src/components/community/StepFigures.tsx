import { Fragment } from "react";
import Link from "next/link";

import { ChartTips } from "@/components/data/ChartTips";
import { TrendChip } from "@/components/data/FigureRow";
import { formatInt } from "@/lib/format";
import { stepTrend, stepsIn, windowText, type StepFigure, type StepGroup, type StepMonth } from "@/lib/reportedSummary";
import { cn } from "@/lib/utils";

/**
 * How long each step took, from every case people reported (src/lib/reportedSummary.ts): one card per step with the
 * middle half of the cases as a bar and the median marked, which way it moved against the 6 months before, and a
 * line of the last 12 months by the month each case finished. Every bar shares one scale, so two steps compare by
 * eye. A step with too few cases says how many it has, never a figure. Server-rendered, no client code.
 *
 * Used wherever a step is the page's subject: the timelines page draws them all, a step's own page its group, an
 * office or a consulate its own summary. Each card names its window and its count.
 */

const days = (n: number) => `${formatInt(n)} ${n === 1 ? "day" : "days"}`;
const monthName = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" });

function MonthLine({ s }: { s: StepFigure }) {
  const top = Math.max(1, ...s.months.map((m) => m.median ?? 0));
  const shown = s.months.filter((m) => m.median !== null);
  if (shown.length < 2) return null;
  const tip = (m: StepMonth) =>
    m.median === null
      ? `${monthName(m.month)}\n${m.n === 0 ? "No cases finished" : `${formatInt(m.n)} ${m.n === 1 ? "case" : "cases"}, too few for a median`}`
      : `${monthName(m.month)}\nMedian ${days(m.median)}\n${formatInt(m.n)} cases finished`;
  return (
    <div className="mt-4">
      <p className="text-sm font-bold">By the month each case finished</p>{" "}
      <div className="mt-2 flex h-14 items-end gap-[3px]" aria-hidden="true">
        {s.months.map((m) => (
          <span
            key={m.month}
            data-tip={tip(m)}
            className={cn(
              "flex-1",
              m.median === null ? "h-2 border border-dashed border-foreground/40" : "bg-chart-blue",
            )}
            style={m.median === null ? undefined : { height: `${Math.max(6, (m.median / top) * 100)}%` }}
          />
        ))}
      </div>{" "}
      <p className="mt-1 flex justify-between text-sm text-muted-foreground" aria-hidden="true">
        <span>{monthName(s.months[0]!.month)}</span> <span>{monthName(s.months[s.months.length - 1]!.month)}</span>
      </p>{" "}
      <p className="sr-only">
        {`The median by month: ${shown.map((m) => `${monthName(m.month)}, ${days(m.median!)}`).join("; ")}.`}
      </p>
    </div>
  );
}

function StepCard({ s, pct }: { s: StepFigure; pct: (d: number) => string }) {
  const trend = stepTrend(s);
  const measured = s.median !== null && s.p25 !== null && s.p75 !== null;
  return (
    <li className="min-w-0 bg-sage p-4 border-2 border-border">
      <p className="font-heading text-base font-bold">{s.label}</p>{" "}
      <p className="mt-1 text-sm text-muted-foreground">
        {measured
          ? `${formatInt(s.n)} ${s.n === 1 ? "case" : "cases"} finished in ${windowText(s.windowDays)}, ${s.verified ? "DOL's record" : "self-reported"}`
          : s.allTime > 0
            ? `${formatInt(s.n)} in the last 12 months, ${formatInt(s.allTime)} ever reported`
            : "None reported yet"}
      </p>{" "}
      {measured ? (
        <>
          <div
            className="relative mt-3 h-6 border-input bg-card border"
            aria-hidden="true"
            data-tip={`${s.label}\nMedian ${days(s.median!)}\nMiddle half ${formatInt(s.p25!)} to ${days(s.p75!)}\n${formatInt(s.n)} cases, ${windowText(s.windowDays)}`}
          >
            <span
              className={cn("absolute inset-y-0 border-x-2 border-input", s.verified ? "bg-primary" : "bg-card bg-hatch text-primary-text")}
              style={{ left: pct(s.p25!), width: `calc(${pct(s.p75!)} - ${pct(s.p25!)})` }}
            />{" "}
            <span className="absolute inset-y-[-4px] w-1 bg-data-warn-ink ring-2 ring-card" style={{ left: pct(s.median!) }} />
          </div>{" "}
          <p className="mt-2 text-base">
            <b>Median {days(s.median!)}</b>,{" "}
            <span className="text-muted-foreground">the middle half {formatInt(s.p25!)} to {days(s.p75!)}</span>
          </p>{" "}
          {trend ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <TrendChip trend={trend} />{" "}
              <span>{`than the 6 months before (${days(s.before!.median)}, ${formatInt(s.before!.n)} cases)`}</span>
            </p>
          ) : null}
          <MonthLine s={s} />
        </>
      ) : (
        <p className="mt-2 text-base text-muted-foreground">
          {`A figure needs 5 cases finished in the last 12 months${s.n > 0 ? `, and this step has ${formatInt(s.n)}` : ""}.`}
        </p>
      )}
    </li>
  );
}

export function StepFigures({
  steps,
  scaleFrom,
  label = "Days each step took, the median and the middle half",
  allHref,
  className,
}: {
  steps: readonly StepFigure[];
  /** The steps the shared scale is set from, when these cards are one stage of a longer list. */
  scaleFrom?: readonly StepFigure[];
  label?: string;
  /** A link to every step from every source, when this is one page's part of it. */
  allHref?: string;
  className?: string;
}) {
  if (steps.length === 0) return null;
  // One scale for every bar, rounded up to a whole 60 days so the axis reads as chosen.
  const top = Math.max(60, ...(scaleFrom ?? steps).map((s) => s.p75 ?? 0));
  const span = Math.ceil(top / 60) * 60;
  const pct = (d: number) => `${Math.min(100, (d / span) * 100)}%`;
  return (
    <div className={className}>
      <ChartTips label={label}>
        <ul className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 [&>*]:min-w-0">
          {steps.map((s) => (
            <Fragment key={s.id}>
              {" "}
              <StepCard s={s} pct={pct} />
            </Fragment>
          ))}
        </ul>
      </ChartTips>{" "}
      {allHref ? (
        <p className="mt-4 text-base">
          <Link href={allHref} className="link font-bold">
            Every step, from every source
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** The journey's stages, each with the step groups it holds, in order. */
export const STAGE_GROUPS: readonly { groups: readonly StepGroup[]; title: string }[] = [
  { groups: ["h1b", "pwd", "perm"], title: "Before and during PERM" },
  { groups: ["i140"], title: "The I-140" },
  { groups: ["i485"], title: "The I-485" },
  { groups: ["consular"], title: "At the consulate" },
];

/**
 * Every step, stage by stage: a card for each step with a figure, and one line naming the steps that don't have
 * enough cases yet, each with its count, so a reader sees what's measured and what's coming without a page of
 * empty cards.
 */
export function StepsByStage({
  steps,
  stages = STAGE_GROUPS,
  headingLevel = 3,
}: {
  steps: readonly StepFigure[];
  stages?: readonly { groups: readonly StepGroup[]; title: string }[];
  headingLevel?: 3 | 4;
}) {
  const H = headingLevel === 3 ? "h3" : "h4";
  // One scale for the whole page, so a PERM bar and an I-485 bar compare by eye.
  const measured = steps.filter((s) => s.median !== null);
  return (
    <div className="grid grid-cols-1 gap-8">
      {stages.map((st) => {
        const inStage = stepsIn(steps, ...st.groups);
        if (inStage.length === 0) return null;
        const shown = inStage.filter((s) => s.median !== null);
        const waiting = inStage.filter((s) => s.median === null);
        return (
          <section key={st.title} aria-label={st.title}>
            <H className="font-heading text-xl font-bold">{st.title}</H>{" "}
            {shown.length ? <StepFigures steps={shown} scaleFrom={measured} className="mt-3" /> : null}{" "}
            {waiting.length ? (
              <div className="mt-3 max-w-3xl">
                <p className="text-base text-muted-foreground">
                  {shown.length ? "Too few cases yet for a figure:" : "No step here has enough cases for a figure yet:"}
                </p>{" "}
                <ul className="mt-1 list-disc pl-5 text-base text-muted-foreground">
                  {waiting.map((s) => (
                    <li key={s.id}>
                      {`${s.label}, ${s.allTime === 0 ? "none reported yet" : `${formatInt(s.allTime)} ever reported`} `}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
