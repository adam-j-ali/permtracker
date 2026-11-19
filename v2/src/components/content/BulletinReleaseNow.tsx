import { BulletinRelease } from "@/components/bulletin/BulletinRelease";
import { BULLETIN_CAPTURES_MEASURED, BULLETIN_FIRST_CAPTURES } from "@/lib/bulletinCaptures";
import { releaseByDay, releaseSummary } from "@/lib/bulletinRelease";
import { getVisaBulletins } from "@/lib/db/publicData";
import { shiftMonth } from "@convex/lib/months";
import { softFail } from "@/lib/softRead";
import { waitingCheck } from "@/lib/bulletinReadCheck";
import { getBulletinRead } from "@/lib/db/bulletinReadCheck";

/**
 * When the next visa bulletin usually comes out, for an article: the same
 * chart the bulletin page draws, from each past bulletin's first Internet
 * Archive capture (a floor on the day it was out), aimed at the bulletin after
 * the newest one this site holds. Nothing when the archive can't be read: the
 * article's own text already says the State Department announces no date.
 */
export async function BulletinReleaseNow() {
  const summary = releaseSummary(BULLETIN_FIRST_CAPTURES);
  if (!summary) return null;
  const [held, check] = await Promise.all([
    getVisaBulletins().catch(softFail("BulletinReleaseNow.getVisaBulletins", [])),
    // Our daily read of State's page; without it the chart's line about today falls back to past years.
    getBulletinRead().catch(softFail("BulletinReleaseNow.getBulletinRead", null)),
  ]);
  const newest = held.map((b) => b.bulletinMonth).sort().pop();
  if (!newest) return null;
  const next = shiftMonth(newest, 1);
  return (
    <BulletinRelease
      rows={releaseByDay(BULLETIN_FIRST_CAPTURES)}
      summary={summary}
      next={next}
      measured={BULLETIN_CAPTURES_MEASURED}
      checkedAt={waitingCheck(next, check)?.checkedAt}
    />
  );
}
