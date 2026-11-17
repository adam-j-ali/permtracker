import { Fragment } from "react";
import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react/ssr";

import { DecisionPeriods } from "@/components/pulse/DecisionPeriods";
import type { ActivityDay } from "@/lib/activityStats";
import type { DecisionViews } from "@/lib/decisionPeriods";
import { type ClosedDay, certifiedShare, pulseHeadline, pulseSummary } from "@/lib/pulseStats";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/format";
import { checkedLabel } from "@/lib/time";
import { weekdayName } from "@convex/lib/months";

/**
 * PERM decisions, day by day: DOL's last working day under our check (a
 * weekend or a federal holiday after it is named, never led with), the
 * figures for the last week and month, and under them the decisions chart
 * (src/components/pulse/DecisionPeriods.tsx): by day, week, month or year,
 * beside a year earlier.
 *
 * The day and the figures count DOL's own decisions, dated by the day DOL
 * worked: the day our sweep saw them change, or the day before when it saw
 * them before 7 AM Eastern (src/lib/dolDay.ts); nothing is modelled.
 *
 * Server component: it renders once per regeneration, and the sweep expires
 * the pages it sits on when it finishes (/api/revalidate-sweep).
 */

function dayLabel(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

/** "Monday, Oct 12 was Columbus Day, a federal holiday: DOL was closed." */
function closedSentence(closed: readonly ClosedDay[]): string {
  return closed
    .map((c) => `${dayLabel(c.date, { weekday: "long", month: "short", day: "numeric" })} was ${c.name}, a federal holiday: DOL was closed.`)
    .join(" ");
}

export interface PermPulseProps {
  /** `sweep-observed` days, any order. Eight weeks covers the comparison and the bars. */
  days: readonly ActivityDay[];
  /** When the sweep last wrote its coverage record, epoch ms. */
  checkedAt: number | null;
  /** Link through to the full record (off on the page that IS the full record). */
  showLink?: boolean;
  /**
   * "band" fills a full-width band; "block" sits inside a page's column;
   * "charts" is the two figures alone, for a band that already names the day
   * (the homepage board carries the day's number, so the band shows its shape).
   */
  variant?: "band" | "block" | "charts";
  /** Every view of the chart under the figures (src/lib/decisionPeriods.ts `decisionViews`). */
  views: DecisionViews;
  /** The list of every day, week, month or year under the chart. */
  table?: boolean;
  className?: string;
}

/** "4% more than the week before (3,460)": this week against the 7 days before it. */
function weekNote(last7: number, prior7: number | null): string | null {
  if (prior7 === null || prior7 <= 0) return null;
  const pct = Math.round(((last7 - prior7) / prior7) * 100);
  if (pct === 0) return `About the same as the week before (${formatInt(prior7)})`;
  return `${Math.abs(pct)}% ${pct > 0 ? "more" : "fewer"} than the week before (${formatInt(prior7)})`;
}

export function PermPulse({ days, checkedAt, showLink = true, variant = "band", views, table = false, className }: PermPulseProps) {
  const head = pulseHeadline(days);
  if (!head) return null;
  const { day, changePct, typical, closedAfter } = head;
  const share = certifiedShare(day);
  const weekday = (weekdayName(day.date) ?? "");
  const up = changePct !== null && changePct >= 0;
  const summary = pulseSummary(days);
  const summaryFigures = summary
    ? [
        { label: "Last 7 days", value: formatInt(summary.last7), note: weekNote(summary.last7, summary.prior7) },
        { label: "Last 30 days", value: formatInt(summary.last30) },
        { label: "A typical weekday", value: summary.weekdayAvg === null ? null : formatInt(summary.weekdayAvg) },
        { label: "Certified, last 30 days", value: summary.certifiedPct === null ? null : `${summary.certifiedPct}%` },
      ].filter((f): f is { label: string; value: string; note?: string | null } => f.value !== null)
    : [];

  const body = (
    <div className={cn(variant === "band" ? "mx-auto max-w-[1400px] px-4 py-12 sm:px-8 sm:py-14" : "", className)}>
      {variant === "charts" ? null : (
      <>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <h2 id="pulse-heading" className="font-heading text-3xl font-bold sm:text-4xl">
          PERM decisions, day by day
        </h2>{" "}
        {checkedAt ? (
          <p className="text-sm text-muted-foreground">
            Checked against DOL {checkedLabel(checkedAt)}
          </p>
        ) : null}
      </div>{" "}

      {/* The day. One dominant figure, then its split. */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4 [&>*]:min-w-0">
        <div className="dark col-span-2 p-5 sm:p-6 border-2 shadow-hard border-black bg-[#141414] text-foreground">
          <p className="text-sm text-soft">
            Decided on {weekday}, {dayLabel(day.date, { month: "short", day: "numeric" })}
          </p>{" "}
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
            <p className="font-heading text-6xl font-bold leading-none tabular-nums">
              {formatInt(day.total)}
            </p>{" "}
            {changePct !== null && typical !== null ? (
              <p
                className="mb-1 inline-flex items-center gap-1.5 bg-card px-2 py-1 text-sm font-semibold"
              >
                {up ? (
                  <ArrowUpIcon className="size-4 text-data-good-ink" weight="bold" aria-hidden="true" />
                ) : (
                  <ArrowDownIcon className="size-4 text-muted-foreground" weight="bold" aria-hidden="true" />
                )}
                {`${up ? "+" : "−"}${Math.abs(changePct)}% vs a typical ${weekday} (${formatInt(typical)})`}
              </p>
            ) : null}
          </div>{" "}
          {closedAfter.length > 0 ? (
            <p className="mt-3 text-sm text-soft">{closedSentence(closedAfter)}</p>
          ) : null}
        </div>{" "}
        <div className="p-5 border-2 shadow-hard-sm bg-card border-border">
          <p className="text-sm text-muted-foreground">Certified</p>{" "}
          <p className="mt-2 font-heading text-4xl font-bold leading-none tabular-nums">{formatInt(day.certified)}</p>{" "}
          {share !== null ? <p className="mt-2 text-sm text-muted-foreground">{share}% of the day</p> : null}
        </div>{" "}
        {/* Two labelled numbers, never "62 · 21": a reader should not have to
            guess which figure is which. */}
        <dl className="m-0 grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 sm:gap-4 [&>*]:min-w-0 border-2 shadow-hard-sm bg-card border-border">
          <div>
            <dt className="text-sm text-muted-foreground">Denied</dt>{" "}
            <dd className="m-0 mt-1 font-heading text-3xl font-bold leading-none tabular-nums sm:mt-2">{formatInt(day.denied)}</dd>
          </div>{" "}
          <div>
            <dt className="text-sm text-muted-foreground">Withdrawn</dt>{" "}
            <dd className="m-0 mt-1 font-heading text-3xl font-bold leading-none tabular-nums sm:mt-2">{formatInt(day.withdrawn)}</dd>
          </div>
        </dl>
      </div>{" "}

      </>
      )}{" "}
      {/* The numbers first: what a reader wants before reading any chart. */}
      <dl className={cn("m-0 grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4 [&>*]:min-w-0", variant !== "charts" ? "mt-8" : "mt-8")}>
        {summaryFigures.map((f) => (
          <Fragment key={f.label}>
            {" "}
            <div>
              <dt className="text-sm text-muted-foreground">{f.label}</dt>{" "}
              <dd className="m-0 mt-1 font-heading text-3xl font-bold leading-none tabular-nums">
                {f.value}
                {f.note ? <span className="mt-1.5 block font-sans text-sm font-normal text-muted-foreground"> {f.note}</span> : null}
              </dd>
            </div>
          </Fragment>
        ))}
      </dl>{" "}
      <DecisionPeriods id={table ? "over-time" : undefined} views={views} highlightDay={day.date} table={table} className="mt-8" />{" "}

      {showLink ? (
        <p className="mt-2">
          <Link href="/perm-decision-activity" className="link inline-flex min-h-11 items-center">
            Every day, and every case that moved
          </Link>
        </p>
      ) : null}
    </div>
  );

  if (variant === "charts") return body;
  return variant === "band" ? (
    <section aria-labelledby="pulse-heading" className="border-b-2 border-border bg-background">
      {body}
    </section>
  ) : (
    <section aria-labelledby="pulse-heading">{body}</section>
  );
}
