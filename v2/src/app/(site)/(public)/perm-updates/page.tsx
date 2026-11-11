import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DataProvenance } from "@/components/data/DataProvenance";
import { DailyUpdateView } from "@/components/updates/DailyUpdateView";
import { loadDailyUpdate } from "@/components/updates/loadDailyUpdate";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";

/**
 * What DOL did with PERM cases on its last working day: the counts, the filing dates it certified, a line to
 * share, and every case. One page per day sits under it (/perm-updates/2026-11-10).
 *
 * The answer to "any approvals today?", which people waiting on a case ask each other every evening. The long
 * record (DOL's pace by week, every day since 2015, both sources side by side) is /perm-decision-activity.
 *
 * Each check of DOL's record expires this page when it finishes (/api/revalidate-sweep); the hour is the backstop.
 */
export const revalidate = 3600;

const TITLE = "PERM Updates Today: What DOL Decided";
const DESCRIPTION =
  "The PERM cases the Department of Labor certified, denied and saw withdrawn on its last working day, the filing dates it reached, and every case it moved.";

export const metadata: Metadata = withSocialCard(
  {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/perm-updates" },
    openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: "/perm-updates" },
  },
  "perm-updates",
);

export default async function PermUpdatesPage() {
  const load = await loadDailyUpdate(null);
  if (!load || load.kind !== "day") notFound();
  return (
    <>
      <DailyUpdateView {...load.props} />
      <div className="mx-auto max-w-[1200px] px-4 pb-12 sm:px-6">
        <DataProvenance datasets={["perm-case-status", "pwd-status"]} />
      </div>
    </>
  );
}
