import Link from "next/link";

import { StageMoves } from "@/components/rfi/StepByStep";
import { getStageStats } from "@/lib/db/stageStats";
import { softFail } from "@/lib/softRead";

/**
 * Where a denied case went after each appeal step, inside the appeal guide, read when the page renders: the
 * RFI, audit and appeal page's own count, narrowed to the appeal's steps, so the guide and the page can never
 * disagree and no figure is typed into the article. A failed read says where the figures live instead.
 */
const APPEAL_STEPS = ["DENIED", "RECONSIDERATION APPEALS", "NORD ISSUED", "REQUEST FOR REVIEW", "BALCA APPEALS"] as const;

export async function AppealStepsNow() {
  const stats = await getStageStats().catch(softFail("AppealStepsNow.getStageStats", null));
  const block = stats ? StageMoves({ stats, since: stats.since ?? null, only: APPEAL_STEPS }) : null;
  if (!block) {
    return (
      <p>
        The live figures are unavailable for the moment. The{" "}
        <Link href="/perm-rfi-audit#step-by-step" className="link">
          RFI, audit and appeal page
        </Link>{" "}
        carries them.
      </p>
    );
  }
  return <div className="not-prose my-6">{block}</div>;
}
