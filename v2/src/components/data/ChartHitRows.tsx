"use client";

import { useSyncExternalStore } from "react";

import { ChartHit, type HitRow } from "./ChartHit";

/**
 * The hover columns of a chart with hundreds of points, drawn by the browser from compact rows (`hitRow`).
 *
 * A `ChartHit` drawn on the server costs each point twice: its markup in the HTML, and the same tree again in the
 * page's data for the browser. The weekly decisions chart's 1,003 weeks cost /perm-decision-activity 0.83 MB that
 * way (Nov 23 2026). Here each point arrives as four numbers and its tip, and the columns are drawn once the page
 * has started. A tooltip needs the browser anyway (`ChartTips`), so nothing a reader can use before then is missing,
 * and the chart's summary is its own `aria-label`. A chart of a few dozen points keeps `ChartHit` on the server.
 */

const never = () => () => {};

export function ChartHitRows({ rows, y, height }: { rows: readonly HitRow[]; y: number; height: number }) {
  // False on the server and while hydrating, true once the page has started: the server's HTML and the first
  // render agree, then the columns follow.
  const started = useSyncExternalStore(never, () => true, () => false);
  if (!started) return null;
  return (
    <>
      {rows.map(([x, width, cx, cy, tip], i) => (
        <ChartHit key={i} tip={tip} x={x} width={width} y={y} height={height} cx={cx} cy={cy} />
      ))}
    </>
  );
}
