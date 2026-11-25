import { SalaryExplorer } from "@/components/tools/SalaryExplorer";
import { SearchParamsBoundary } from "@/hooks/useUrlSearchParams";
import { getWageByState, getWageFilterOptions, getWageHistogram, getWageStats } from "@/lib/db/publicData";
import { fiscalYearSpan } from "@/lib/wageLadder";
import { binWidth, clampBins, MIN_FOR_MEDIAN } from "@/lib/wageStats";

/**
 * The PERM wage filters (occupation, state, year, outcome), as /perm-wages shows them and /embed/salary-explorer frames
 * them. They were their own page, /tools/salary-explorer, until Nov 24 2026, when they joined the wages page (one page
 * per question); that address now redirects to /perm-wages#explore.
 *
 * Every figure is computed from the disclosure cases already held, over the subset the reader selects: nothing mirrored,
 * nothing modelled. The default view (certified, every job, state and year) is drawn on the server, so the page answers
 * with no JavaScript and a crawler sees real figures; filtering goes through /api/perm-wages, because the database
 * credential must not reach the browser.
 */
export async function WageExplorer() {
  const filters = { status: "certified" as const };
  const [options, stats] = await Promise.all([getWageFilterOptions(MIN_FOR_MEDIAN), getWageStats(filters)]);
  const width = binWidth(stats.p5, stats.p95);
  const [raw, byState] = await Promise.all([
    stats.n >= MIN_FOR_MEDIAN ? getWageHistogram(filters, width) : Promise.resolve([]),
    stats.n >= MIN_FOR_MEDIAN ? getWageByState(filters, MIN_FOR_MEDIAN) : Promise.resolve([]),
  ]);
  const lo = stats.p5 !== null ? Math.floor(stats.p5 / width) * width : 0;
  const hi = stats.p95 !== null ? Math.floor(stats.p95 / width) * width : 0;
  const { bins, below, above } = clampBins(raw, lo, hi);
  // The no-year choice pools perm_cases (FY2024 on); the picker's older years stand alone, so it names its own years.
  const pooledLabel = fiscalYearSpan(options.fiscalYears.filter((y) => !options.historyYears.includes(y))) ?? undefined;
  return (
    // useSearchParams needs a boundary. Its fallback is the explorer itself with no filters, so the prerendered page
    // holds the whole tool and nothing jumps at hydration.
    <SearchParamsBoundary>
      <SalaryExplorer
        occupations={options.occupations}
        states={options.states}
        fiscalYears={options.fiscalYears}
        historyYears={options.historyYears}
        pooledLabel={pooledLabel}
        initial={{ stats, bins, binWidth: width, below, above, byState }}
        placeFilters
      />
    </SearchParamsBoundary>
  );
}
