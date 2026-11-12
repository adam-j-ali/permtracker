import Link from "next/link";
import { Fragment } from "react";

import { FigurePlate } from "@/components/tools/FigurePlate";
import { AnswerPanel } from "@/components/tools/Insight";
import { PageSection } from "@/components/data/PageSection";
import { Fold, FoldList } from "@/components/data/Fold";
import { FinePrint } from "@/components/data/FinePrint";
import { Figure, FigureRow } from "@/components/data/FigureRow";
import { DecidedShare, SplitBar } from "@/components/data/FigureVisual";
import { CalendarBlankIcon, CalendarCheckIcon, FileTextIcon, HourglassMediumIcon, QueueIcon, StackIcon } from "@phosphor-icons/react/ssr";
import { CaseNotFoundSeen } from "@/components/analytics/CaseNotFoundSeen";
import { WatchThisNumber } from "@/components/tools/WatchThisNumber";
import { CaseNumberPlate } from "@/components/tools/CaseNumberPlate";
import { CaseWall, CohortNeighbours } from "@/components/tools/CaseWall";
import { WontSay } from "@/components/tools/CaseStatusResult";
import type { CohortMonth } from "@/lib/liveQueue";
import type { Wall } from "@/lib/casePosition";
import type { ParsedCaseNumber } from "@/lib/permCaseNumber";
import { DOL_CASE_STATUS_URL } from "@/components/queue/SourceNote";
import { isLookupGap, unsettledClause, unsettledVerdict, type DiscoveryMiss } from "@/lib/dolMiss";
import { CASE_NUMBER_ACCURACY } from "@/lib/permCaseNumber";
import { formatInt } from "@/lib/format";
import { longDate, monthYear } from "@convex/lib/months";
import { queueNowFacts, type QueueFact } from "@/lib/queueNowFacts";

/**
 * A case number we hold no record for. A real state, not an error.
 *
 * THE WHOLE DESIGN PROBLEM IS ONE OF ATTRIBUTION. The filing month decodes
 * from the number itself, so the cohort around it can be shown even when the
 * case cannot be found, and a cohort figure sitting under somebody's own
 * case number reads as a figure about their case unless every single line
 * says otherwise. So nothing here is phrased as "your case", the heading
 * says what the numbers are about, and the first thing on the page is the
 * plain statement that the case was not found.
 *
 * WHY IT HAPPENS, and the page says so rather than implying a problem: DOL's
 * live system has no exact match, the case was decided before the decided files
 * we hold begin (October 2015), or a digit is off. None of those are anything
 * wrong with the case.
 */

export interface CaseNotFoundProps {
  caseNumber: string;
  /** Decoded from the number, when it decodes at all. */
  parsed: ParsedCaseNumber | null;
  /**
   * The legacy three-segment form, which carries no readable filing date.
   *
   * The two formats diverge here and the page has to as well. A current-format
   * number we cannot find still yields a filing month, so the cohort around it
   * is real context. A legacy one yields nothing, and showing a month anyway
   * would mean guessing: reading its middle block as a date is right 13.4% of
   * the time against 90.5% for the current format.
   */
  isLegacy?: boolean;
  cohort: CohortMonth | null;
  wall: Wall | null;
  neighbours: readonly CohortMonth[];
  publishedFront: string | null;
  publishedAsOf: string | null;
  mirrorSize: number | null;
  /**
   * Why DOL's live check could not settle it (caseLookup's `dolMiss`). Only
   * "none", or no value, may read as "no record": "unavailable" means DOL did
   * not answer in time and "not-asked" that it was not asked, and saying "no
   * record" for those would tell people DOL had no such case when it had only
   * been slow.
   */
  dolMiss?: DiscoveryMiss | "records" | null;
}

export function CaseNotFound({
  caseNumber,
  parsed,
  isLegacy = false,
  cohort,
  wall,
  neighbours,
  publishedFront,
  publishedAsOf,
  mirrorSize,
  dolMiss = null,
}: CaseNotFoundProps) {
  const month = (iso: string) => monthYear(iso) ?? iso;
  // For the count of lookups that end here: the number's form, never the number.
  const format = isLegacy ? "legacy" : parsed ? "current" : "unreadable";
  const checked = mirrorSize
    ? `Checked ${formatInt(mirrorSize)} per-case statuses and DOL's decided files since October 2015`
    : null;
  if (isLookupGap(dolMiss)) {
    const retry = `/perm-case-status?case=${encodeURIComponent(caseNumber)}`;
    return (
      <div>
        <CaseNotFoundSeen why="gap" format={format} />
        <AnswerPanel
          verdict={unsettledVerdict(dolMiss)}
          direction="flat"
          source={
            checked && dolMiss !== "records"
              ? `${checked}; ${dolMiss === "unavailable" ? "DOL's live check didn't answer within 8 seconds" : "the live check with DOL wasn't made"}`
              : undefined
          }
        >
          {dolMiss === "records" ? "We couldn't check" : "We hold no record for"}{" "}
          <b className="font-mono" translate="no">
            {caseNumber}
          </b>
          {dolMiss === "records" ? " just now: " : " yet, "}
          {unsettledClause(dolMiss)}{" "}
          <a href={retry} className="link">
            Try again
          </a>{" "}
          or use{" "}
          <a target="_blank" href={DOL_CASE_STATUS_URL} rel="noopener noreferrer" className="link">
            DOL&apos;s own case-status search
          </a>
          .
        </AnswerPanel>
      </div>
    );
  }
  return (
    <div>
      <CaseNotFoundSeen why="none" format={format} />
      <AnswerPanel
        verdict="Not in our records"
        direction="flat"
        label={<span translate="no">{caseNumber}</span>}
        source={checked ? `${checked}, then asked DOL directly` : undefined}
        actions={
          // A number in the current format we can't find is usually a recent
          // filing, the case most worth watching. Legacy numbers are all
          // decided, so they get nothing.
          isLegacy ? undefined : (
            <div className="mt-6 border-t border-foreground/10 pt-6">
              <WatchThisNumber caseNumber={caseNumber} program="perm" variant="inline" />
            </div>
          )
        }
      >
        We hold no record for this number. That isn&apos;t a statement about the case, only that this project
        hasn&apos;t got it, and{" "}
        {/* THE CASE-STATUS SEARCH, NOT THE PROCESSING-TIMES PAGE: the link says
            DOL's own system is the authority on THIS NUMBER. */}
        <a target="_blank" href={DOL_CASE_STATUS_URL} rel="noopener noreferrer" className="link">
          DOL&apos;s own case-status search
        </a>{" "}
        is the authority either way.
      </AnswerPanel>

      <PageSection title="Why a real case can be missing here">
        <ul className="max-w-3xl space-y-3 text-base leading-relaxed text-soft">
          <li>
            <b className="font-semibold text-foreground">DOL doesn&apos;t return it.</b> A number we don&apos;t
            already hold is asked of DOL at the moment you search, so a filing from this week resolves. If DOL&apos;s
            own system has no exact match, neither do we.
          </li>{" "}
          <li>
            <b className="font-semibold text-foreground">It was decided before October 2015.</b> DOL&apos;s published
            decision files we hold start then.
          </li>{" "}
          <li>
            <b className="font-semibold text-foreground">A digit is off.</b> One wrong digit in the serial is still a
            well-formed number that belongs to nobody. Check it against the receipt, or{" "}
            <Link href="/case-search" className="link">
              find the case by employer name
            </Link>
            .
          </li>
        </ul>{" "}
        {parsed ? (
          <FinePrint summary="What the case number says" className="mt-4">
            <CaseNumberPlate parsed={parsed} />{" "}
            <p>{CASE_NUMBER_ACCURACY}</p>
          </FinePrint>
        ) : null}
      </PageSection>

      {isLegacy ? (
        <PageSection title="This is the older case-number format">
          <p className="max-w-3xl text-base leading-relaxed text-soft">
            Numbers like{" "}
            <b className="font-mono font-semibold text-foreground" translate="no">
              {caseNumber}
            </b>{" "}
            are the older three-part format, used mostly in 2022 and 2023. Its middle digits aren&apos;t a filing date:
            read as one, they match DOL&apos;s receipt date only{" "}
            <b className="font-semibold text-foreground">13% of the time</b>, against 90% for the current format. Every
            case in this format is already decided and published, so a real one would be found here. Check the digits
            against the receipt.
          </p>
        </PageSection>
      ) : null}

      <FoldList>
        {parsed && cohort ? (
          // The heading carries the attribution: everything here is about a
          // month, and a reader who only reads headings must not think any of
          // it was measured on their case.
          <Fold title={`Cases filed in ${month(cohort.month)}`} hint="The month this number decodes to">
            <p className="max-w-2xl text-base leading-relaxed text-soft">
              <b className="font-semibold text-foreground">{`None of this was measured on ${caseNumber}`}</b>
              {`, which we couldn't find. It describes the ${formatInt(cohort.total)} cases we hold that were filed alongside it.`}
            </p>

            <FigureRow className="mt-6">
              <Figure
                label="Filed that month"
                icon={<CalendarBlankIcon weight="bold" className="text-primary-text" />}
                value={formatInt(cohort.total)}
                note="cases checked against DOL"
              />
              <Figure
                label="Still undecided"
                icon={<HourglassMediumIcon weight="bold" className="text-primary-text" />}
                value={formatInt(cohort.pending)}
                // The note under it says the share, so the bar is drawn alone.
                visual={
                  cohort.decided + cohort.pending > 0 ? (
                    <DecidedShare monthName={month(cohort.month)} decided={cohort.decided} pending={cohort.pending} caption={false} />
                  ) : undefined
                }
                note={
                  cohort.decidedPct !== null
                    ? `${cohort.decidedPct.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% of the month is decided`
                    : "of that month"
                }
              />
              {wall && !wall.isPastFront ? (
                <Figure
                  label="Filed before that month"
                  icon={<QueueIcon weight="bold" className="text-primary-text" />}
                  value={formatInt(wall.ahead)}
                  note="undecided, across every earlier month"
                />
              ) : null}
            </FigureRow>

            {wall && !wall.isPastFront ? (
              <FigurePlate
                title="The wall in front of that filing month"
                subject="Undecided cases by filing month"
                className="mt-6"
                caption={`Drawn for ${month(cohort.month)}, the month this number decodes to: the queue in front of that month rather than in front of any one case.`}
                source={
                  longDate(publishedAsOf)
                    ? `Per-case statuses from DOL's own case status system, checked daily · DOL queue position as of ${longDate(publishedAsOf)}`
                    : "Per-case statuses from DOL's own case status system, checked daily"
                }
              >
                {/* Not "Yours": the case wasn't found, so this column is the
                    month the NUMBER decodes to and nothing more. */}
                <CaseWall wall={wall} publishedFront={publishedFront} attribution="month" />
              </FigurePlate>
            ) : null}

            {neighbours.length > 1 ? (
              <CohortNeighbours months={neighbours} subjectMonth={cohort.month} attribution="month" className="mt-6" />
            ) : null}

            <p className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <Link href={`/perm-queue/${cohort.month}`} className="link">
                {`The full split for ${month(cohort.month)}`}
              </Link>{" "}
              <Link href="/perm-processing-times" className="link">
                Get told when DOL reaches that month
              </Link>
            </p>
          </Fold>
        ) : null}
        <Fold title="What this page won't tell you">
          <WontSay isFinal={false} />
        </Fold>
      </FoldList>
    </div>
  );
}

/** What a looked-up number brings, as the empty page lists it. */
const GETS_YOU: readonly { lead: string; rest: string }[] = [
  {
    lead: "The status, decoded.",
    rest: "DOL shows one word and explains none of them. Some mean waiting and some mean a 30-day clock is running on the employer.",
  },
  {
    lead: "The position.",
    rest: "How many undecided cases were filed before it, and how far its filing month sits behind the month DOL is working.",
  },
  { lead: "An estimated decision date, and an email when it moves.", rest: "" },
  {
    lead: "For a decided case, DOL's own file.",
    rest: "The outcome, the days it took, the offered wage against its occupation, and the worksite state.",
  },
];

/**
 * The page with nothing typed in yet.
 *
 * An empty screen is an invitation to act, and it is also the version of this
 * page that search engines index, so it states what the tool does and what
 * the queue looks like today rather than rendering a bare input.
 */
/** What each figure is, at a glance. Lime on the dark card, green ink on paper. */
function factIcon(kind: QueueFact["kind"]) {
  const Icon = { deciding: CalendarCheckIcon, oldest: HourglassMediumIcon, wall: StackIcon, dol: FileTextIcon }[kind];
  return <Icon weight="bold" className={kind === "deciding" ? "text-primary" : "text-primary-text"} />;
}

/**
 * The small picture under a figure, in the site's status colours. Under a month: how much of it DOL has decided
 * (green) and how much still waits (yellow). Under the wall: the cases up next beside the cases filed since.
 * Nothing is drawn for a month the census doesn't hold, or a wall with no split to show: the figure stands alone.
 */
function factPicture(
  kind: QueueFact["kind"],
  d: { deciding: string | null; front: string | null; wallTotal: number | null; months: readonly CohortMonth[]; toClear: number | null },
) {
  if (kind === "deciding" || kind === "oldest") {
    const month = kind === "deciding" ? d.deciding : d.front;
    const m = d.months.find((x) => x.month === month);
    if (!m || m.decided + m.pending <= 0) return undefined;
    return <DecidedShare monthName={monthYear(m.month) ?? m.month} decided={m.decided} pending={m.pending} />;
  }
  if (kind === "wall" && d.wallTotal !== null && d.toClear !== null && d.front && d.toClear > 0 && d.toClear < d.wallTotal) {
    const name = monthYear(d.front) ?? d.front;
    const since = d.wallTotal - d.toClear;
    return (
      <>
        <SplitBar
          parts={[
            { value: d.toClear, tone: "wait" },
            { value: since, tone: "info" },
          ]}
          label={`${formatInt(d.toClear)} of the ${formatInt(d.wallTotal)} undecided cases were filed in ${name} or earlier, and ${formatInt(since)} since`}
        />{" "}
        <span className="mt-1.5 block text-sm font-semibold">
          {formatInt(d.toClear)} filed in {name} or earlier{" "}
        </span>
      </>
    );
  }
  return undefined;
}

export function CaseStatusEmpty({
  deciding,
  front,
  wallTotal,
  publishedFront,
  publishedAsOf,
  mirrorSize,
  months = [],
  toClear = null,
}: {
  /** The filing month DOL is deciding by our own daily check (lib/permLine.ts), and the day of that check. */
  deciding: { month: string; asOf: string } | null;
  front: string | null;
  wallTotal: number | null;
  publishedFront: string | null;
  publishedAsOf: string | null;
  mirrorSize: number | null;
  /** Every filing month's decided and waiting counts, for the bar under a month. */
  months?: readonly CohortMonth[];
  /** Undecided cases filed in the oldest open month or earlier: the part of the wall that's up next. */
  toClear?: number | null;
}) {
  // The month DOL is on leads, and it's ours (lib/queueNowFacts.ts): this row once showed it only from DOL's own
  // table, DOL stopped printing a month on Oct 31 2026, and the figure dropped out with nothing said.
  const facts: QueueFact[] = queueNowFacts(deciding, front);
  if (wallTotal !== null) {
    facts.push({ kind: "wall", label: "Undecided cases", value: formatInt(wallTotal), note: "across every filing month, the whole wall" });
  }
  if (publishedFront && publishedFront !== front && publishedFront !== deciding?.month) {
    const asOf = longDate(publishedAsOf);
    facts.push({
      kind: "dol",
      label: "DOL's own table",
      value: monthYear(publishedFront) ?? publishedFront,
      note: asOf ? `its analyst review, as of ${asOf}` : "its analyst review",
    });
  }

  return (
    <div>
      {facts.length > 0 ? (
        <FigureRow>
          {facts.map((f) => (
            <Fragment key={f.label}>
              {" "}
              {/* The month DOL is deciding is the answer, so it alone takes the dark card. */}
              <Figure
                label={f.label}
                value={f.value}
                note={f.note}
                tone={f.kind === "deciding" ? "ink" : "paper"}
                icon={factIcon(f.kind)}
                visual={factPicture(f.kind, { deciding: deciding?.month ?? null, front, wallTotal, months, toClear })}
              />
            </Fragment>
          ))}
        </FigureRow>
      ) : null}{" "}
      <PageSection title="What a case number gets you here">
        <ul className="max-w-3xl space-y-3 text-base leading-relaxed text-soft">
          {GETS_YOU.map((b) => (
            <Fragment key={b.lead}>
              <li>
                <b className="font-semibold text-foreground">{b.lead}</b>
                {b.rest ? ` ${b.rest}` : null}
              </li>{" "}
            </Fragment>
          ))}
        </ul>
        {mirrorSize ? (
          <p className="mt-5 text-sm text-muted-foreground border-t-2 border-border">
            Searched against {formatInt(mirrorSize)} per-case statuses, read from DOL&apos;s own case-status search,
            plus DOL&apos;s published decisions since October 2015. Nothing is stored and nothing is sent anywhere else.
          </p>
        ) : null}
      </PageSection>
    </div>
  );
}
