import type { ReactNode } from "react";

import { SplitBar } from "@/components/data/FigureVisual";
import { WatchThisNumber } from "@/components/tools/WatchThisNumber";
import type { EstimateProgress } from "@/lib/estimateProgress";
import type { FlagProgram } from "@/lib/flagCaseNumber";

/** Where a pending result's email box is, for a link that lands on it. */
export const WATCH_ANCHOR = "watch";

/**
 * The second half of a pending case's answer: when it could be decided, and
 * an email when it moves. Every program's result ends its answer with this,
 * so the date and the alert sit in the same place whatever the number.
 */
export function AnswerNext({
  dateLabel = "Estimated decision",
  date,
  progress = null,
  note,
  caseNumber,
  program,
}: {
  dateLabel?: string;
  /** "Around October 26, 2026", or null when no date can be given. */
  date: ReactNode | null;
  /**
   * How far along the case is by that date (`estimateProgress`): the days left and the share of the estimated wait
   * already behind it, drawn as a bar. Shown only with a date, since both are read off it.
   */
  progress?: EstimateProgress | null;
  /** Under the date (how it's worked out), or in its place (why there's none). */
  note?: ReactNode;
  caseNumber: string;
  program: FlagProgram;
}) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 border-t border-foreground/10 pt-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-10 [&>*]:min-w-0">
      <div>
        {date ? (
          <>
            <p className="text-sm text-soft">{dateLabel}</p>{" "}
            <p className="mt-1 font-heading text-2xl font-bold sm:text-3xl">{date}</p>{" "}
            {progress ? (
              <div className="mt-3">
                {/* Green is the wait behind the case, yellow the wait still ahead: the site's own two colours. */}
                <SplitBar
                  className="max-w-[16rem]"
                  parts={[
                    { value: progress.daysPassed, tone: "good" },
                    { value: progress.daysLeft, tone: "wait" },
                  ]}
                  label={`${progress.daysPassed} of an estimated ${progress.totalDays} days have passed`}
                />{" "}
                <p className="mt-2 text-base leading-snug">
                  <b className="font-semibold">
                    {progress.daysLeft === 0
                      ? "Estimated for today."
                      : `About ${progress.daysLeft} ${progress.daysLeft === 1 ? "day" : "days"} left.`}
                  </b>{" "}
                  <span className="text-soft">{progress.passedPct}% of the estimated wait has passed.</span>
                </p>
              </div>
            ) : null}
          </>
        ) : null}{" "}
        {note ? <div className={date ? "mt-1 text-sm" : "text-base leading-relaxed text-soft"}>{note}</div> : null}
      </div>{" "}
      {/* The ask stands out as the one thing to do here: a tinted band with the action's lime at its edge. On a
          phone it runs the panel's full width. */}
      <div id={WATCH_ANCHOR} className="-mx-5 scroll-mt-24 border-l-4 border-primary bg-tint px-5 py-5 sm:mx-0">
        <WatchThisNumber caseNumber={caseNumber} program={program} variant="inline" />
      </div>
    </div>
  );
}
