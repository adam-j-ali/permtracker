import type { HistoryMakeup as Makeup } from "@/lib/db/employerHistory";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/format";

import { IndustryMix, OccupationMix, PartyMix, PlaceMix, StateMix } from "./FilingMakeup";

/** "FY2012 to FY2023", or "FY2019" for one year. */
export function historyYears(m: Pick<Makeup, "fyFrom" | "fyTo">): string {
  return m.fyFrom === m.fyTo ? `FY${m.fyFrom}` : `FY${m.fyFrom} to FY${m.fyTo}`;
}

const GRID =
  "mt-4 grid grid-cols-1 gap-4 [&>*]:min-w-0 md:grid-cols-2 md:[&>*:last-child:nth-child(odd)]:col-span-2";

/**
 * What an employer's or a law firm's older cases were made of: the same boxes as its current figures, counted over
 * the cases DOL decided in FY2008 to FY2023 (`perm_cases_history`, through `historyMakeup`). The current figures
 * count FY2024 on, so these keep their own total and say their own years in the heading, the line under it and
 * every share. A job, a firm or a client with no page today is named without a link.
 */
export function HistoryMakeup({
  makeup,
  subject,
  className,
}: {
  makeup: Makeup | null;
  subject: "employer" | "firm";
  className?: string;
}) {
  if (!makeup) return null;
  const { total, facets } = makeup;
  const years = historyYears(makeup);
  const period = `in ${years}`;
  return (
    <section className={cn("mt-10", className)}>
      <h3 className="font-heading text-lg font-bold">
        {subject === "employer" ? `What they filed, and where, ${years}` : `The practice, ${years}`}
      </h3>{" "}
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        From its {formatInt(total)} {total === 1 ? "case" : "cases"} DOL decided in {years}.
      </p>{" "}
      {subject === "employer" ? (
        <div className={GRID}>
          {facets.occupation ? <OccupationMix rows={facets.occupation} total={total} period={period} /> : null}{" "}
          {facets.industry ? <IndustryMix rows={facets.industry} /> : null}{" "}
          {facets.state || facets.city ? (
            <PlaceMix states={facets.state ?? []} cities={facets.city ?? []} total={total} period={period} />
          ) : null}{" "}
          {facets.attorney ? (
            <PartyMix
              rows={facets.attorney}
              total={total}
              title="Who filed for them"
              note="The law firm named on the application."
              hrefBase="/perm-attorneys"
              period={period}
            />
          ) : null}
        </div>
      ) : (
        <div className={GRID}>
          {facets.employer ? (
            <PartyMix
              rows={facets.employer}
              total={total}
              title="Who they filed for"
              note="The employers named on the most applications from this firm."
              hrefBase="/perm-employers"
              period={period}
            />
          ) : null}{" "}
          {facets.occupation ? <OccupationMix rows={facets.occupation} total={total} period={period} /> : null}{" "}
          {facets.state ? <StateMix rows={facets.state} total={total} period={period} /> : null}
        </div>
      )}
    </section>
  );
}
