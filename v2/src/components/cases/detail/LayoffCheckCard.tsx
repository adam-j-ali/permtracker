"use client";

import { useEffect, useId, useState } from "react";
import { UsersThreeIcon } from "@phosphor-icons/react";

import type { LookupEmployer } from "@/lib/api/employerLookup";
import type { WarnNotice } from "@/lib/db/warn";
import { WarnNoticeItems } from "@/components/entities/WarnNotice";
import { NewTabLink } from "@/components/ui/new-tab-link";
import { layoffWindow } from "@/lib/layoffCheck";
import { easternDay } from "@/lib/time";
import { warnDate } from "@/lib/warnStates";

type Read = { state: "loading" } | { state: "failed" } | { state: "read"; notices: WarnNotice[] };

/**
 * The layoff check: the employer's WARN notices in the six months before the ETA 9089's filing day (or before today,
 * until it's filed), the look-back 20 CFR 656.17(k)(1) names. It says what the state notices show and leaves the
 * judgement to the employer: a notice is a planned layoff at a site, and whether any of it was in this occupation or a
 * related one, in the area of intended employment, is theirs to check. Information, never a finding.
 */
export function LayoffCheckCard({ employer, eta9089FilingDate }: { employer: LookupEmployer | null; eta9089FilingDate?: string }) {
  const id = useId();
  const w = layoffWindow(eta9089FilingDate, easternDay());
  const [read, setRead] = useState<Read>({ state: "loading" });

  useEffect(() => {
    if (!employer) return;
    let live = true;
    setRead({ state: "loading" });
    const q = new URLSearchParams({ slug: employer.slug, from: w.from, to: w.to });
    fetch(`/api/warn-notices?${q.toString()}`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { notices?: WarnNotice[] }) => {
        if (live) setRead({ state: "read", notices: Array.isArray(j.notices) ? j.notices : [] });
      })
      .catch(() => {
        if (live) setRead({ state: "failed" });
      });
    return () => {
      live = false;
    };
  }, [employer, w.from, w.to]);

  // Without the employer's page there's nothing to match notices to: the employer line above says so by its absence.
  if (!employer) return null;

  const span = `${warnDate(w.from, "long")} to ${warnDate(w.to, "long")}`;
  return (
    <section className="detail-card" aria-labelledby={`${id}-h`}>
      <div className="detail-card-head ch-eta">
        <h2 id={`${id}-h`} className="flex items-center gap-1.5">
          <UsersThreeIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Layoff notices
        </h2>
      </div>
      <div className="detail-card-body space-y-3">
        <p className="text-base">
          {read.state === "loading"
            ? `Reading the WARN notices for ${employer.name} from ${span}.`
            : read.state === "failed"
              ? "The layoff notices couldn't be read just now. Reload the page to try again."
              : read.notices.length === 0
                ? `No WARN notice from ${employer.name} is dated ${span}, the six months before ${w.filed ? "this case's filing" : "a filing today"}.`
                : `${read.notices.length} WARN ${read.notices.length === 1 ? "notice" : "notices"} from ${employer.name} ${read.notices.length === 1 ? "is" : "are"} dated ${span}, the six months before ${w.filed ? "this case's filing" : "a filing today"}.`}
        </p>{" "}
        {read.state === "read" && read.notices.length > 0 ? (
          <ul className="divide-y divide-border/40 border-t border-border/40">
            <WarnNoticeItems rows={read.notices} />
          </ul>
        ) : null}{" "}
        <p className="text-sm text-muted-foreground">
          The ETA 9089 asks about a layoff in the area of intended employment, in this occupation or a related one,
          within six months of filing (20 CFR 656.17(k)). A WARN notice is a state&apos;s record of a planned layoff at a
          site, and a smaller layoff needs none, so the employer checks its own records too. This is general information,
          and PERM Tracker isn&apos;t a law firm.{" "}
          <NewTabLink href="/guides/employer-layoffs-and-your-perm">What a layoff means for a PERM</NewTabLink>
        </p>
      </div>
    </section>
  );
}
