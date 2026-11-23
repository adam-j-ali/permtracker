"use client";

import { IntentLink } from "@/components/ui/intent-link";
import { PendingLink } from "@/components/ui/pending-link";
import { useCallback, useMemo } from "react";

import { FilterableStatTable, type CsvSpec, type Facet, type StatColumn } from "@/components/tools/FilterableStatTable";
import type { StageCase } from "@/lib/db/rfi";
import { formatInt } from "@/lib/format";
import { SITE_URL } from "@/lib/constants/site";
import { entityHref } from "@/lib/entityPayload";
import { daysBetween } from "@/lib/time";
import { easternDay } from "@convex/lib/time";
import { shortDate } from "@convex/lib/months";

/**
 * Every case at a review stage, browsable.
 *
 * The static page seeds this with the oldest rows so the list reads before
 * hydration and crawlers see real cases; the whole cohort arrives from
 * `/api/stage-cases` the first time someone searches, sorts, filters or pages
 * past the seed. Search covers the case number, the employer and the job
 * title; every column sorts; the one facet is the filing year, because
 * "which year's filings are stuck here" is the question the page answers.
 * "Days here" counts from where the case's wait at this stage starts (`src/lib/stageWait.ts`): the day our check
 * saw it arrive, or for an appeal our record didn't see begin, DOL's denial date. A case with neither says so
 * rather than borrowing its filing date, which measures the whole PERM and not this step.
 */

export interface StageBrowserProps {
  slug: string;
  status: string;
  seed: StageCase[];
  totalCount: number;
  /** ISO date of the sweep that confirmed these statuses. */
  asOf: string | null;
}

interface StageFeed {
  rows: StageCase[];
}

/** Days the case has waited at this stage so far, or null with no start on record. */
export function daysHere(r: Pick<StageCase, "startOn">, today: string = easternDay()): number | null {
  if (!r.startOn) return null;
  return Math.max(0, daysBetween(r.startOn, today));
}

/** A day as a table prints it: "Oct 5" this year, "Sep 22, 2025" before it. */
export function tableDay(iso: string, today: string = easternDay()): string {
  const full = shortDate(iso) ?? iso;
  return iso.slice(0, 4) === today.slice(0, 4) ? full.replace(/, \d{4}$/, "") : full;
}

/** Where the wait starts, as the table prints it. */
export function hereSince(r: Pick<StageCase, "startOn" | "startSource">, today: string = easternDay()): string {
  if (!r.startOn) return "Not on record";
  return r.startSource === "denied" ? `Denied ${tableDay(r.startOn, today)}` : tableDay(r.startOn, today);
}

const COLUMNS: StatColumn<StageCase>[] = [
  {
    key: "case",
    label: "Case number",
    sortValue: (r) => r.caseNumber,
    render: (r) => (
      // Whole: a number broken at its hyphen reads as two (it broke in the
      // table at every desktop width).
      <PendingLink href={`/perm-case-status?case=${encodeURIComponent(r.caseNumber)}`} className="link whitespace-nowrap font-mono text-sm">
        {r.caseNumber}
      </PendingLink>
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
    key: "title",
    label: "Job title",
    sortValue: (r) => r.jobTitle,
    render: (r) => <span className="text-soft">{r.jobTitle ?? ""}</span>,
    secondary: true,
  },
  {
    key: "filed",
    label: "Filed",
    sortValue: (r) => r.filingDate,
    render: (r) => <span className="whitespace-nowrap tabular-nums">{r.filingDate ?? ""}</span>,
    secondary: true,
  },
  {
    key: "since",
    label: "Here since",
    sortValue: (r) => r.startOn ?? null,
    render: (r) => (
      <span className={r.startOn ? "whitespace-nowrap tabular-nums" : "whitespace-nowrap text-muted-foreground"}>{hereSince(r)}</span>
    ),
  },
  {
    key: "days",
    label: "Days here",
    numeric: true,
    sortValue: (r) => daysHere(r),
    render: (r) => {
      const d = daysHere(r);
      return <span className="tabular-nums">{d === null ? "" : formatInt(d)}</span>;
    },
  },
];

const FACETS: Facet<StageCase>[] = [
  {
    key: "year",
    label: "Filed in",
    value: (r) => (r.filingDate ? r.filingDate.slice(0, 4) : null),
  },
];

export function StageCaseBrowser({ slug, status, seed, totalCount, asOf }: StageBrowserProps) {
  const loadAll = useCallback(async () => {
    const res = await fetch(`/api/stage-cases?stage=${encodeURIComponent(slug)}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`stage feed ${res.status}`);
    const body = (await res.json()) as StageFeed;
    return body.rows;
  }, [slug]);

  const csv: CsvSpec<StageCase> = useMemo(
    () => ({
      filename: `perm-${slug}${asOf ? `-${asOf}` : ""}.csv`,
      header: ["case_number", "filing_date", "employer", "job_title", "status", "waiting_since", "waiting_since_from", "days_at_stage", "permtracker_url"],
      row: (r) => [
        r.caseNumber,
        r.filingDate,
        r.employer,
        r.jobTitle,
        status,
        r.startOn ?? null,
        r.startSource === "seen" ? "our daily check" : r.startSource === "denied" ? "DOL denial date" : "",
        daysHere(r),
        `${SITE_URL}/perm-case-status?case=${encodeURIComponent(r.caseNumber)}`,
      ],
    }),
    [slug, status, asOf],
  );

  return (
    <FilterableStatTable<StageCase>
      rows={seed}
      totalCount={totalCount}
      loadAll={loadAll}
      columns={COLUMNS}
      searchText={(r) => `${r.caseNumber} ${r.employer ?? ""} ${r.jobTitle ?? ""}`}
      suggestText={(r) => r.employer ?? r.caseNumber}
      searchPlaceholder="Search by case number, employer or job title"
      initialSort="days"
      caption={`Every PERM case at ${status.toLowerCase()}, from DOL's live record${asOf ? ` as of ${asOf}` : ""}`}
      noun="cases"
      facets={FACETS}
      csv={csv}
      // 25 to a page: the stage's month chart and the other stages sit below
      // the table, and fifty rows put them two screens further down.
      pageSize={25}
    />
  );
}
