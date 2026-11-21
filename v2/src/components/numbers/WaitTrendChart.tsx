import { ColumnChart, type Column } from "@/components/numbers/ColumnChart";
import { PanelTabs } from "@/components/ui/panel-tabs";
import { formatInt } from "@/lib/format";
import { monthSeries, waitWindows, type SeriesMonth, type WaitTrend } from "@/lib/pwdNow";
import { monthTick, monthYear } from "@convex/lib/months";

const SHUTDOWN = "2025-10";

/**
 * How long each month's decisions waited, one column a month (the median,
 * filing to decision), from build_wait_trends.py. A month with no reading is
 * an empty outline, never a zero: October 2025 was the federal shutdown, and
 * the months between DOL's last published file and our own check's dated
 * months have no measurement yet. The newest month is lime; one still under
 * way is hatched.
 *
 * THREE FISCAL YEARS AT A TIME. The PERM trend runs from FY2015 (DOL's older
 * files), about 145 months, and one column a month with 3px gaps runs off a
 * 375px phone past about a hundred. So a long trend shows its newest window
 * first, with a row of choices for each earlier one (`waitWindows`), every
 * window on one scale so they compare; each window is in the page, the ones
 * not picked hidden. A trend of a few years (the wage requests', from FY2024)
 * stays one chart.
 */
export function WaitTrendChart({
  trend,
  noun,
  label,
  idBase = "wait-trend",
}: {
  trend: WaitTrend;
  noun: string;
  label: string;
  /** Prefixes each window's id; unique on the page. */
  idBase?: string;
}) {
  const filesEnd = trend.filesThrough.slice(0, 7);
  const series = monthSeries(trend);
  const newest = series[series.length - 1]!.m;
  const column = (m: SeriesMonth): Column => {
    const name = monthYear(m.m) ?? m.m;
    if (m.gap) {
      return { key: m.m, value: 0, gap: true, label: name, tip: `${name}\nNo reading: ${GAP_WHY[gapReason(m.m, filesEnd)]}` };
    }
    return {
      key: m.m,
      value: m.p50,
      label: name,
      now: m.m === newest,
      partial: m.partial === true,
      tip: `Decided in ${name}${m.partial ? " (so far)" : ""}\nmedian ${formatInt(m.p50)} days\nmiddle half ${formatInt(m.p25)} to ${formatInt(m.p75)} days\n${formatInt(m.n)} ${noun}\n${m.from === "sweep" ? "our check of DOL's case status" : "DOL's published files"}`,
    };
  };
  const chart = (months: SeriesMonth[], chartLabel: string, scaleMax?: number) => (
    <ColumnChart
      columns={months.map(column)}
      label={chartLabel}
      first={monthTick(`${months[0]!.m}-01`) ?? ""}
      last={monthTick(`${months[months.length - 1]!.m}-01`) ?? ""}
      unit="days"
      gapKey={gapKey(months, filesEnd)}
      partialKey="This month so far"
      scaleMax={scaleMax}
    />
  );

  const windows = waitWindows(series);
  if (windows.length < 2) return chart(series, label);
  // One scale for every window: a window of fast years mustn't fill the chart's height as a slow one does.
  const scaleMax = Math.max(1, ...series.map((m) => (m.gap ? 0 : m.p50)));
  return (
    <PanelTabs
      label="Years shown"
      tabs={windows.map((w) => ({
        id: `${idBase}-${w.id}`,
        label: w.label,
        panel: chart(w.months, `${label}, ${w.label}`, scaleMax),
      }))}
    />
  );
}

type GapReason = "shutdown" | "later" | "thin";

const GAP_WHY: Record<GapReason, string> = {
  shutdown: "the federal shutdown: DOL decided almost nothing",
  later: "after DOL's last published file, before our own check's measured months",
  thin: "too few decisions to measure",
};

function gapReason(m: string, filesEnd: string): GapReason {
  return m === SHUTDOWN ? "shutdown" : m > filesEnd ? "later" : "thin";
}

/** The key names only the reasons these months have. */
function gapKey(months: SeriesMonth[], filesEnd: string): string {
  const why = new Set(months.filter((m) => m.gap).map((m) => gapReason(m.m, filesEnd)));
  if (why.size === 1 && why.has("shutdown")) return "No reading: October 2025, the federal shutdown";
  const parts = [
    why.has("shutdown") ? "the October 2025 shutdown" : null,
    why.has("later") ? "not measured yet" : null,
    why.has("thin") ? "too few decisions to measure" : null,
  ].filter((p): p is string => p !== null);
  return `No reading that month: ${parts.join(", or ")}`;
}
