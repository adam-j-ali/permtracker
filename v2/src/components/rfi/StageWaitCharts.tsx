import { Fragment } from "react";

import { ChartTips } from "@/components/data/ChartTips";
import { formatInt } from "@/lib/format";
import { MOVE_FILL, type MoveTone } from "@/lib/stageMoves";
import type { WaitBucket, WeekExits } from "@/lib/stageWait";
import { cn } from "@/lib/utils";
import { shortDate } from "@convex/lib/months";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * The two pictures on a review stage's page: how long the cases there now have waited, and how many left each
 * week and where they went. Plain server components over `src/lib/stageWait.ts`, each with its numbers in a
 * screen-reader table, its readout on hover, focus and tap (`ChartTips`), and no motion.
 */

const SEEN = "bg-chart-yellow";
const DENIED = "bg-chart-orange";

/** The waiting cases by how long they've waited so far: our seen arrivals and, on an appeal, DOL's denial dates. */
export function StageWaitChart({
  buckets,
  unknown,
  label,
  appeal,
}: {
  buckets: readonly WaitBucket[];
  /** Cases with no start on record, counted under the bars rather than drawn. */
  unknown: number;
  label: string;
  appeal: boolean;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.seen + b.denied));
  const anyDenied = buckets.some((b) => b.denied > 0);
  return (
    <figure className="m-0">
      <div aria-hidden="true" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-3 border border-foreground/40", SEEN)} /> Seen arriving by our daily check
        </span>{" "}
        {appeal && anyDenied ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-3 border border-foreground/40", DENIED)} /> Timed from DOL&apos;s denial date
          </span>
        ) : null}
      </div>{" "}
      <ChartTips label={label} className="mt-4">
        <ol className="space-y-1.5">
          {buckets.map((b) => {
            const n = b.seen + b.denied;
            return (
              <Fragment key={b.key}>
                {" "}
                <li className="grid min-h-11 grid-cols-[8.5rem_1fr_3.5rem] items-center gap-2 [&>*]:min-w-0 sm:grid-cols-[10rem_1fr_4rem] sm:gap-3">
                  <span className="text-sm text-soft">{keepWhole(b.label)}</span>{" "}
                  <span
                    className="flex h-5"
                    data-tip={`${b.label}\n${formatInt(n)} ${n === 1 ? "case" : "cases"}${appeal && b.denied > 0 ? `\n${formatInt(b.seen)} seen arriving, ${formatInt(b.denied)} from the denial date` : ""}`}
                    aria-hidden="true"
                  >
                    {b.seen > 0 ? (
                      <span className={cn("h-full border border-foreground/40", SEEN)} style={{ width: `${(b.seen / max) * 100}%` }} />
                    ) : null}
                    {b.denied > 0 ? (
                      <span className={cn("h-full border border-foreground/40", DENIED)} style={{ width: `${(b.denied / max) * 100}%` }} />
                    ) : null}
                    {n === 0 ? <span className="h-full w-px bg-input" /> : null}
                  </span>{" "}
                  <span className="text-right font-mono text-sm tabular-nums">{formatInt(n)}</span>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </ChartTips>{" "}
      {unknown > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {formatInt(unknown)} more {unknown === 1 ? "case has" : "cases have"} no start on record: they were already
          here when our daily check began on August 30, 2026.
        </p>
      ) : null}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Waited so far{" "}</th>
              <th scope="col">Seen arriving{" "}</th>
              <th scope="col">Timed from the denial date{" "}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key}>
                <th scope="row">{keepWhole(b.label)}{" "}</th>
                <td>{b.seen}{" "}</td>
                <td>{b.denied}{" "}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** What each colour means when a case leaves a stage. */
export const TONE_WORDS: Record<MoveTone, string> = {
  good: "Certified",
  line: "Back to review",
  aside: "On to another step",
  bad: "Denied or NORD issued",
  withdrawn: "Withdrawn",
  other: "Something else",
};

const TONE_ORDER: readonly MoveTone[] = ["good", "line", "aside", "bad", "withdrawn", "other"];

/** Cases leaving the stage each week, split by where they went. The newest week is still running. */
export function StageWeekBars({ weeks, label }: { weeks: readonly WeekExits[]; label: string }) {
  if (weeks.length < 2 || weeks.every((w) => w.total === 0)) return null;
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const present = TONE_ORDER.filter((t) => weeks.some((w) => w.tones[t] > 0));
  const day = (iso: string) => (shortDate(iso) ?? iso).replace(/, \d{4}$/, "");
  return (
    <figure className="m-0">
      <div aria-hidden="true" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {present.map((t) => (
          <Fragment key={t}>
            {" "}
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-3 border border-foreground/40", MOVE_FILL[t])} /> {TONE_WORDS[t]}
            </span>
          </Fragment>
        ))}
      </div>{" "}
      <ChartTips label={label} className="mt-4">
        <div className="flex h-48 items-end gap-1 sm:gap-2">
          {weeks.map((w) => (
            <div key={w.weekStart} className="flex h-full min-w-0 flex-1 flex-col justify-end">{" "}
              <div
                className={cn("flex flex-col-reverse border border-foreground/40", w.partial && "border-dashed")}
                style={{ height: `${Math.max(w.total > 0 ? 2 : 0, (w.total / max) * 100)}%` }}
                data-tip={`Week of ${day(w.weekStart)}${w.partial ? " (so far)" : ""}\n${formatInt(w.total)} left${present
                  .filter((t) => w.tones[t] > 0)
                  .map((t) => `\n${TONE_WORDS[t]}: ${formatInt(w.tones[t])}`)
                  .join("")}`}
                aria-hidden="true"
              >
                {TONE_ORDER.filter((t) => w.tones[t] > 0).map((t) => (
                  <span key={t} className={MOVE_FILL[t]} style={{ height: `${(w.tones[t] / w.total) * 100}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-1.5 flex gap-1 sm:gap-2">
          {weeks.map((w, i) => (
            <Fragment key={w.weekStart}>
              <span className="min-w-0 flex-1 text-center text-sm tabular-nums text-muted-foreground">
                {/* Every other week on a phone, where a column is about 24px wide. */}
                <span className={i % 2 === weeks.length % 2 ? "hidden sm:inline" : undefined}>{day(w.weekStart)}</span>
              </span>{" "}
            </Fragment>
          ))}
        </div>
      </ChartTips>{" "}
      <p className="mt-2 text-sm text-muted-foreground">Each column is a week, Monday to Sunday. The last one is this week so far.</p>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Week of{" "}</th>
              <th scope="col">Left in all{" "}</th>
              {present.map((t) => (
                <th key={t} scope="col">
                  {TONE_WORDS[t]}{" "}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekStart}>
                <th scope="row">{w.weekStart}{" "}</th>
                <td>{w.total}{" "}</td>
                {present.map((t) => (
                  <td key={t}>{w.tones[t]}{" "}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
