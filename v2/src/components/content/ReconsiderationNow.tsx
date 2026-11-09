import Link from "next/link";
import { Fragment } from "react";

import { getProcessingTimesHistory } from "@/lib/db/processingTimes";
import { getStageStats } from "@/lib/db/stageStats";
import { formatAsOf, formatMonth } from "@/lib/dolFormat";
import { formatInt } from "@/lib/format";
import { furthestWatched, reconsiderationPosted } from "@/lib/reconsiderationPosted";
import { softFail } from "@/lib/softRead";
import { reconsiderationOutcome } from "@/lib/stageMoves";
import { formatShareOf } from "@convex/lib/format";

/**
 * How long a reconsideration request takes, inside the appeal guide, read when the page renders.
 *
 * Two records, kept apart. DOL's own: the month of requests its processing-times page said it was working
 * on, on every reading kept, and the day that line left the page (October 31, 2026). Ours: of the requests
 * the daily check watched arrive, how many had an answer by the furthest day enough of them have been
 * followed to, and how the decided ones ended. Ours shows only from a document built by the rule that leaves
 * the record's catch-up out (it carries `since`): before that, cases first seen already waiting would be
 * counted as new arrivals. A failed read says where the figures live instead.
 */
const STAGE = "RECONSIDERATION APPEALS";

export async function ReconsiderationNow() {
  const [history, stats] = await Promise.all([
    getProcessingTimesHistory(120).catch(softFail("ReconsiderationNow.getProcessingTimesHistory", null)),
    getStageStats().catch(softFail("ReconsiderationNow.getStageStats", null)),
  ]);
  const posted = history ? reconsiderationPosted(history) : null;
  const ours = stats?.since ? stats : null;
  const watched = ours ? furthestWatched(ours.durations?.find((d) => d.stage.toUpperCase() === STAGE)?.curve ?? []) : null;
  const outcome = ours ? reconsiderationOutcome(ours.exits) : null;
  const since = ours ? formatAsOf(ours.since) : null;

  if (!posted && !watched && !outcome) {
    return (
      <p>
        The live figures are unavailable for the moment. The{" "}
        <Link href="/perm-rfi-audit#step-by-step" className="link">
          RFI, audit and appeal page
        </Link>{" "}
        carries what our record holds.
      </p>
    );
  }

  return (
    <div className="not-prose my-6 object p-5 text-base leading-relaxed sm:p-6">
      {posted ? (
        <div>
          <p className="text-sm font-bold text-muted-foreground">DOL&apos;s last posting</p>{" "}
          <p className="mt-1 font-heading text-3xl font-bold leading-tight">
            About {posted.last.monthsBehind} {posted.last.monthsBehind === 1 ? "month" : "months"} behind
          </p>{" "}
          <p className="mt-2">
            On {formatAsOf(posted.last.asOf)}, DOL&apos;s processing-times page said it was working on reconsideration
            requests from {formatMonth(posted.last.month)}.
          </p>{" "}
          <ul className="mt-3 list-disc pl-5">
            {posted.runs.map((r) => (
              <Fragment key={r.month}>
                <li>
                  <b className="font-bold">{formatMonth(r.month)}:</b>{" "}
                  {r.from === r.to ? `posted ${formatAsOf(r.from)}` : `posted from ${formatAsOf(r.from)} to ${formatAsOf(r.to)}`}
                </li>{" "}
              </Fragment>
            ))}
          </ul>{" "}
          {posted.droppedAsOf ? (
            <p className="mt-3">
              DOL&apos;s page has left this line out since its {formatAsOf(posted.droppedAsOf)} update, so no newer
              official month exists.
            </p>
          ) : null}
        </div>
      ) : null}{" "}
      {watched || outcome ? (
        <div className={posted ? "mt-5 border-t-2 border-border pt-5" : undefined}>
          <p className="text-sm font-bold text-muted-foreground">Our own record{since ? `, since ${since}` : ""}</p>{" "}
          {watched ? (
            <p className="mt-1">
              Of the {formatInt(watched.eligible)} requests our daily check watched arrive and has followed for at
              least {watched.days} days,{" "}
              <b className="font-bold">
                {formatInt(watched.left)} ({formatShareOf(watched.left, watched.eligible)}) had an answer by then
              </b>
              .
            </p>
          ) : null}{" "}
          {outcome ? (
            <p className={watched ? "mt-2" : "mt-1"}>
              Of the {formatInt(outcome.decided)} requests it has seen decided, {formatInt(outcome.granted)} (
              {formatShareOf(outcome.granted, outcome.decided)}) were granted and {formatInt(outcome.refused)} were
              refused with a NORD or a denial.
            </p>
          ) : null}{" "}
          <p className="mt-2 text-sm text-muted-foreground">
            A request already waiting when our record began isn&apos;t timed, because its start isn&apos;t known.
          </p>
        </div>
      ) : null}
    </div>
  );
}
