import { Fragment } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/ssr";

import {
  MIN_DECIDED_FOR_BAND_RATE,
  coarsenBands,
  reversals,
  worstBand,
  type WageBandRate,
  type WageBandSeries,
} from "@/lib/wageLadder";
import { cn } from "@/lib/utils";
import { ChartTips } from "@/components/data/ChartTips";
import { FinePrint } from "@/components/data/FinePrint";
import { MoreText } from "@/components/data/MoreText";

/**
 * Denial rate by wage band, at the resolution the data actually supports.
 *
 * AN EARLIER VERSION OF THIS COMPONENT SHIPPED A FINDING THAT WAS A BINNING
 * ARTEFACT, and the retraction is the reason it now looks like this. With five
 * wide bands the pooled corpus reads 5.22 / 5.21 / 2.88 / 2.04 / 1.47 and each
 * fiscal year appeared to tell a tidy story, including "FY2024 falls at every
 * step". At eleven bands over the same cases, FY2024 goes 9.47% then 12.18%:
 * it does not fall at every step, it never did, and the claim was a property of
 * where the edges were drawn rather than of the filings.
 *
 * So the coarse view is no longer a finding. It is a SUMMARY, drawn second,
 * derived by summing the fine buckets so it cannot disagree with them, and
 * labelled as the thing that hides the structure above it.
 *
 * WHAT SURVIVES EVERY RESOLUTION, and is therefore all this figure claims:
 *   - the rate broadly falls as the wage rises, roughly 5% to roughly 1.4%
 *   - it does not fall smoothly, at any binning tried
 *   - the top is not the floor: over $160k is higher than $130k-$160k in
 *     each of FY2024 to FY2026 (1.63 vs 1.37, 0.91 vs 0.74, 2.38 vs 2.11), on
 *     tens of thousands of cases each, which a single "over $130k" band erases
 *
 * THE OLDER FILES' YEARS (FY2008 to FY2023, `history` on the series) sit in a
 * closed block of their own, on their own scale: their wages are as offered
 * then, so a band holds a different part of each year's range, and their
 * rates would otherwise set the scale the recent years are read on. The pooled
 * panel pools the recent years only, and its title says which.
 *
 * NO CAUSE IS OFFERED, and the reason is the same one the site gives for
 * refusing a blended risk score: wage, occupation and employer are entangled,
 * the low bands are dominated by particular occupations, and nothing here can
 * separate them. Naming a cause would be narrating a story over a correlation.
 */

export interface DenialByWageBandProps {
  /** Per-year series at FINE resolution, oldest first. */
  byYear: WageBandSeries[];
  /** The pooled window across every year, at FINE resolution. */
  pooled: WageBandRate[];
  className?: string;
}

function Panel({
  title,
  bands,
  max,
  note,
}: {
  title: string;
  bands: WageBandRate[];
  max: number;
  note: string;
}) {
  const worst = worstBand(bands);
  return (
    <div className="bg-sage p-4 border-2 border-border">
      <p className="text-sm font-bold text-muted-foreground">
        {title}
      </p>{" "}
      <p className="mt-0.5 text-sm text-muted-foreground">{note}</p>{" "}
      <ChartTips label={`Denial rate by wage band, ${title}`} className="mt-3">
      <ul className="space-y-2">
        {bands.map((b) => {
          const isWorst = worst != null && b.from === worst.from;
          return (
            // Keyed Fragment with a trailing space: array items render with
            // NOTHING between them, so "20,120" glues to "FY2025".
            <Fragment key={b.from}>
            <li
              data-tip={[
                `${title}: ${b.band}`,
                b.deniedPct === null
                  ? "Rate withheld, too few decided cases"
                  : `${b.deniedPct.toFixed(2)}% denied`,
                `${b.denied.toLocaleString("en-US")} denied of ${b.decided.toLocaleString("en-US")} decided`,
                b.interval ? `95% interval ${b.interval.lo.toFixed(2)} to ${b.interval.hi.toFixed(2)}%` : null,
                isWorst ? "The highest rate in this block" : null,
              ]
                .filter(Boolean)
                .join("\n")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold">{b.band}</span>{" "}
                <span className="font-mono text-sm font-bold tabular-nums text-muted-foreground">
                  {b.deniedPct === null ? "withheld" : `${b.deniedPct.toFixed(2)}%`}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-3 min-w-0 flex-1 border-input bg-background border">
                  {b.deniedPct === null ? null : (
                    <div
                      // The worst band in each panel is outlined rather than
                      // recoloured. A second colour would have to mean a
                      // second thing, and "highest in this panel" is the same
                      // measurement, marked.
                      className={cn(
                        // Denials in the soft red; the worst band edged in the
                        // red's ink (round 3: no black marks).
                        "h-full bg-chart-red",
                        isWorst && "outline-2 outline-offset-0 outline-data-bad-ink",
                      )}
                      style={{
                        width: `${Math.min(100, (b.deniedPct / max) * 100)}%`,
                      }}
                    />
                  )}
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {b.decided.toLocaleString("en-US")}
                </span>
              </div>
              {/* The interval sits with its own rate, not in a footnote. It is
                  what separates "this band is worse" from "this band looks
                  worse": in FY2025 and FY2026 the $60k-$80k interval clears
                  the sub-$60k interval entirely, so the hump is a measurement
                  rather than an impression. */}
              {b.interval ? (
                <p className="mt-0.5 font-mono text-sm tabular-nums text-muted-foreground">
                  95% interval {b.interval.lo.toFixed(2)} to{" "}
                  {b.interval.hi.toFixed(2)}%
                </p>
              ) : null}
            </li>{" "}
            </Fragment>
          );
        })}
      </ul>
      </ChartTips>
    </div>
  );
}

/** "FY2024", or "FY2024 to FY2026", for the years given; null for none. */
function yearSpan(series: readonly WageBandSeries[]): string | null {
  const years = series.map((s) => s.fiscalYear).sort();
  if (years.length === 0) return null;
  return years.length === 1 ? `FY${years[0]}` : `FY${years[0]} to FY${years[years.length - 1]}`;
}

/** The bar scale for a block: its highest rate. */
const scaleOf = (bands: readonly WageBandRate[]) => Math.max(1, ...bands.map((b) => b.deniedPct ?? 0));

export function DenialByWageBand({
  byYear,
  pooled,
  className,
}: DenialByWageBandProps) {
  const recent = byYear.filter((s) => !s.history);
  const earlier = byYear.filter((s) => s.history);
  const max = scaleOf([...recent.flatMap((s) => s.bands), ...pooled]);
  const earlierMax = scaleOf(earlier.flatMap((s) => s.bands));
  const pooledYears = yearSpan(recent);
  const earlierYears = yearSpan(earlier);
  // Summed from the fine bands rather than queried, so the summary and the
  // structure are the same numbers at two resolutions by construction.
  const coarse = coarsenBands(pooled);
  const coarseMax = Math.max(1, ...coarse.map((b) => b.deniedPct ?? 0));

  const known = pooled.filter((b) => b.deniedPct !== null);
  const lowest = known[0];
  const highest = known[known.length - 1];
  const peak = worstBand(pooled);
  const bumps = reversals(pooled);

  return (
    <div className={className}>
      {/* The reading goes ABOVE the drawing. A reader who forms an impression
          from the bars first and meets the caveat afterwards has already been
          misled, which is exactly how the retracted version worked. */}
      <MoreText gist={"Denials fall as the offered wage rises."}>
        <p className="text-base leading-relaxed text-soft">
          The denial rate broadly falls as the offered wage rises
          {lowest && highest ? (
            <>
              , from {(lowest.deniedPct as number).toFixed(1)}% in the{" "}
              {lowest.band.toLowerCase()} band to{" "}
              {(highest.deniedPct as number).toFixed(1)}% in the{" "}
              {highest.band.toLowerCase()} band
            </>
          ) : null}
          . It doesn&apos;t fall smoothly.{" "}
          {peak ? (
            <>
              The highest rate here is {peak.band.toLowerCase()} at{" "}
              {(peak.deniedPct as number).toFixed(2)}%. That band isn&apos;t the bottom of the
              range.{" "}
            </>
          ) : null}
          {bumps.length > 0 ? (
            <>
              {bumps.length === 1 ? "One pair of neighbouring bands goes" : `${bumps.length} pairs of neighbouring bands go`}{" "}
              the wrong way.{" "}
            </>
          ) : null}
          Where those bumps sit moves with the band edges, so no cause is offered
          for them: wage, occupation and employer are entangled here and nothing
          separates them.
        </p>
      </MoreText>{" "}
      <p className="mt-6 text-sm font-bold text-muted-foreground">
        Eleven bands, by fiscal year and pooled
      </p>
      <div className="mt-3 grid [&>*]:min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {recent.map((s) => (
          <Fragment key={s.fiscalYear}>
            <Panel
              title={`FY${s.fiscalYear}`}
              bands={s.bands}
              max={max}
              note="Denied, of decided"
            />{" "}
          </Fragment>
        ))}
        <Panel
          title={pooledYears ? `${pooledYears}, pooled` : "Pooled"}
          bands={pooled}
          max={max}
          note="The pooled window"
        />
      </div>

      {/* The summary comes SECOND and says what it costs. */}
      <div className="mt-8 bg-sage p-4 border-2 border-border">
        <p className="text-sm font-bold text-muted-foreground">
          The same cases in five wide bands
        </p>{" "}
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          It&apos;s summed from the eleven above. It averages the{" "}
          {peak ? peak.band.toLowerCase() : "peak"} band with its quieter
          neighbours, so a plateau appears where the finer view has a peak.
        </p>
        <div className="mt-4">
          <Panel
            title="Pooled summary"
            bands={coarse}
            max={coarseMax}
            note="Derived from the eleven-band view"
          />
        </div>
      </div>

      {earlier.length > 0 ? (
        <details data-earlier-years className="group mt-8">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-base font-bold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
            <CaretRightIcon
              className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
              weight="bold"
              aria-hidden="true"
            />{" "}
            Earlier years, {earlierYears}, from DOL&apos;s older files
          </summary>{" "}
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Wages are as offered in each year, with no adjustment for inflation. A band therefore holds a
            different part of each year&apos;s range, so compare a year&apos;s bands with each other. These bars
            have a scale of their own.
          </p>{" "}
          <div className="mt-3 grid [&>*]:min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {earlier.map((s) => (
              <Fragment key={s.fiscalYear}>
                <Panel
                  title={`FY${s.fiscalYear}`}
                  bands={s.bands}
                  max={earlierMax}
                  note="Denied, of decided"
                />{" "}
              </Fragment>
            ))}
          </div>
        </details>
      ) : null}

      {/* The denominator changes how every rate reads, so it stays visible.
          How the drawing works is provenance, and collapses. */}
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Withdrawn cases are excluded, because a withdrawal is the employer stopping.
        It isn&apos;t a decision going against anyone. A band with fewer than{" "}
        {MIN_DECIDED_FOR_BAND_RATE.toLocaleString("en-US")} decided cases is
        withheld rather than drawn.
      </p>{" "}
      <FinePrint summary="Reading the bars" className="mt-2">
        <p>
          Bars share one scale within each block. The figure on the right of
          each bar is the number of decided cases behind it.
        </p>
      </FinePrint>
    </div>
  );
}
