import { BarRows, type BarRow } from "@/components/data/BarRows";
import { PageSection } from "@/components/data/PageSection";
import { ScrollBox } from "@/components/ui/scroll-box";
import { formatInt, formatShare } from "@/lib/format";
import { PREMIUM_LABELS } from "@/lib/reportedI140";
import type { I140Summary, StepFigure } from "@/lib/reportedSummary";
import { StepFigures } from "./StepFigures";

/**
 * The I-140s people reported themselves, beside USCIS's own figures on the I-140 page: each step's days (the shared
 * step cards), then the median days to a decision by category and premium processing as bars, then every row with its
 * counts. Every figure is the hourly build's (scripts/lib_reported_summary.py), over the decisions of the last 6
 * months, or 12 when 6 hold too few, from every source. Unchecked and self-selected, so the section says so first.
 */

const TH = "py-1.5 pr-3 text-left font-bold";
const TD = "whitespace-nowrap py-1.5 pr-3 tabular-nums";
const VISASTATS = "https://trackers.visastats.org";

const rowLabel = (category: string, premium: keyof typeof PREMIUM_LABELS) => `${category}, ${PREMIUM_LABELS[premium].toLowerCase()}`;
const pct = (v: number | null) => (v === null ? "Too few" : formatShare(v));

export function ReportedI140({ figures, steps }: { figures: readonly I140Summary[]; steps: readonly StepFigure[] }) {
  if (figures.length === 0 && steps.length === 0) return null;
  const reported = figures.reduce((n, f) => n + f.reported, 0);
  const decided = figures.reduce((n, f) => n + f.decided, 0);
  const wide = figures.some((f) => f.decided > 0 && f.windowDays > 200);
  const bars: BarRow[] = figures
    .filter((f) => f.medianDays !== null)
    .map((f) => ({
      key: `${f.category}-${f.premium}`,
      label: rowLabel(f.category, f.premium),
      sub: `${formatInt(f.decided)} decided, ${pct(f.approvedShare)} approved, ${pct(f.rfeShare)} got an RFE or a NOID`,
      value: f.medianDays,
      text: `${formatInt(f.medianDays!)} days`,
      tone: f.premium === "with filing" ? "primary" : "ink",
    }));

  return (
    <PageSection
      id="reported"
      title="What people reported about their own I-140s"
      lede={`${formatInt(reported)} I-140s people reported themselves, ${formatInt(decided)} of them decided in the last ${wide ? "6 to 12" : "6"} months. Older decisions are left out of every figure, so past years don't outvote this one.`}
    >
      {steps.length ? <StepFigures steps={steps} className="mb-6" /> : null}{" "}
      <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
        Nothing here is checked, and people with a fast approval or a denial are likelier to report one. A figure needs 5
        cases behind it. They come from{" "}
        <a href={VISASTATS} target="_blank" rel="noopener noreferrer" className="link">
          VisaStats&apos; community tracker
        </a>
        , Telegram groups, community sheets, Reddit and the timelines shared here, each case counted once. Premium added
        later is counted from the filing day too, so its bar includes the wait before premium was asked for.
      </p>{" "}
      {bars.length > 0 ? (
        <div className="object mt-4 p-4 sm:p-5">
          <BarRows rows={bars} label="I-140s people reported: median days from filing to a decision, by category and premium processing" />
        </div>
      ) : null}{" "}
      <ScrollBox label="Every category and kind of premium processing people reported" className="mt-6">
        <table className="w-full min-w-[640px] border-collapse text-left text-base">
          <caption className="sr-only">
            I-140s people reported, by category and premium processing: how many, how many decided, the share approved,
            the median days to a decision and the share that got an RFE or a notice of intent to deny
          </caption>
          <thead>
            <tr className="border-b-2 border-border text-sm text-muted-foreground">
              <th scope="col" className={TH}>Category and premium{" "}</th>
              <th scope="col" className={TH}>Reported{" "}</th>
              <th scope="col" className={TH}>Decided lately{" "}</th>
              <th scope="col" className={TH}>Approved{" "}</th>
              <th scope="col" className={TH}>Median days{" "}</th>
              <th scope="col" className={TH}>Got an RFE or a NOID{" "}</th>
            </tr>
          </thead>
          <tbody>
            {figures.map((f) => (
              <tr key={`${f.category}-${f.premium}`} className="border-b border-border">
                <th scope="row" className={`${TD} text-left font-semibold`}>{rowLabel(f.category, f.premium)}{" "}</th>
                <td className={TD}>{formatInt(f.reported)}{" "}</td>
                <td className={TD}>{formatInt(f.decided)}{" "}</td>
                <td className={TD}>{pct(f.approvedShare)}{" "}</td>
                <td className={TD}>{f.medianDays === null ? "Too few" : formatInt(f.medianDays)}{" "}</td>
                <td className={TD}>{pct(f.rfeShare)}{" "}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
    </PageSection>
  );
}
