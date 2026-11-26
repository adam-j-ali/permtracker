"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartTips } from "@/components/data/ChartTips";
import { useUrlSearchParams } from "@/hooks/useUrlSearchParams";
import { CircleNotchIcon, WarningIcon } from "@phosphor-icons/react";

import { Label } from "@/components/ui/label";
import { SelectedInFull } from "@/components/tools/SelectedInFull";
import { FilterCombobox } from "@/components/ui/filter-combobox";
import {
  MIN_FOR_MEDIAN,
  reportability,
  type WagePercentiles,
} from "@/lib/wageStats";
import { cn } from "@/lib/utils";
import { MAX_CITY } from "@/lib/wagePlaceFilters";
import { SECTOR_GROUPS, sectorGroup } from "@/lib/naicsSectors";
import { formatDollars, formatInt } from "@/lib/format";
import { StateWageSpread } from "@/components/tools/StateWageSpread";
import { choiceVariants } from "@/components/ui/choice";
// A type only: BLS's crosswalk itself stays on the server.
import type { EarlierSocCode } from "@/lib/socCrosswalk";
import { keepWhole } from "@/components/ui/keep-whole";

/**
 * Offered wages in DOL's disclosure files, filtered.
 *
 * TWO THINGS THIS GETS RIGHT ON PURPOSE.
 *
 * Percentiles are computed over the SELECTED subset, in SQL, not sliced out of
 * a corpus-wide figure. A median that silently describes 373,162 cases while
 * the reader has filtered to one occupation in one state is the failure this
 * whole page exists to avoid.
 *
 * And a thin selection reports nothing rather than something. Below thirty
 * cases no figure appears at all; between thirty and a hundred the middle
 * appears and the 5th and 95th are withheld, because at that size each tail
 * rests on fewer than five filings. The reason is stated ABOVE the numbers, so
 * a figure computed from a thin population can never read as more
 * authoritative than the doubt about it.
 *
 * Certified-only is the default because a denied case's offered wage was
 * never agreed to by anyone, and a benchmark should be of wages that stood.
 */

export interface WageOption {
  value: string;
  label: string;
  n: number;
}

export interface StateWageRow extends WagePercentiles {
  state: string;
}

export interface SalaryExplorerProps {
  occupations: readonly WageOption[];
  /** The JSON route the filtered views come from. Default: the PERM wages route. */
  apiPath?: string;
  /** The question at the top, in the reader's words. */
  heading?: string;
  /** What one row is called: "case" for PERM, "LCA" for H-1B filings. */
  noun?: string;
  nounPlural?: string;
  states: readonly WageOption[];
  fiscalYears: readonly string[];
  /**
   * The years among `fiscalYears` from DOL's older files, worked out ahead by
   * occupation and state: a city or an industry can't narrow them.
   */
  historyYears?: readonly string[];
  /**
   * What the no-year choice pools, in words ("FY2024 to FY2026"). Without one
   * it reads "All years", true where the picker holds every year it pools.
   */
  pooledLabel?: string;
  /** Rendered before any fetch, so the default view needs no JavaScript. */
  initial: ExplorerPayload;
  /**
   * Offer the worksite-city and industry narrowings. Only the PERM route
   * accepts them (`lib/wagePlaceFilters.ts`); the LCA table carries neither
   * column until its backfill has run.
   */
  placeFilters?: boolean;
}

export interface ExplorerPayload {
  stats: WagePercentiles;
  bins: { from: number; count: number }[];
  binWidth: number;
  below: number;
  above: number;
  byState: StateWageRow[];
  /**
   * A year of DOL's older files and a job BLS renumbered in 2018: the 2010 codes holding its cases there, each
   * counted on its own (the PERM route only).
   */
  earlierCodes?: EarlierSocCode[];
  /** Which other jobs those 2010 codes also covered. */
  earlierNote?: string | null;
}

const STATUSES = [
  { value: "certified", label: "Certified only" },
  { value: "all", label: "Every outcome" },
  { value: "denied", label: "Denied only" },
  { value: "withdrawn", label: "Withdrawn only" },
];

const usd = (n: number | null) =>
  n === null ? "n/a" : formatDollars(n);

const NO_YEARS: readonly string[] = [];

const FIELD =
  "mt-2 block w-full min-w-0 min-h-[44px] border-2 border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:text-muted-foreground";

/**
 * A city as typed, committed on Enter or on leaving the field, so a reader
 * typing "Seattle" doesn't fire six requests. Keyed on the committed value by
 * the parent, so a cleared state resets it without an effect.
 */
function CityField({
  id,
  value,
  disabled,
  reason,
  onCommit,
}: {
  id: string;
  value: string;
  disabled: boolean;
  /** Why it's disabled, when that isn't the missing state. */
  reason?: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const commit = () => {
    const v = text.replace(/\s+/g, " ").trim();
    if (v !== value) onCommit(v);
  };
  return (
    <input
      id={id}
      type="text"
      value={text}
      disabled={disabled}
      maxLength={MAX_CITY}
      autoComplete="off"
      placeholder={disabled ? reason || "Choose a state first" : "e.g. Seattle"}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className={FIELD}
    />
  );
}

export function SalaryExplorer({
  occupations,
  apiPath = "/api/perm-wages",
  heading = "What does this job pay on a PERM?",
  noun = "case",
  nounPlural = "cases",
  states,
  fiscalYears,
  historyYears = NO_YEARS,
  pooledLabel,
  initial,
  placeFilters = false,
}: SalaryExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useUrlSearchParams();
  const ids = { soc: useId(), state: useId(), fy: useId(), status: useId(), city: useId(), sector: useId() };
  // A 2010 code picked from an older year's offer ("15-1132"), by its title: the
  // occupation list holds the codes the current files use.
  const [earlierPicked, setEarlierPicked] = useState<Record<string, string>>({});
  // A code typed ("15-1252") finds its title too.
  const occupationOptions = useMemo(
    () => [
      ...occupations.map((o) => ({ value: o.value, label: `${o.label} (${formatInt(o.n)})`, keywords: o.value })),
      ...Object.entries(earlierPicked)
        .filter(([code]) => !occupations.some((o) => o.value === code))
        .map(([code, title]) => ({ value: code, label: `${title} (a 2010 code)`, keywords: code })),
    ],
    [occupations, earlierPicked],
  );

  const soc = params.get("soc") ?? "";
  const state = params.get("state") ?? "";
  const fy = params.get("fy") ?? "";
  const status = params.get("status") ?? "certified";
  // A year from DOL's older files: precomputed by occupation and state only.
  const olderYear = historyYears.includes(fy);
  // Read only where the route accepts them, so a stray parameter on the LCA
  // page can't send a request its route would refuse.
  const city = placeFilters && state && !olderYear ? params.get("city") ?? "" : "";
  const sector = placeFilters && (state || soc) && !olderYear ? params.get("sector") ?? "" : "";
  const isDefault = !soc && !state && !fy && status === "certified" && !city && !sector;

  const [data, setData] = useState<ExplorerPayload>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      // A narrowing outlives nothing it narrows: a city goes with its state,
      // an industry with the last of state and occupation, and both with a
      // move to a year from DOL's older files.
      if (!next.get("state")) next.delete("city");
      if (!next.get("state") && !next.get("soc")) next.delete("sector");
      if (historyYears.includes(next.get("fy") ?? "")) {
        next.delete("city");
        next.delete("sector");
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, historyYears],
  );

  useEffect(() => {
    // The server already rendered the default view, so refetching it on mount
    // would be a round trip that changes nothing on screen.
    if (isDefault) {
      setData(initial);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    const qs = new URLSearchParams();
    if (soc) qs.set("soc", soc);
    if (state) qs.set("state", state);
    if (fy) qs.set("fy", fy);
    if (city) qs.set("city", city);
    if (sector) qs.set("sector", sector);
    qs.set("status", status);
    setLoading(true);
    fetch(`${apiPath}?${qs.toString()}`, { signal: ctl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((j: ExplorerPayload) => {
        setData(j);
        setError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Say what the reader can do, in the interface's voice. The previous
        // figures stay on screen behind this rather than blanking.
        setError("Those figures couldn't be loaded. Change a filter to try again.");
      })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [soc, state, fy, status, city, sector, isDefault, initial, apiPath]);

  const report = useMemo(() => reportability(data.stats.n), [data.stats.n]);
  const subject = useMemo(() => {
    // A code the list doesn't hold (a 2010 code, an old link) is named by itself, never as every occupation.
    const occ = soc ? occupations.find((o) => o.value === soc)?.label ?? earlierPicked[soc] ?? soc : null;
    const parts = [occ ?? "All occupations", state || "every state", fy ? `FY${fy}` : pooledLabel || "all years"];
    if (city) parts.splice(2, 0, city);
    const sectorLabel = sectorGroup(sector)?.label;
    if (sectorLabel) parts.push(sectorLabel);
    return parts.join(", ");
  }, [occupations, earlierPicked, soc, state, fy, city, sector, pooledLabel]);

  // The job's 2010 codes, in a year of the older files (the route sends them only there).
  const earlierCodes = olderYear && soc ? (data.earlierCodes ?? []) : [];
  const pickEarlier = (c: EarlierSocCode) => {
    setEarlierPicked((was) => ({ ...was, [c.code]: c.title }));
    setParam("soc", c.code);
  };

  const maxBin = Math.max(1, ...data.bins.map((b) => b.count));

  return (
    <div className="object">
      {/* Filters. grid-cols-1 unprefixed and min-w-0 on the items are both
          required: without a mobile column track the items land in an implicit
          content-sized column, which on WebKit sizes a form control from its
          own UA stylesheet and runs it off the card. */}
      <div className="border-b-2 border-border p-6 sm:p-8">
        <h2 className="font-heading text-2xl font-bold leading-tight">
          {heading}
        </h2>{" "}
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Every offered wage in DOL&apos;s disclosure files, filtered. The
          figures describe only the {nounPlural} you select.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor={ids.soc} className="text-sm font-bold">
              Occupation
            </Label>{" "}
            {/* Hundreds of occupations: a box you can type a title or a code into. It shows the chosen
                title whole, so the line SelectedInFull drew under the select isn't needed here. */}
            <FilterCombobox
              id={ids.soc}
              noun="occupations"
              emptyLabel="All occupations"
              options={occupationOptions}
              value={soc}
              onChange={(v) => setParam("soc", v)}
              className="mt-2 bg-background"
            />
          </div>

          <div>
            <Label htmlFor={ids.state} className="text-sm font-bold">
              Worksite state
            </Label>
            <select
              id={ids.state}
              value={state}
              onChange={(e) => setParam("state", e.target.value)}
              className="mt-2 block w-full min-w-0 min-h-[44px] border-2 border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              <option value="">Every state</option>
              {states.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({formatInt(s.n)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor={ids.fy} className="text-sm font-bold">
              Fiscal year
            </Label>
            <select
              id={ids.fy}
              value={fy}
              onChange={(e) => setParam("fy", e.target.value)}
              className="mt-2 block w-full min-w-0 min-h-[44px] border-2 border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              <option value="">{pooledLabel || "All years"}</option>
              {fiscalYears.map((y) => (
                <option key={y} value={y}>
                  FY{y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor={ids.status} className="text-sm font-bold">
              Outcome
            </Label>
            <select
              id={ids.status}
              value={status}
              onChange={(e) => setParam("status", e.target.value)}
              className="mt-2 block w-full min-w-0 min-h-[44px] border-2 border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {placeFilters ? (
            <>
              <div>
                <Label htmlFor={ids.city} className="text-sm font-bold">
                  Worksite city
                </Label>
                <CityField
                  key={`${state}|${city}|${fy}`}
                  id={ids.city}
                  value={city}
                  disabled={!state || olderYear}
                  reason={olderYear ? `Not for FY${fy}` : undefined}
                  onCommit={(v) => setParam("city", v)}
                />
              </div>

              <div>
                <Label htmlFor={ids.sector} className="text-sm font-bold">
                  Industry
                </Label>
                <select
                  id={ids.sector}
                  value={sector}
                  disabled={(!state && !soc) || olderYear}
                  onChange={(e) => setParam("sector", e.target.value)}
                  className={FIELD}
                >
                  <option value="">
                    {olderYear
                      ? `Not for FY${fy} `
                      : !state && !soc
                        ? "Choose a state or an occupation first "
                        : "Every industry "}
                  </option>
                  {SECTOR_GROUPS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {`${x.label} `}
                    </option>
                  ))}
                </select>{" "}
                <SelectedInFull label={sectorGroup(sector)?.label} />
              </div>
            </>
          ) : null}
        </div>
        {placeFilters ? (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            A city narrows a state, and an industry a state or an occupation. Cities are as DOL prints them.
            For one across the whole country, see the{" "}
            <Link href="/perm-cities" className="link">
              city
            </Link>{" "}
            and{" "}
            <Link href="/perm-industries" className="link">
              industry
            </Link>{" "}
            pages.
            {olderYear ? (
              <>
                {" "}
                FY{fy} comes from DOL&apos;s older files. Those years are worked out ahead by occupation and
                state, so a city or an industry can&apos;t narrow them.
              </>
            ) : null}
          </p>
        ) : null}

        <p className="mt-4 font-mono text-sm text-muted-foreground">{subject}</p>{" "}
        {/* A DIMMED PANEL IS NOT A LOADING STATE. Changing a filter refetches,
            and the only signal was `opacity-60` on the figures below - which
            reads as a styling choice, not as work in progress, and says nothing
            at all to a screen reader beyond the `aria-busy` flag. The numbers
            deliberately stay on screen behind this rather than blanking; what
            was missing was a sentence saying they are the OLD ones. */}
        {loading ? (
          <p
            role="status"
            className="mt-3 flex items-center gap-2 text-base font-bold"
          >
            <CircleNotchIcon
              className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
              weight="bold"
              aria-hidden="true"
            />{" "}
            <span>Loading these figures… the numbers below are the previous selection.</span>
          </p>
        ) : null}
      </div>

      {/* Warnings ABOVE the figures, always. A number computed from a suspect
          population must not read as more authoritative than the doubt. */}
      {error ? (
        <p className="flex items-start gap-2 border-b-2 border-border bg-data-warn/8 px-6 py-4 text-base text-soft sm:px-8">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-data-warn-ink" weight="fill" aria-hidden="true" />{" "}
          <span>{error}</span>
        </p>
      ) : null}
      {report.note ? (
        <p className="flex items-start gap-2 border-b-2 border-border bg-data-warn/8 px-6 py-4 text-base text-soft sm:px-8">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-data-warn-ink" weight="fill" aria-hidden="true" />{" "}
          <span>{keepWhole(report.note)}</span>
        </p>
      ) : null}
      {/* BLS renumbered jobs in 2018, and DOL's older files carry the 2010
          codes. Each one that holds the year's cases is offered on its own,
          never added in: 15-1132 also became 15-1253. */}
      {earlierCodes.length > 0 ? (
        <div className="border-b-2 border-border bg-data-info/10 px-6 py-4 text-base sm:px-8">
          <p>
            {data.stats.n === 0
              ? `DOL's FY${fy} file lists this job under BLS's older 2010 codes. Pick one to see its wages.`
              : `DOL's FY${fy} file also lists some of this job's cases under BLS's older 2010 codes, and the figures here leave them out. Pick one to see its wages.`}
          </p>{" "}
          <ul className="mt-3 flex flex-wrap gap-2">
            {earlierCodes.map((c) => (
              <Fragment key={c.code}>
                {" "}
                <li className="min-w-0 max-w-full">
                  <button
                    type="button"
                    onClick={() => pickEarlier(c)}
                    className={cn(choiceVariants({ on: false }), "h-auto max-w-full flex-wrap justify-start py-2 text-left")}
                  >
                    <span className="font-bold tabular-nums">{c.code}</span>{" "}
                    <span>{keepWhole(c.title)}</span>{" "}
                    <span className="text-muted-foreground">
                      ({formatInt(c.n)} {c.n === 1 ? noun : nounPlural})
                    </span>
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>{" "}
          {data.earlierNote ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {data.earlierNote} So each 2010 code&apos;s figures take in every job it became.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={cn("p-6 sm:p-8", loading && "opacity-60")} aria-busy={loading}>
        <p className="text-sm font-semibold text-muted-foreground">
          {formatInt(data.stats.n)} {data.stats.n === 1 ? noun : nounPlural} with a usable wage
        </p>

        {report.showMiddle ? (
          <>
            <div className="mt-4 flex flex-wrap gap-3">
              {[
                { label: "5th percentile", v: data.stats.p5, gated: true },
                { label: "Median", v: data.stats.p50, gated: false },
                { label: "Average", v: data.stats.avg, gated: false },
                { label: "95th percentile", v: data.stats.p95, gated: true },
              ]
                .filter((c) => (c.gated ? report.showTails : true))
                .map((c) => (
                  <div
                    key={c.label}
                    className="min-w-0 flex-1 basis-52 bg-sage p-4 border-2 border-border"
                  >
                    <p className="text-sm font-semibold text-muted-foreground">
                      {keepWhole(c.label)}
                    </p>{" "}
                    <p className="mt-1 font-heading text-2xl font-bold leading-none tabular-nums">
                      {usd(c.v)}
                    </p>
                  </div>
                ))}
            </div>
            <p className="mt-3 text-base text-muted-foreground">
              Half of these {nounPlural} fall between{" "}
              <b className="font-bold text-foreground tabular-nums">{usd(data.stats.p25)}</b> and{" "}
              <b className="font-bold text-foreground tabular-nums">{usd(data.stats.p75)}</b>, the
              25th and 75th percentiles.
            </p>

            {data.bins.length > 0 ? (
              <div className="mt-8">
                <h3 className="font-heading text-xl font-bold">Where the wages land</h3>{" "}
                <p className="mt-2 text-base text-muted-foreground">
                  Each bar is a {usd(data.binWidth)} band.
                  {data.below > 0 || data.above > 0 ? (
                    <>
                      {" "}
                      {formatInt(data.below + data.above)} {nounPlural} sit outside this range and are counted
                      but not drawn, so the axis isn&apos;t stretched by a handful of outliers.
                    </>
                  ) : null}
                </p>
                <ChartTips label={`Where the wages land, ${nounPlural} by wage band`} className="mt-4">
                <ol className="space-y-1">
                  {data.bins.map((b) => (
                    // Fragment with an explicit space: mapped siblings arrive
                    // with nothing between them and would read as one run.
                    <Fragment key={b.from}>
                      {" "}
                      <li
                        className="grid grid-cols-[6rem_1fr_4rem] items-center gap-2 [&>*]:min-w-0 sm:grid-cols-[8rem_1fr_5rem] sm:gap-3"
                        aria-label={`${usd(b.from)} to ${usd(b.from + data.binWidth)}: ${formatInt(b.count)} ${nounPlural}`}
                        data-tip={`${usd(b.from)} to ${usd(b.from + data.binWidth)}\n${formatInt(b.count)} ${nounPlural}`}
                      >
                        <span className="text-sm tabular-nums text-muted-foreground">{usd(b.from)}</span>{" "}
                        <span className="block h-5 w-full border-input bg-sage border">
                          <span
                            className="block h-full bg-primary"
                            style={{ width: `${Math.max((b.count / maxBin) * 100, 1)}%` }}
                          />
                        </span>{" "}
                        <span className="text-right text-sm tabular-nums text-muted-foreground">
                          {formatInt(b.count)}
                        </span>
                      </li>
                    </Fragment>
                  ))}
                </ol>
                </ChartTips>
              </div>
            ) : null}

            {data.byState.length > 0 ? (
              <StateWageSpread rows={data.byState} nounPlural={nounPlural} minCases={MIN_FOR_MEDIAN} />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
