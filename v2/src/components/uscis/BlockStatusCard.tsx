import { Fragment } from "react";

import { FigurePlate } from "@/components/tools/FigurePlate";
import { ChartTips } from "@/components/data/ChartTips";
import { BlockMixBar } from "@/components/uscis/BlockMixBar";
import { keepWhole } from "@/components/ui/keep-whole";
import { formatAsOf } from "@/lib/dolFormat";
import { formatInt, formatShareOf } from "@/lib/format";
import type { BlockMix } from "@/lib/uscisSample";

/**
 * One receipt block's cases by status, as one bar: what people pass around in group chats as a picture, drawn from
 * every case the sample holds in the block, each at its newest status. The frame carries the block, the day, the
 * source and the page's address, so a screenshot of it says where it came from.
 *
 * ONE BAR, NOT A PIE. Shares of one whole read best as lengths on one line, and the small outcomes (denied, an
 * evidence request, withdrawn) stay visible as slivers beside a long approved run instead of hairline wedges.
 *
 * THE WAITING CASES BY STEP. Waiting is most of a new block, and "received" and "being processed" are what people
 * ask about, so the steps get their own rows under the bar, each a share of the block's cases like the groups above.
 */

export function BlockStatusCard({
  block,
  asOf,
  mix,
  every,
}: {
  block: string;
  asOf: string;
  mix: BlockMix;
  /** The census checked every number in the block. */
  every: boolean;
}) {
  const when = formatAsOf(asOf) ?? asOf;
  const waitingTotal = mix.waiting.reduce((s, w) => s + w.n, 0);
  return (
    <FigurePlate
      title={`Every case's status in ${block}`}
      subject={every ? `Every number checked, ${when}` : `The cases checked so far, ${when}`}
      caption={
        every
          ? `Each of the block's 100,000 receipt numbers was checked on USCIS's case status page; ${formatInt(mix.total)} of them hold a case. Each case is counted once, at its newest status.`
          : `The cases checked in this block so far, each counted once at its newest status. Not every number in the block has been checked yet, so the share approved for each form below is an estimate with its margin.`
      }
      source={`PERM Tracker's check of USCIS's case status page. permtracker.app/uscis-receipt-blocks/${block}`}
    >
      <p className="font-heading text-5xl font-bold leading-none tabular-nums sm:text-6xl">
        {formatInt(mix.total)}
        <span className="ml-3 font-sans text-xl font-bold">cases</span>
      </p>{" "}
      <ChartTips label={`The ${formatInt(mix.total)} cases in ${block} by status`} className="mt-5">
        <BlockMixBar mix={mix} label={`The cases in ${block} by status`} />
      </ChartTips>{" "}
      <ul className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2 [&>*]:min-w-0" aria-label={`The cases in ${block} by status`}>
        {mix.groups.map((g) => (
          <Fragment key={g.key}>
          <li className="flex min-h-11 items-center gap-3 border-t-2 border-border py-2 text-base">
            <span aria-hidden="true" className={`h-4 w-4 shrink-0 border-2 border-border ${g.fill}`} />{" "}
            <span className="font-bold">{keepWhole(g.label)}</span>{" "}
            <span className="ml-auto font-mono tabular-nums">{formatInt(g.n)}</span>{" "}
            <span className="w-20 text-right font-mono tabular-nums text-muted-foreground">{formatShareOf(g.n, mix.total)}</span>
          </li>{" "}
          </Fragment>
        ))}
      </ul>{" "}
      {mix.waiting.length > 1 ? (
        <div className="mt-6">
          <p className="text-base font-bold">Where the {formatInt(waitingTotal)} waiting cases are</p>{" "}
          {/* Each step's bar is its share of all the block's cases, the same scale as the figure beside it. On a phone
              the bar takes its own line under the step's name. */}
          <ul className="mt-2 space-y-3 sm:space-y-2">
            {mix.waiting.map((w) => (
              <Fragment key={w.label}>
              <li
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-base sm:grid-cols-[12rem_minmax(0,1fr)_10rem]"
              >
                <span>{keepWhole(w.label)}</span>{" "}
                <span aria-hidden="true" className="col-span-2 row-start-2 h-4 border-2 border-border bg-card sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <span className="block h-full bg-chart-yellow" style={{ width: `${Math.max((w.n / mix.total) * 100, 1)}%` }} />
                </span>{" "}
                <span className="whitespace-nowrap text-right font-mono tabular-nums sm:col-start-3 sm:row-start-1">
                  {formatInt(w.n)} <span className="inline-block w-12 text-muted-foreground">{formatShareOf(w.n, mix.total)}</span>
                </span>
              </li>{" "}
              </Fragment>
            ))}
          </ul>
        </div>
      ) : null}
    </FigurePlate>
  );
}
