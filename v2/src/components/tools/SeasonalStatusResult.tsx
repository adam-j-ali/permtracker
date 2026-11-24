import type { ReactNode } from "react";
import Link from "next/link";
import { SocCodeLink } from "@/components/soc/SocCodeLink";
import { DolUnanswered } from "@/components/tools/DolUnanswered";
import { WatchThisNumber } from "@/components/tools/WatchThisNumber";
import { AnswerPanel } from "@/components/tools/Insight";
import { PageSection } from "@/components/data/PageSection";
import { RecordList, type RecordRow } from "@/components/data/RecordList";
import {
  lookupSeasonalCaseOutcome,
  lookupSeasonalPosting,
  lookupSeasonalRecord,
  type SeasonalPosting,
  type SeasonalRecord,
} from "@/lib/db/seasonalCasesTypes";
import {
  decidedInFileOnly,
  h2aDecideBy,
  publishedGranted,
  publishedStatusLabel,
  wagePhrase,
  worksitePhrase,
} from "@/lib/seasonalDetails";
import { isLookupGap } from "@/lib/dolMiss";
import { SEASONAL_STATUSES, statusAnchor } from "@/lib/statusDictionary";
import { seasonalForm } from "@/lib/seasonalForms";
import { awaitingFirstDecision, easternDay, timingView } from "@/lib/seasonalTiming";
import { getSeasonalCheck, getSeasonalTiming } from "@/lib/db/seasonalTiming";
import { getH2bGroupTiming, h2bGroupOf } from "@/lib/db/h2bGroups";
import { pickGroup } from "@/lib/h2bGroups";
import { SeasonalTimingPanel } from "@/components/tools/SeasonalTimingPanel";
import { formatDay } from "@/lib/dolFormat";
import { prettyStatus } from "@/components/queue/stages";
import { softFail } from "@/lib/softRead";
import { caseHref } from "@/lib/caseLinks";
import { entityHref } from "@/lib/entityPayload";
import { naicsTitle } from "@/lib/naicsTitles";
import { getPwdDetail, type PwdDetail } from "@/lib/db/pwdDetail";
import { linkTargets, linkableSlugs } from "@/lib/db/entityLinks";
import { KeepWhole } from "@/components/ui/keep-whole";

/**
 * An H-2A application (`H-300-`), an H-2B application (`H-400-`) or an H-2B
 * prevailing wage request (`P-400-`) by number: DOL's own status, the
 * employer and title it names, and what the status means.
 *
 * Routed here by prefix, so these numbers never reach the PERM or PWD lookup,
 * where they would come back "no record" or, worse, an H-2B wage request
 * would be filed under the ETA-9141 queue PERM waits in.
 */

/** The form, named from the one list every seasonal surface reads (src/lib/seasonalForms.ts). */
function formOf(caseNumber: string): string {
  const f = seasonalForm(caseNumber);
  return f ? `${f.label} · ${f.form}` : "H-2A, H-2B or CW-1 filing";
}




/**
 * What a status means: the status dictionary's own entry, so the lookup and
 * /perm-case-statuses cannot say two things about one word. Each entry there
 * carries a 20 CFR 655 cite or says DOL publishes no definition.
 */
function entryFor(status: string) {
  const u = status.trim().toUpperCase();
  return SEASONAL_STATUSES.find((e) => e.status.toUpperCase() === u) ?? null;
}

/** The rows that have a value, as RecordList rows. */
function rowsOf(pairs: readonly (readonly [string, string | null | undefined])[]): RecordRow[] {
  return pairs.filter((p): p is readonly [string, string] => !!p[1]).map(([label, value]) => ({ label, value }));
}

function workersPhrase(requested: number | null, certified: number | null): string | null {
  if (requested === null && certified === null) return null;
  const req = requested === null ? null : `${requested.toLocaleString("en-US")} requested`;
  const cert = certified === null ? null : `${certified.toLocaleString("en-US")} certified`;
  return [req, cert].filter(Boolean).join(", ");
}

function periodPhrase(begin: string | null, end: string | null): string | null {
  const a = formatDay(begin);
  const b = formatDay(end);
  if (a && b) return `${a} to ${b}`;
  return a ? `From ${a}` : b ? `Until ${b}` : null;
}

/**
 * What DOL published about the case (its quarterly file) and the job as DOL
 * accepted it (SeasonalJobs), the two places the wage, the workers, the work
 * period and the worksite live; the live status carries none of them.
 */
/** A case number as a link to its own page, in the mono face. */
function caseLink(n: string | null | undefined): ReactNode {
  return n ? (
    <Link href={caseHref(n)} className="link inline-flex min-h-11 items-center font-mono">
      {n}
    </Link>
  ) : null;
}

/** What a job requires, in the words the wage request page uses: education, then the months of experience. */
function needPhrase(education: string | null, months: number | null): string | null {
  return [education && education.toLowerCase() !== "none" ? education : null, months ? `${months} months of experience` : null]
    .filter(Boolean)
    .join(", ") || null;
}

function SeasonalDetails({
  record,
  posting,
  pending,
  caseNumber,
  ruleShownElsewhere = false,
  firmLinked = false,
  detail = null,
}: {
  record: SeasonalRecord | null;
  posting: SeasonalPosting | null;
  pending: boolean;
  caseNumber: string;
  /** The timing panel already states the 30-day rule for this case. */
  ruleShownElsewhere?: boolean;
  /** The law firm has a page to link to. */
  firmLinked?: boolean;
  /** An H-2B or CW-1 wage request's level and requirements, from DOL's prevailing wage file. */
  detail?: PwdDetail | null;
}) {
  if (!record && !posting) return null;
  const firstDay = record?.beginDate ?? posting?.beginDate ?? null;
  const decideBy = pending && !ruleShownElsewhere && /^H-300-/.test(caseNumber) ? h2aDecideBy(firstDay) : null;
  const industry = naicsTitle(record?.naics ?? detail?.naics);
  const required = detail ? needPhrase(detail.education, detail.experienceMonths) : null;
  const alternative = detail ? needPhrase(detail.altEducation, detail.altExperienceMonths) : null;
  const firm = record?.attorneyName ?? null;
  const rows: RecordRow[] = [
    ...rowsOf([
      ...(record
        ? ([
            ["Decision", publishedStatusLabel(record.status)],
            ["Decided", formatDay(record.decisionDate)],
          ] as const)
        : []),
      ["Wage offered", wagePhrase(record?.wage ?? posting?.wage ?? null, record?.wageUnit ?? posting?.wageUnit ?? null)],
      ["Wage level DOL set", detail?.level ? `Level ${detail.level}` : null],
      ["What the job requires", required],
      ["Or, as the alternative", alternative],
      ["Workers", workersPhrase(record?.workers ?? posting?.workersForeign ?? null, record?.workersCertified ?? null)],
      ["Work period", periodPhrase(firstDay, record?.endDate ?? posting?.endDate ?? null)],
      [
        "Worksite",
        worksitePhrase(
          record?.worksiteCity ?? detail?.worksiteCity ?? posting?.worksiteCity ?? null,
          record?.worksiteCounty ?? posting?.worksiteCounty ?? null,
          record?.worksiteState ?? posting?.worksiteState ?? null,
        ),
      ],
    ]),
    ...(record?.socTitle || record?.socCode
      ? [
          {
            label: "Occupation",
            value: (
              <>
                {record.socTitle ?? "Not given"}
                {record.socCode ? (
                  <span className="font-mono text-sm font-normal text-muted-foreground">
                    {" "}
                    · <SocCodeLink code={record.socCode} />
                  </span>
                ) : null}
              </>
            ),
          },
        ]
      : []),
    ...(industry ? [{ label: "Industry", value: `${industry.title} (NAICS ${industry.code})` }] : []),
    ...(firm
      ? [
          {
            label: "Law firm or agent",
            raw: true,
            value:
              firmLinked && record?.attorneySlug ? (
                <Link href={entityHref("attorney", record.attorneySlug)} className="link">
                  {firm}
                </Link>
              ) : (
                firm
              ),
          },
        ]
      : []),
    ...rowsOf(!record && posting ? ([["Accepted by DOL", formatDay(posting.acceptedDate)]] as const) : []),
    ...(posting?.jobOrderNumber ? [{ label: "Job order", raw: true, value: caseLink(posting.jobOrderNumber) }] : []),
    ...(posting?.pwdNumber ? [{ label: "Wage determination", raw: true, value: caseLink(posting.pwdNumber) }] : []),
  ];
  return (
    <PageSection
      title={record ? "DOL's published record" : "The job, as DOL accepted it"}
      lede={
        record
          ? `From DOL's quarterly ${record.visaClass ?? "disclosure"} file${record.sourceFile ? ` (${record.sourceFile})` : ""}.`
          : "From DOL's SeasonalJobs feed, which lists applications it has accepted. The decision comes later."
      }
    >
      <RecordList rows={rows} />{" "}
      {decideBy ? (
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-soft">
          <KeepWhole>
            {"By rule DOL decides an H-2A application no later than 30 days before the first day of work, so this " +
              "one by"}
          </KeepWhole>{" "}
          <b className="font-semibold text-foreground">{formatDay(decideBy)}</b>, unless the application was modified (
          <a target="_blank" href="https://www.ecfr.gov/current/title-20/chapter-V/part-655/section-655.160" className="link" rel="noopener">
            20 CFR 655.160
          </a>
          ).
        </p>
      ) : null}
    </PageSection>
  );
}

/**
 * The employer's and the law firm's pages, when they have one: the employer by the page the nightly map gives its
 * spelling, the firm by its own slug. A read that fails links nothing and the names print as text.
 */
async function pagesFor(employerSlugs: (string | null | undefined)[], firmSlug: string | null | undefined) {
  const [employers, firms] = await Promise.all([
    linkTargets("employer", employerSlugs).catch(softFail("SeasonalStatusResult.linkTargets", new Map<string, string>())),
    firmSlug
      ? linkableSlugs("attorney", [firmSlug]).catch(softFail("SeasonalStatusResult.linkableSlugs", new Set<string>()))
      : Promise.resolve(new Set<string>()),
  ]);
  return {
    employerPage: (slug: string | null | undefined) => (slug ? (employers.get(slug) ?? null) : null),
    firmLinked: !!firmSlug && firms.has(firmSlug),
  };
}

/** The employer's name, linked to its page when it has one. */
function employerValue(name: string | null, page: string | null): ReactNode {
  if (!name) return "Not given";
  return page ? (
    <Link href={entityHref("employer", page)} className="link">
      {name}
    </Link>
  ) : (
    name
  );
}

export async function SeasonalLookup({ caseNumber }: { caseNumber: string }) {
  const isH2b = caseNumber.trim().toUpperCase().startsWith("H-400-");
  // An H-2B or CW-1 wage request is decided in DOL's prevailing wage file, which prints the level and the job's
  // requirements the shared record leaves out.
  const isWageRequest = /^P-(?:400|500)-/.test(caseNumber.trim().toUpperCase());
  const [outcome, record, posting, timing, checks, groupOf, groupTiming, detail] = await Promise.all([
    lookupSeasonalCaseOutcome(caseNumber).catch(softFail("SeasonalStatusResult.lookupSeasonalCaseOutcome", { row: null, dolMiss: "records" as const })),
    lookupSeasonalRecord(caseNumber).catch(softFail("SeasonalStatusResult.lookupSeasonalRecord", null)),
    lookupSeasonalPosting(caseNumber).catch(softFail("SeasonalStatusResult.lookupSeasonalPosting", null)),
    getSeasonalTiming().catch(softFail("SeasonalStatusResult.getSeasonalTiming", null)),
    getSeasonalCheck().catch(softFail("SeasonalStatusResult.getSeasonalCheck", null)),
    // DOL's H-2B assignment group, for an application filed in a season's first days.
    isH2b ? h2bGroupOf(caseNumber).catch(softFail("SeasonalStatusResult.h2bGroupOf", null)) : Promise.resolve(null),
    isH2b ? getH2bGroupTiming().catch(softFail("SeasonalStatusResult.getH2bGroupTiming", null)) : Promise.resolve(null),
    isWageRequest ? getPwdDetail(caseNumber.trim().toUpperCase()) : Promise.resolve(null),
  ]);
  const { row, dolMiss } = outcome;
  const form = formOf(caseNumber);
  const pages = await pagesFor([record?.employerSlug, row?.employerSlug], record?.attorneySlug);

  if (!row && record) {
    // In DOL's published file but not in the live table: the file is the
    // record. The shared lookup returns no live row for exactly this case,
    // so without this branch the page would say "no record".
    const granted = publishedGranted(record.status);
    return (
      <div>
        <AnswerPanel
          verdict="Decided"
          direction={granted ? "good" : "flat"}
          label={
            <>
              {form} <span translate="no">{record.caseNumber}</span>
            </>
          }
          source="From DOL's published file; its live case system didn't return the number"
        >
          DOL decided this application: <b className="font-semibold">{publishedStatusLabel(record.status)}</b>
          {formatDay(record.decisionDate) ? `, ${formatDay(record.decisionDate)}` : ""}.
        </AnswerPanel>
        <SeasonalDetails
          record={record}
          posting={posting}
          pending={false}
          caseNumber={record.caseNumber}
          firmLinked={pages.firmLinked}
          detail={detail}
        />
        <PageSection title="The record">
          <RecordList
            rows={[
              {
                label: "Employer",
                value: employerValue(record.employerName, pages.employerPage(record.employerSlug)),
                raw: !!record.employerName,
              },
              { label: "Job title", value: record.jobTitle ?? "Not given", raw: !!record.jobTitle },
              ...rowsOf([["Received by DOL", formatDay(record.receivedDate)]]),
            ]}
          />
        </PageSection>
      </div>
    );
  }

  if (!row && isLookupGap(dolMiss)) {
    return <DolUnanswered caseNumber={caseNumber} label={form} miss={dolMiss} watch="seasonal" />;
  }

  if (!row) {
    return (
      <AnswerPanel
        verdict="No record"
        direction="flat"
        label={
          <>
            {form} <span translate="no">{caseNumber}</span>
          </>
        }
        actions={
          <div className="mt-6 border-t border-foreground/10 pt-6">
            <WatchThisNumber caseNumber={caseNumber} program="seasonal" variant="inline" />
          </div>
        }
      >
        DOL&apos;s case system answered and holds nothing under this number. Check it on{" "}
        <a target="_blank" href="https://flag.dol.gov/case-status-search" className="link" rel="noopener">
          DOL&apos;s case status page
        </a>
        .
      </AnswerPanel>
    );
  }

  const entry = entryFor(row.status);
  // DOL's live service leaves some decided applications on IN PROCESS; its
  // published file is then the record of the decision, and nothing that
  // assumes a wait (the timing panel, the alert form) is drawn.
  const fileDecided = decidedInFileOnly(row.status, record?.decisionDate ?? null);
  const done = row.isFinal || fileDecided;
  // When DOL usually decides a case like this one, for a pending application
  // only; null when there's no measured basis, and nothing is drawn.
  const timingFiled = (row.submittedDate ?? row.filingDate)?.slice(0, 10) ?? null;
  const timingFirstDay = posting?.beginDate ?? record?.beginDate ?? null;
  // An H-2B application in one of DOL's assignment groups is dated by its group.
  const firstDecision = awaitingFirstDecision(row.status);
  const group = !done && firstDecision && groupOf && groupTiming ? pickGroup(groupTiming, groupOf.peak, groupOf.letter) : null;
  const view = done || !firstDecision
    ? null
    : timingView({
        caseNumber: row.caseNumber,
        filingDate: timingFiled,
        firstDay: timingFirstDay,
        today: easternDay(),
        timing,
        group,
      });
  const u = row.status.toUpperCase();
  const granted = u === "FULL CERTIFICATION" || u === "PARTIAL CERTIFICATION" || u === "DETERMINATION ISSUED";
  const filed = formatDay(row.submittedDate) ?? formatDay(row.filingDate);
  return (
    <div>
      <AnswerPanel
        verdict={done ? "Decided" : "Waiting"}
        direction={granted ? "good" : u === "DENIED" ? "bad" : "flat"}
        label={
          <>
            {form} <span translate="no">{row.caseNumber}</span>
          </>
        }
        source={row.lastCheckedAt ? `DOL showed this status on ${formatDay(row.lastCheckedAt)}` : undefined}
        actions={
          done ? undefined : (
            <div className="mt-6 border-t border-foreground/10 pt-6">
              <WatchThisNumber caseNumber={row.caseNumber} program="seasonal" variant="inline" />
            </div>
          )
        }
      >
        DOL&apos;s status for this application is{" "}
        <b className="font-semibold" translate="no">
          {prettyStatus(row.status)}
        </b>
        .{filed ? ` It was filed ${filed}.` : ""}{" "}
        {fileDecided && record ? (
          <>
            DOL&apos;s published file records the decision:{" "}
            <b className="font-semibold">{publishedStatusLabel(record.status)}</b>
            {formatDay(record.decisionDate) ? `, ${formatDay(record.decisionDate)}` : ""}. Its live status isn&apos;t
            updated on some applications DOL has already decided.
          </>
        ) : (
          (entry?.summary ?? null)
        )}
      </AnswerPanel>

      {view ? (
        <SeasonalTimingPanel
          view={view}
          firstDay={timingFirstDay}
          filingDate={timingFiled}
          checked={view.group ? (checks?.groups ?? null) : (checks?.[view.visa] ?? null)}
        />
      ) : null}{" "}

      <SeasonalDetails
        record={record}
        posting={posting}
        pending={!done}
        caseNumber={row.caseNumber}
        ruleShownElsewhere={view?.ruleDay != null}
        firmLinked={pages.firmLinked}
        detail={detail}
      />{" "}

      <PageSection title="The record" lede="As DOL holds it.">
        <RecordList
          rows={[
            {
              label: "Employer",
              value: employerValue(
                row.employerName,
                pages.employerPage(row.employerSlug) ?? pages.employerPage(record?.employerSlug),
              ),
              raw: !!row.employerName,
            },
            { label: "Job title", value: row.jobTitle ?? "Not given", raw: !!row.jobTitle },
            { label: "Case number", value: row.caseNumber, raw: true, mono: true },
            { label: "Filed with DOL", value: filed ?? "Unknown" },
            { label: "Last checked against DOL", value: formatDay(row.lastCheckedAt) ?? "Today" },
          ]}
        />{" "}
        {entry ? (
          <p className="mt-4 text-sm">
            <Link href={`/perm-case-statuses#h2-${statusAnchor(entry.status)}`} className="link">
              What &ldquo;{prettyStatus(entry.status)}&rdquo; means, the rule behind it, and how many cases carry it
            </Link>
          </p>
        ) : null}
      </PageSection>
    </div>
  );
}
