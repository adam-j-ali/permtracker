"use client";

import { useCallback, useMemo } from "react";

import { FilterableStatTable, type CsvSpec, type Facet, type StatColumn } from "@/components/tools/FilterableStatTable";
import { IntentLink } from "@/components/ui/intent-link";
import { tableDay } from "@/components/rfi/StageCaseBrowser";
import { SITE_URL } from "@/lib/constants/site";
import { entityHref } from "@/lib/entityPayload";
import { formatInt } from "@/lib/format";
import { MOVE_FILL, moveLabel, moveTone } from "@/lib/stageMoves";
import type { StageExit } from "@/lib/stageWait";
import { cn } from "@/lib/utils";

/**
 * Every case that left a review stage since our record began, newest first: where it went, the day, and how long
 * it had waited there. The static page seeds the newest rows; the whole list arrives from
 * `/api/stage-cases?kind=answered` the first time someone searches, sorts, filters or pages past the seed, the same
 * way the waiting list does. Search covers the case number, the employer and the job title; the facet is where the
 * case went, because "how many were granted" is what a reader at this step asks.
 */

export interface StageExitBrowserProps {
  slug: string;
  status: string;
  seed: StageExit[];
  totalCount: number;
  asOf: string | null;
}

function startText(r: StageExit): string {
  if (!r.startOn) return "Not on record";
  return r.startSource === "denied" ? `Denied ${tableDay(r.startOn)}` : tableDay(r.startOn);
}

const COLUMNS: StatColumn<StageExit>[] = [
  {
    key: "case",
    label: "Case number",
    sortValue: (r) => r.caseNumber,
    render: (r) => (
      <IntentLink href={`/perm-case-status?case=${encodeURIComponent(r.caseNumber)}`} className="link whitespace-nowrap font-mono text-sm">
        {r.caseNumber}
      </IntentLink>
    ),
  },
  {
    key: "employer",
    label: "Employer",
    sortValue: (r) => r.employer,
    render: (r) =>
      r.employer && r.employerSlug ? (
        <IntentLink href={entityHref("employer", r.employerSlug)} className="link">
          {r.employer}
        </IntentLink>
      ) : (
        <span>{r.employer ?? ""}</span>
      ),
  },
  {
    key: "to",
    label: "Moved to",
    sortValue: (r) => moveLabel(r.to),
    render: (r) => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden="true" className={cn("size-3 shrink-0 border border-foreground/40", MOVE_FILL[moveTone(r.to)])} />
        {moveLabel(r.to)}
      </span>
    ),
  },
  {
    key: "left",
    label: "On",
    sortValue: (r) => r.leftOn,
    render: (r) => <span className="whitespace-nowrap tabular-nums">{tableDay(r.leftOn)}</span>,
  },
  {
    key: "since",
    label: "Waited from",
    sortValue: (r) => r.startOn,
    render: (r) => (
      <span className={r.startOn ? "whitespace-nowrap tabular-nums" : "whitespace-nowrap text-muted-foreground"}>{startText(r)}</span>
    ),
    secondary: true,
  },
  {
    key: "days",
    label: "Days here",
    numeric: true,
    sortValue: (r) => r.days,
    render: (r) => <span className="tabular-nums">{r.days === null ? "" : formatInt(r.days)}</span>,
  },
];

const FACETS: Facet<StageExit>[] = [{ key: "to", label: "Moved to", value: (r) => moveLabel(r.to) }];

interface ExitFeed {
  rows: StageExit[];
}

export function StageExitBrowser({ slug, status, seed, totalCount, asOf }: StageExitBrowserProps) {
  const loadAll = useCallback(async () => {
    const res = await fetch(`/api/stage-cases?stage=${encodeURIComponent(slug)}&kind=answered`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`stage answered feed ${res.status}`);
    const body = (await res.json()) as ExitFeed;
    return body.rows;
  }, [slug]);

  const csv: CsvSpec<StageExit> = useMemo(
    () => ({
      filename: `perm-${slug}-answered${asOf ? `-${asOf}` : ""}.csv`,
      header: ["case_number", "left_on", "moved_to", "waiting_since", "waiting_since_from", "days_at_stage", "filing_date", "employer", "job_title", "status_now", "permtracker_url"],
      row: (r) => [
        r.caseNumber,
        r.leftOn,
        r.to,
        r.startOn,
        r.startSource === "seen" ? "our daily check" : r.startSource === "denied" ? "DOL denial date" : "",
        r.days,
        r.filingDate,
        r.employer,
        r.jobTitle,
        r.nowStatus,
        `${SITE_URL}/perm-case-status?case=${encodeURIComponent(r.caseNumber)}`,
      ],
    }),
    [slug, asOf],
  );

  return (
    <FilterableStatTable<StageExit>
      rows={seed}
      totalCount={totalCount}
      loadAll={loadAll}
      columns={COLUMNS}
      searchText={(r) => `${r.caseNumber} ${r.employer ?? ""} ${r.jobTitle ?? ""}`}
      suggestText={(r) => r.employer ?? r.caseNumber}
      searchPlaceholder="Search by case number, employer or job title"
      initialSort="left"
      caption={`Every PERM case that left ${status.toLowerCase()} since August 30, 2026, from DOL's live record${asOf ? ` as of ${asOf}` : ""}`}
      noun="cases"
      facets={FACETS}
      csv={csv}
      pageSize={25}
    />
  );
}
