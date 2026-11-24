/**
 * One review stage, on its own page: who is waiting there, how long they've waited, and every case that has left
 * it since our record began, with where it went and how long it took.
 *
 * WHAT THIS ADDS THAT THE AUDIT PAGE DOES NOT. /perm-rfi-audit answers "what is an RFI and how many are open". A
 * reader here asks "how long does this step take, and where is mine": a census can't answer either. This page
 * answers both from our own record of DOL's statuses (`src/lib/stageWait.ts`): the day our daily check saw each case
 * arrive, or for an appeal our record didn't see begin, DOL's own denial date; and each move out, read by the day.
 *
 * WHY THERE IS NO "TYPICAL TIME" UNTIL IT CAN BE TRUE. A wait is only known once it ends, and the cases that end
 * first are the fast ones. So the page prints what holds today: how long the cases still waiting have waited so far,
 * how many of the arrivals our check followed have had an answer, and DOL's own posted month where it posts one.
 *
 * WHY FIVE PAGES AND NOT TWELVE. Measured on the pending cases, DOL's own test fixture excluded: ANALYST REVIEW
 * 93,219, then the review and appeal stages in the thousands and below. Analyst review is the ordinary queue and
 * /perm-queue draws it month by month, so it has no page here; every other stage lists all its cases.
 *
 * THE COUNT COMES FROM THE SAME QUERY THE AUDIT PAGE USES. `getReviewStages` on both, so the number a reader clicks
 * and the number they land on cannot disagree.
 */

import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChartTips } from "@/components/data/ChartTips";
import { DataProvenance } from "@/components/data/DataProvenance";
import { IndexHeader, type IndexFigure } from "@/components/data/IndexHeader";
import { PageBasics } from "@/components/data/PageBasics";
import { PageSection } from "@/components/data/PageSection";
import { STAGE_FEED_MAX } from "@/app/api/stage-cases/limits";
import { ReconsiderationNow } from "@/components/content/ReconsiderationNow";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { StageCaseBrowser } from "@/components/rfi/StageCaseBrowser";
import { StageExitBrowser } from "@/components/rfi/StageExitBrowser";
import { stageEntry } from "@/components/rfi/StageGlossary";
import { stageBasics } from "@/components/rfi/stageBasics";
import { MoveBar, MoveKey } from "@/components/rfi/StepByStep";
import { StageWaitChart, StageWeekBars } from "@/components/rfi/StageWaitCharts";
import { GROUP_STYLE, reviewStages, stageFromSlug, stageInSentence, stageMeta } from "@/components/rfi/stageMeta";
import { PanelTabs } from "@/components/ui/panel-tabs";
import { buttonVariants } from "@/components/ui/button";
import { breadcrumbSchema } from "@/lib/breadcrumbs";
import { caseSearchHref } from "@/lib/caseSearchPlan";
import { SITE_URL } from "@/lib/constants/site";
import { getProcessingTimesHistory } from "@/lib/db/processingTimes";
import { getFreshness } from "@/lib/db/publicData";
import { getReviewStages, getStageCohorts, getStageHistory, stageListing } from "@/lib/db/rfi";
import { getStageStats } from "@/lib/db/stageStats";
import { formatAsOf, formatMonth } from "@/lib/dolFormat";
import { formatInt } from "@/lib/format";
import { openGraphBase } from "@/lib/openGraphBase";
import { furthestWatched, reconsiderationPosted } from "@/lib/reconsiderationPosted";
import { softFail } from "@/lib/softRead";
import { withSocialCard } from "@/lib/socialCard";
import { movesFrom, reconsiderationOutcome, type Move } from "@/lib/stageMoves";
import { knownWaitSummary, waitBuckets, weeklyExits, type StageExit } from "@/lib/stageWait";
import { easternDay } from "@convex/lib/time";
import { keepWhole } from "@/components/ui/keep-whole";

/** Same window as the audit page this is a leaf of: the record moves daily. */
export const revalidate = 86400;

/**
 * The slug set is closed and known at build time, so a junk slug 404s without ever rendering: any loading boundary
 * above a segment makes Next commit "200 OK" before page code runs, after which `notFound()` can't change the status.
 */
export const dynamicParams = false;

/** Rows each list seeds the page with; the rest arrive from `/api/stage-cases` on the first search, sort or page. */
const MAX_ROWS = 250;
/** The answered list seeds less: it opens on the second tab, and its rows arrive with the first search or page. */
const ANSWERED_SEED = 100;

/** The guide that explains each stage, for the one next step at the foot of the page. */
const GUIDE: Record<string, { href: string; label: string }> = {
  "RECONSIDERATION APPEALS": { href: "/guides/perm-appeal-reconsideration-balca", label: "Appealing a PERM denial" },
  "REQUEST FOR REVIEW": { href: "/guides/perm-appeal-reconsideration-balca", label: "Appealing a PERM denial" },
  "BALCA APPEALS": { href: "/guides/perm-appeal-reconsideration-balca", label: "Appealing a PERM denial" },
  "DENIED - BALCA DISMISSED": { href: "/guides/perm-appeal-reconsideration-balca", label: "Appealing a PERM denial" },
  "RFI ISSUED": { href: "/guides/perm-rfi-issued-what-to-do", label: "What to do about an RFI" },
  "APPLICATION ON HOLD": { href: "/guides/perm-application-on-hold-meaning", label: "What application on hold means" },
  "NORD ISSUED": { href: "/guides/perm-nord-issued-meaning", label: "What NORD issued means" },
  "PENDING AUDIT RESPONSE": { href: "/guides/perm-audit-response", label: "Answering a PERM audit" },
  "SUPERVISED RECRUITMENT": { href: "/guides/what-perm-case-statuses-mean", label: "What each PERM status means" },
};

export function generateStaticParams() {
  return reviewStages().map((s) => ({ stage: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ stage: string }> }): Promise<Metadata> {
  const { stage } = await params;
  const status = stageFromSlug(stage);
  if (!status) notFound();
  const meta = stageMeta(status);
  const entry = stageEntry(status);

  const title = `PERM ${stageInSentence(status)}: how long cases wait`;
  // The definition's own first sentence, CFR-sourced where a regulation defines the stage, then what the page holds.
  const first = entry?.what.split(/(?<=\.)\s/)[0] ?? "";
  const description = `${first ? `${first} ` : ""}How long PERM cases wait at this step, every case answered since August 2026 and where it went, and every case still waiting.`.slice(
    0,
    155,
  );

  return withSocialCard(
    {
      title,
      description,
      alternates: { canonical: `/perm-rfi-audit/${stage}` },
      openGraph: { ...openGraphBase, title: `${title} | PERM Tracker`, description, url: `/perm-rfi-audit/${stage}` },
    },
    "perm-rfi-audit",
  );
}

/** Moves out of the stage, counted by destination, in the shape `movesFrom` reads. */
function movesOf(status: string, exits: readonly StageExit[]): Move[] {
  const n = new Map<string, number>();
  for (const e of exits) n.set(e.to, (n.get(e.to) ?? 0) + 1);
  return [...n.entries()].map(([to, count]) => ({ from: status, to, n: count }));
}

export default async function StagePage({ params }: { params: Promise<{ stage: string }> }) {
  const { stage } = await params;
  const status = stageFromSlug(stage);
  if (!status) notFound();

  const meta = stageMeta(status);
  const entry = stageEntry(status);
  const appeal = meta.group === "appeal";
  const isRecon = status === "RECONSIDERATION APPEALS";

  const [stages, cohorts, fresh, stats, postedHistory] = await Promise.all([
    getReviewStages(),
    getStageCohorts([status]),
    getFreshness().catch(softFail("perm-rfi-audit/[stage]/page.getFreshness", {} as Record<string, { asOf: string | null }>)),
    getStageStats().catch(softFail("perm-rfi-audit/[stage]/page.getStageStats", null)),
    isRecon ? getProcessingTimesHistory(120).catch(softFail("perm-rfi-audit/[stage]/page.getProcessingTimesHistory", null)) : null,
  ]);

  const row = stages.find((s) => s.status === status) ?? null;
  const cases = row?.cases ?? 0;
  const listing = stageListing(cases);
  const history = listing === "list" ? await getStageHistory(status, STAGE_FEED_MAX) : { cases: [], exits: [] };

  // The same fallback as the hub, so two linked pages print one date for one zero.
  const censusAsOf = stages.reduce<string | null>(
    (latest, st) => (st.seenTo && (latest === null || st.seenTo > latest) ? st.seenTo : latest),
    null,
  );
  const asOf = row?.seenTo ?? censusAsOf ?? fresh["perm-case-status"]?.asOf ?? null;
  const today = asOf ?? easternDay();

  // Waiting now: where each wait starts, how long so far.
  const starts = history.cases.map((c) => ({ on: c.startOn ?? null, source: c.startSource ?? "unknown" }));
  const summary = knownWaitSummary(starts, today);
  const bands = waitBuckets(starts, today);
  // The page's seed: the longest waits first, then the cases with no start on record, oldest filing first.
  const seed = [...history.cases]
    .sort((a, b) => {
      if (a.startOn && b.startOn) return a.startOn.localeCompare(b.startOn);
      if (a.startOn) return -1;
      if (b.startOn) return 1;
      return (a.filingDate ?? "").localeCompare(b.filingDate ?? "");
    })
    .slice(0, MAX_ROWS);

  // Answered: every move out since the record began, and where they went.
  const exits = history.exits;
  const moves = movesFrom(movesOf(status, exits), status);
  const recon = isRecon ? reconsiderationOutcome(movesOf(status, exits)) : null;
  const weeks = weeklyExits(exits, today, 12);
  const newestExit = exits[0]?.leftOn ?? null;

  // How many of the arrivals our check followed had left by the furthest day enough of them have been followed to.
  const curve = stats?.since ? stats.durations?.find((d) => d.stage.toUpperCase() === status)?.curve ?? [] : [];
  const watched = furthestWatched(curve);
  const posted = postedHistory ? reconsiderationPosted(postedHistory) : null;

  // Filing months this stage's open cases come from, biggest first.
  const months = cohorts
    .map((c) => ({ month: c.month, n: c.stages[status] ?? 0 }))
    .filter((m) => m.n > 0)
    .sort((a, b) => b.n - a.n || a.month.localeCompare(b.month));
  const oldestMonth = months.length ? months.reduce((a, b) => (a.month <= b.month ? a : b)).month : null;

  const asOfText = asOf ? formatAsOf(asOf) : null;
  const lede = (
    <>
      {formatInt(cases)} PERM {cases === 1 ? "case is" : "cases are"} at {stageInSentence(status)} today.
      {summary.median !== null ? ` The typical one we can date has waited ${formatInt(summary.median)} days so far.` : ""}
      {exits.length > 0 ? ` ${formatInt(exits.length)} left this step since August 30.` : ""}
    </>
  );

  const figures: IndexFigure[] = [
    { kind: "measured", label: "Waiting now", value: formatInt(cases), note: asOfText ? `as of ${asOfText}` : undefined },
    {
      kind: "measured",
      label: "Waited so far, typically",
      value: summary.median !== null ? `${formatInt(summary.median)} days` : "Not yet",
      note:
        summary.median !== null
          ? `${formatInt(summary.known)} with a start on record; the longest ${formatInt(summary.longest ?? 0)} days`
          : "no case here has a start on record yet",
    },
    {
      kind: "measured",
      label: "Left since Aug 30",
      value: formatInt(exits.length),
      note: newestExit ? `the newest on ${formatAsOf(newestExit)}` : "none seen yet",
    },
  ];

  const guide = GUIDE[status];
  const datasetSchema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `PERM cases at ${stageInSentence(status)}: waits and outcomes`,
    description: `Every PERM case DOL's live record shows at ${status}, with the day each one's wait began where PERM Tracker's daily check saw it, and every case that has left the stage since August 30, 2026, with where it went and how long it waited.`,
    url: `${SITE_URL}/perm-rfi-audit/${stage}`,
    ...(asOf ? { dateModified: asOf } : {}),
    temporalCoverage: `2026-08-30/${asOf ?? today}`,
    isBasedOn: "https://flag.dol.gov/case-status-search",
    creator: { "@type": "Organization", name: "PERM Tracker", url: SITE_URL },
    isAccessibleForFree: true,
    license: `${SITE_URL}/terms#intellectual-property`,
    variableMeasured: ["Days at this stage", "Where the case went next", "Day the case left the stage"],
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "text/csv",
        contentUrl: `${SITE_URL}/api/stage-cases?stage=${stage}&format=csv`,
      },
      {
        "@type": "DataDownload",
        encodingFormat: "text/csv",
        contentUrl: `${SITE_URL}/api/stage-cases?stage=${stage}&kind=answered&format=csv`,
      },
    ],
  };

  return (
    <>
      <JsonLdScript schema={breadcrumbSchema(`/perm-rfi-audit/${stage}`, meta.label)} />{" "}
      {listing === "list" ? <JsonLdScript schema={datasetSchema} /> : null}
      <div className="mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
        <IndexHeader
          title={`PERM ${stageInSentence(status)}`}
          lede={lede}
          figures={listing === "list" ? figures : []}
          aside={
            entry?.deadline ? (
              <p className="border-l-4 border-[var(--data-warn)] bg-tint px-4 py-3 text-base">
                <b className="font-bold">Deadline.</b> {entry.deadline}
              </p>
            ) : undefined
          }
        />

        {listing === "list" ? (
          <section aria-label={`The cases at ${stageInSentence(status)}`} className="mt-10">
            <PanelTabs
              label={`Cases at ${stageInSentence(status)}`}
              tabs={[
                {
                  id: "waiting-now",
                  label: `Waiting now (${formatInt(cases)})`,
                  panel: (
                    <div className="mt-5">
                      <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                        Longest wait first. &ldquo;Here since&rdquo; is the day our daily check saw the case arrive
                        {appeal ? ", or for an older appeal, the day DOL denied it" : ""}. Search, sort or filter by filing year.
                      </p>{" "}
                      <div className="mt-4">
                        <StageCaseBrowser slug={stage} status={status} seed={seed} totalCount={cases} asOf={asOf ?? null} />
                      </div>{" "}
                      {/* Every case number in the page's own HTML, compactly, so a person who searches their number
                          finds this page. The lookup URLs themselves are kept out of crawlers (each is a live
                          render), so this list is the only place a pending number is indexable. */}
                      <details className="mt-6 border-t-2 border-border pt-4">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">
                          All {formatInt(history.cases.length)} case numbers at this stage, as text
                        </summary>{" "}
                        <p className="mt-3 font-mono text-sm leading-relaxed text-soft">
                          {history.cases.map((c, i) => (
                            <Fragment key={c.caseNumber}>
                              {i > 0 ? ", " : ""}
                              <Link href={`/perm-case-status?case=${encodeURIComponent(c.caseNumber)}`} className="link">
                                {c.caseNumber}
                              </Link>
                            </Fragment>
                          ))}
                        </p>
                      </details>
                    </div>
                  ),
                },
                {
                  id: "answered-cases",
                  label: `Left since Aug 30 (${formatInt(exits.length)})`,
                  panel: (
                    <div className="mt-5">
                      <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                        Newest first: where each case went, the day, and how long it had waited here. Filter by where
                        they went.
                      </p>{" "}
                      <div className="mt-4">
                        <StageExitBrowser
                          slug={stage}
                          status={status}
                          seed={exits.slice(0, ANSWERED_SEED)}
                          totalCount={exits.length}
                          asOf={asOf ?? null}
                        />
                      </div>
                    </div>
                  ),
                },
              ]}
            />{" "}
            <p className="mt-4 text-sm text-muted-foreground">
              Download{" "}
              <a href={`/api/stage-cases?stage=${encodeURIComponent(stage)}&format=csv`} className="link">
                the {formatInt(cases)} waiting
              </a>{" "}
              or{" "}
              <a href={`/api/stage-cases?stage=${encodeURIComponent(stage)}&kind=answered&format=csv`} className="link">
                the {formatInt(exits.length)} that left
              </a>{" "}
              as CSV, or{" "}
              <Link href={caseSearchHref({ stage })} className="link">
                open this stage in case search
              </Link>
              , where it combines with an employer, a job title or a filing month.
            </p>
          </section>
        ) : (
          <section className="mt-10">
            <p className="max-w-3xl text-base leading-relaxed">
              No case is at this stage today. That can change any day, and this page is rebuilt daily.{" "}
              <Link href="/perm-rfi-audit" className="link">
                The other stages
              </Link>{" "}
              are where the pending cases are.
            </p>
          </section>
        )}

        {listing === "list" ? (
          <PageSection
            id="how-long"
            title="How long cases have waited here"
            lede={
              <>
                The {formatInt(bands.known)} cases waiting now with a start on record, by how long they&apos;ve waited so
                far{asOfText ? `, as of ${asOfText}` : ""}.
              </>
            }
          >
            <StageWaitChart
              buckets={bands.buckets}
              unknown={bands.unknown}
              appeal={appeal}
              label={`PERM cases at ${stageInSentence(status)} by how long they've waited so far`}
            />{" "}
            {watched && watched.eligible > 0 ? (
              <p className="mt-6 max-w-3xl text-base leading-relaxed">
                <b className="font-bold">
                  Of the {formatInt(watched.eligible)} cases our daily check saw arrive and has followed for at least{" "}
                  {watched.days} days, {formatInt(watched.left)} had left by then.
                </b>{" "}
                A typical time for the whole step can only be printed once half of them have left, and this page will
                show it on its own then.
              </p>
            ) : null}{" "}
            {isRecon ? (
              <div className="mt-6 max-w-3xl">
                <ReconsiderationNow part="dol" />
              </div>
            ) : null}
          </PageSection>
        ) : null}

        {listing === "list" && weeks.some((w) => w.total > 0) ? (
          <PageSection
            id="each-week"
            title="Cases leaving this step each week"
            lede="How many left each week since our daily check began, and where they went."
          >
            <StageWeekBars weeks={weeks} label={`PERM cases leaving ${stageInSentence(status)} each week, by where they went`} />
          </PageSection>
        ) : null}

        {moves ? (
          <PageSection
            id="where-next"
            title="Where cases go from here"
            lede={`All ${formatInt(moves.total)} moves out of this step our daily check has seen since August 30, 2026.`}
          >
            {recon ? (
              <p className="max-w-3xl text-base leading-relaxed">
                <b className="font-bold">
                  {Math.round(recon.certifiedShare * 100)}% of decided requests ended in certification
                </b>{" "}
                ({formatInt(recon.certified)} of {formatInt(recon.decided)}). Another {formatInt(recon.reopened)} were sent
                back for review or put on hold, and {formatInt(recon.refused)} were refused with a NORD or a denial.
              </p>
            ) : null}{" "}
            <div className={recon ? "mt-4" : undefined}>
              <MoveBar rows={moves.rows} label={`${meta.label}: where ${formatInt(moves.total)} cases went next`} />
              <MoveKey rows={moves.rows} />
            </div>
          </PageSection>
        ) : null}

        {months.length > 0 ? (
          <PageSection
            id="filing-months"
            title="Which filing months these come from"
            lede="Where the cases waiting here today were filed. A live status shows where a case stands now, not how often DOL issues one."
          >
            <ChartTips label={`${meta.label} cases by filing month`}>
              <ol className="space-y-1">
                {months.slice(0, 18).map((m) => {
                  const share = cases > 0 ? (m.n / cases) * 100 : 0;
                  return (
                    <Fragment key={m.month}>
                      {" "}
                      <li className="grid min-h-11 grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2 [&>*]:min-w-0 sm:gap-3">
                        <Link href={`/perm-queue/${m.month}`} className="link inline-flex min-h-11 items-center truncate text-sm">
                          {m.month}
                        </Link>{" "}
                        <span
                          className="h-3 border border-input"
                          style={{ width: `${Math.max(1, share)}%`, backgroundColor: GROUP_STYLE[meta.group].fill }}
                          aria-hidden="true"
                          data-tip={`Filed in ${formatMonth(m.month) ?? m.month}\n${formatInt(m.n)} ${m.n === 1 ? "case" : "cases"} at ${meta.label}\n${share.toFixed(1)}% of the ${formatInt(cases)}`}
                        />{" "}
                        <span className="text-right text-sm tabular-nums text-soft">{formatInt(m.n)}</span>
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            </ChartTips>{" "}
            {months.length > 18 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {formatInt(months.length - 18)} further months hold smaller numbers.
                {oldestMonth ? ` The oldest is ${oldestMonth}.` : ""}
              </p>
            ) : null}
          </PageSection>
        ) : null}

        {entry ? (
          <PageSection id="what-it-means" title="What this status means">
            <div className="grid max-w-3xl gap-3 text-base leading-relaxed">
              <p>{keepWhole(entry.what)}</p>{" "}
              {entry.next ? <p className="text-soft">{entry.next}</p> : null}{" "}
              <p className="text-sm text-muted-foreground">
                DOL&apos;s record prints it as <span className="font-mono font-bold text-foreground">{status}</span>.
              </p>
            </div>
          </PageSection>
        ) : null}

        {listing === "list" ? (
          <PageBasics
            page={`perm-rfi-audit/${stage}`}
            entries={stageBasics({
              status,
              label: meta.label,
              cases,
              asOf,
              known: summary.known,
              median: summary.median,
              longest: summary.longest,
              answered: exits.length,
              watched,
              moves,
              posted: posted ? { month: posted.last.month, asOf: posted.last.asOf, droppedAsOf: posted.droppedAsOf } : null,
            })}
          />
        ) : null}

        <section className="mt-14">
          <h2 className="font-heading text-xl font-bold">The other stages</h2>{" "}
          <ul className="mt-4 flex flex-wrap gap-2">
            {/* From the static vocabulary, not the query: a stage holding nothing today still gets its link. */}
            {reviewStages()
              .filter((s) => s.status !== status)
              .map((s) => (
                <Fragment key={s.status}>
                  {" "}
                  <li>
                    <Link href={`/perm-rfi-audit/${s.slug}`} className={buttonVariants({ variant: "outline", size: "default" })}>
                      {keepWhole(stageMeta(s.status).label)}
                      <span className="font-mono text-sm font-normal tabular-nums text-muted-foreground">
                        {formatInt(stages.find((x) => x.status === s.status)?.cases ?? 0)}
                      </span>
                    </Link>
                  </li>
                </Fragment>
              ))}
          </ul>{" "}
          <h2 className="mt-10 font-heading text-xl font-bold">Read next</h2>{" "}
          <ul className="mt-3 grid gap-1 text-base">
            {guide ? (
              <li>
                <Link href={guide.href} className="link inline-flex min-h-11 items-center">
                  {keepWhole(guide.label)}
                </Link>
              </li>
            ) : null}{" "}
            <li>
              <Link href="/perm-case-status" className="link inline-flex min-h-11 items-center">
                Look up your case and get an email when it moves
              </Link>
            </li>{" "}
            <li>
              <Link href="/perm-rfi-audit" className="link inline-flex min-h-11 items-center">
                RFIs, audits and appeals: every stage at once
              </Link>
            </li>
          </ul>
        </section>

        <div className="mt-10">
          <DataProvenance datasets={["perm-case-status"]} />
        </div>
      </div>
    </>
  );
}
