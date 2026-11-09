import Link from "next/link";

import { RfiJourney } from "@/components/rfi/StepByStep";
import { getObservedDays } from "@/lib/db/pulse";
import { getRfiClock } from "@/lib/db/rfiClock";
import { getStageStats } from "@/lib/db/stageStats";
import { softFail } from "@/lib/softRead";

/**
 * The RFI page's step-by-step figures inside an article, read when the page renders.
 *
 * The RFI timing guide describes three measurements; this shows today's values of all three
 * with the counts behind them, from the same three reads `/perm-rfi-audit` makes, so the guide
 * and the page can never disagree. A failed read says where the figures live instead.
 */
export async function RfiJourneyNow() {
  const [stats, clock, observed] = await Promise.all([
    getStageStats().catch(softFail("RfiJourneyNow.getStageStats", null)),
    getRfiClock().catch(softFail("RfiJourneyNow.getRfiClock", null)),
    getObservedDays(150).catch(softFail("RfiJourneyNow.getObservedDays", [])),
  ]);
  if (!stats && !clock) {
    return (
      <p>
        The live figures are unavailable for the moment. The{" "}
        <Link href="/perm-rfi-audit#step-by-step" className="link">
          RFI and audit page
        </Link>{" "}
        carries them.
      </p>
    );
  }
  return (
    <div className="not-prose my-6">
      <RfiJourney stats={stats} clock={clock} observed={observed} narrow />
    </div>
  );
}
