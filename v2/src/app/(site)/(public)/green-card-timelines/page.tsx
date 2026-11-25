import type { Metadata } from "next";
import Link from "next/link";
import { queryStatic } from "@/lib/convexStatic";

import { api } from "@convex/_generated/api";
import { ShareTimeline } from "@/components/community/ShareTimeline";
import {
  AccountCodes,
  BoardKey,
  BoardTable,
  ContactOutcomes,
  InterviewLine,
  RecentApprovals,
  RfeBars,
  StageMedians,
  BesideTheCase,
  ThirdFta0Line,
  ThirtyDayLine,
  WhoIsWaiting,
} from "@/components/community/TimelineBoard";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { getFAQPageSchema } from "@/lib/structuredData";
import { FaqList } from "@/components/tools/FaqList";
import { BOARD_OPENS_AT, METRIC_MIN_N, OFFICE_LIST_OPENS_AT, shareProgress } from "@/lib/communityTimeline";
import { officeByCode, officeHref } from "@/lib/uscisOffices";
import { ReportedOverview } from "@/components/community/ReportedOverview";
import { getReportedOverview } from "@/lib/db/communityReports";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";
import { NoteBanner } from "@/components/ui/note";
import { softFail } from "@/lib/softRead";
import { easternDay } from "@/lib/time";
import { getUscisPosted } from "@/lib/db/uscisPosted";
import { agencyStepNotes } from "@/lib/agencyStepNotes";
import { waitPapers } from "@/lib/uscisPosted";
import { formatAsOf } from "@/lib/dolFormat";
import { Figure, FigureRow } from "@/components/data/FigureRow";
import { StepsByStage } from "@/components/community/StepFigures";
import { getReportedSummary } from "@/lib/db/reportedSummary";
import { formatInt } from "@/lib/format";
import { REPORTED_PLACES } from "@/lib/reportedCases";
import { stepTrend, windowText, type ReportedSummary } from "@/lib/reportedSummary";
import { StepBothSources } from "@/components/community/StepBothSources";
import { DataProvenance } from "@/components/data/DataProvenance";
import { KeepWhole } from "@/components/ui/keep-whole";

/**
 * Green card timelines, as the people waiting report them.
 *
 * Every figure counts every case people reported, from every source we read
 * (REPORTED_PLACES in src/lib/reportedCases.ts, and the timelines shared
 * here), each person once: the hourly build works them out
 * (scripts/lib_reported_summary.py) over the cases that finished each step in
 * the last 6 months, so past years never outvote this one. The timelines
 * shared here are the checked part, and keep their own board, RFE reasons,
 * account codes and contacts, which only their form asks about.
 * No case number, no employer and no exact PERM date appears here: a row is a
 * filing month and days since filing. The board lists rows only once enough
 * people have chosen to share, so no one row stands alone. Every timeline is
 * checked before it counts (convex/communityTimelines.ts), and the form to add
 * one sits near the top: no account and no case number needed.
 *
 * Reads one public Convex query (`communityTimelines.board`), which returns
 * only what this page prints. A deploy-skew window where the function does
 * not exist yet renders the empty state rather than failing the route.
 */

// The searched phrase first (Search Console, Nov 2026: "green card timeline", "perm timeline tracker").
const TITLE = "Reported Green Card Timelines, Step by Step";
const DESCRIPTION =
  `Each green card step's days, PERM to the card, from cases people reported in ${REPORTED_PLACES} and here.`;
const PATH = "/green-card-timelines";

export const metadata: Metadata = withSocialCard({
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: { ...openGraphBase, title: `${TITLE} | PERM Tracker`, description: DESCRIPTION, url: PATH },
}, "green-card-timelines");

export const revalidate = 21600;

type Board = Awaited<ReturnType<typeof fetchBoard>>;

async function fetchBoard() {
  // Today's Eastern day, so the week's approvals end today; the page redraws every few hours. That read's cache key
  // changes each day, so a failed first read of a new day falls back to the plain board, whose key never changes:
  // the page then loses only the week, never the whole board.
  return queryStatic(api.communityTimelines.board, { today: easternDay(Date.now()) }, revalidate).catch((error: unknown) => {
    softFail("green-card-timelines/page.fetchBoard(today)", null)(error);
    return queryStatic(api.communityTimelines.board, {}, revalidate);
  });
}


/** The questions people ask about this page, with answers that hold whatever the counts are. */
const FAQS = [
  {
    q: "Where do these figures come from?",
    a: "From every place people report their own dates that we read: public Telegram groups about PERM and green cards, public Facebook groups (typed in by hand from posts shared with us), public community sheets, Reddit, VisaStats' tracker and the timelines shared on this site. Each person counts once: two reports join only when three of their dates match. Each step counts the cases that finished it in the last 6 months, or 12 when 6 hold too few, so older years don't outvote this one. No name, username or message is shown.",
  },
  {
    q: "Are these USCIS's processing times?",
    a: "No. USCIS publishes its own times across every case, and they're on this site's USCIS processing times page. These are dates people typed in about their own case, so they say what those people saw. USCIS publishes nothing case by case, which is why this page exists.",
  },
  {
    q: "How do I add my I-485 or I-140 timeline?",
    a: "Open \"Add your dates\" on this page or on your USCIS office's page, pick the office and type the dates that have happened. It needs no account and no case number. Your browser keeps a key so you can edit or remove it later, and an edit code moves it to another device.",
  },
  {
    q: "Who can see my timeline?",
    a: `We check each timeline before it counts. After that your dates join the anonymous medians, which need ${METRIC_MIN_N} timelines before a figure shows. A row of your own is listed only if you tick the box, and only once ${BOARD_OPENS_AT} people have shared (${OFFICE_LIST_OPENS_AT} for one office's list). A row is the month you filed and the days each step took. A case number, an employer or an exact PERM date never shows.`,
  },
  {
    q: "Can I see timelines for one USCIS field office?",
    a: `Yes. Each office's page lists the timelines shared from it once ${OFFICE_LIST_OPENS_AT} people there have shared, with the days from filing the I-485 to biometrics, the interview and the green card.`,
  },
];

/**
 * The headline: the three steps people ask about most, each against the 6 months before. The count of cases is the
 * lede's and the last 30 days' green cards sit with the week's approvals (Nov 23 2026: five cells here buried the
 * durations, and the lede already gave the count on the same screen).
 */
function Headline({ summary }: { summary: ReportedSummary }) {
  const step = (id: string) => summary.steps.find((s) => s.id === id && s.median !== null);
  const gc = step("i485-gc");
  const perm = step("perm");
  const i140 = step("i140-premium");
  if (!gc && !perm && !i140) return null;
  return (
    <FigureRow className="mt-8">
      {gc ? (
        <Figure kind="community"
          label="I-485 filed to green card"
          value={`${formatInt(gc.median!)} days`}
          trend={stepTrend(gc) ?? undefined}
          note={`median of ${formatInt(gc.n)} decided in ${windowText(gc.windowDays)}${gc.before ? ", against the 6 months before" : ""}`}
        />
      ) : null}
      {perm ? (
        <Figure kind="community"
          label="PERM filed to decided"
          value={`${formatInt(perm.median!)} days`}
          trend={stepTrend(perm) ?? undefined}
          note={`median of ${formatInt(perm.n)} decided in ${windowText(perm.windowDays)}${perm.before ? ", against the 6 months before" : ""}`}
        />
      ) : null}
      {i140 ? (
        <Figure kind="community"
          label="I-140 with premium processing"
          value={`${formatInt(i140.median!)} days`}
          trend={stepTrend(i140) ?? undefined}
          note={`median of ${formatInt(i140.n)} decided in ${windowText(i140.windowDays)}${i140.before ? ", against the 6 months before" : ""}`}
        />
      ) : null}
    </FigureRow>
  );
}

export default async function GreenCardTimelinesPage() {
  const [board, posted, reported, summary] = await Promise.all([
    fetchBoard().catch(softFail<Board | null>("green-card-timelines/page.fetchBoard", null)),
    // USCIS's own posted times for the work permit and advance parole, beside people's reports. A failed read loses only that line.
    getUscisPosted().catch(softFail("green-card-timelines/page.getUscisPosted", null)),
    // Every source's reported cases at a glance. A failed read loses only that section.
    getReportedOverview().catch(softFail("green-card-timelines/page.getReportedOverview", null)),
    // Every figure over every source (the hourly build's summary). Without it the page falls back to the shared timelines'.
    getReportedSummary().catch(softFail<ReportedSummary | null>("green-card-timelines/page.getReportedSummary", null)),
  ]);
  // The agencies' own line under a step nobody has reported yet (the H-1B and its LCA, Nov 25 2026).
  const agencyNotes = agencyStepNotes(posted ? { published: posted.published, newest: posted.newest } : null);
  const papers = waitPapers(posted);
  const month = summary
    ? { greenCards: summary.headline.greenCards30, i140s: summary.headline.i140s30, perm: summary.headline.perm30 }
    : null;
  // Optional chaining: a backend older than Nov 11 2026 sends no `offices`.
  const offices = (board?.offices ?? []).flatMap((o) => {
    const office = officeByCode(o.code);
    const href = officeHref(o.code);
    return office && href ? [{ name: office.name, href: `${href}#timelines`, shared: o.shared }] : [];
  });
  const faqSchema = getFAQPageSchema(FAQS);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={faqSchema} />
      <div className="pt-10 sm:pt-12" />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">Reported green card timelines</h1>{" "}
        {/* Two lines on a wide screen. The places the cases come from are "Where they were reported", further down. */}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {summary
            ? `How long each step took, from ${formatInt(summary.headline.cases)} cases people reported, each person once. Self-reported, because USCIS doesn't publish it case by case.`
            : "How long each step after PERM took, from the people who went through it. Self-reported, because USCIS doesn't publish it case by case."}
        </p>
      </header>

      {/* The page's action right under the lede, before the figures: on a phone it sat 1,700px down (Nov 23 2026). */}
      {board || summary ? (
        <section className="mt-5 max-w-3xl" aria-labelledby="add-h">
          <h2 id="add-h" className="sr-only">
            Add yours
          </h2>{" "}
          <p className="text-base leading-relaxed text-soft">
            <KeepWhole>
              {"Waiting on an I-140 or an I-485? Add your dates. It takes a minute, with no account and no case " +
                "number, and we check each timeline before it counts."}
            </KeepWhole>
          </p>{" "}
          <ShareTimeline
            sharePath="/green-card-timelines"
            shareLabel="the green card timelines"
            progress={board ? shareProgress(board.shared, board.opensAt, "the board's list") : undefined}
            className="mt-3"
          />
        </section>
      ) : null}

      {summary ? <Headline summary={summary} /> : null}

      {board || summary ? (
        <>
          {/* Soft grounds by meaning (round 3, Oct 15 2026): the record in sage,
              what's shared in green, RFEs in the waiting yellow. */}
          {summary || !board ? null : (
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0" aria-label="The record so far">
            <div className="bg-sage p-5 border-2 shadow-hard border-border">
              <p className="text-sm text-muted-foreground">Timelines added</p>{" "}
              <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{board.total.toLocaleString("en-US")}</p>
            </div>{" "}
            <div className="bg-soft-good p-5 border-2 shadow-hard border-border">
              <p className="text-sm text-muted-foreground">Shared on the public board</p>{" "}
              <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{board.shared.toLocaleString("en-US")}</p>
            </div>{" "}
            <div className="bg-soft-wait p-5 border-2 shadow-hard border-border">
              <p className="text-sm text-muted-foreground">RFEs reported</p>{" "}
              <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{board.rfe.total.toLocaleString("en-US")}</p>
            </div>
          </section>
          )}

          {/* No week when the page fell back to the plain board. The last 30 days sit under the week's. */}
          {summary?.week ? (
            <RecentApprovals recent={summary.week} month={month} />
          ) : board?.recent ? (
            <RecentApprovals recent={board.recent} month={month} />
          ) : month ? (
            <ThirtyDayLine month={month} className="mt-8 max-w-3xl" />
          ) : null}{" "}

          <section className="mt-10" aria-labelledby="stages-h" data-embed="reported-timelines">
            <h2 id="stages-h" className="font-heading text-2xl font-bold sm:text-3xl">
              How long each step took
            </h2>{" "}
            {summary ? (
              <>
                <p className="mt-2 max-w-2xl text-base text-muted-foreground">
                  The bar is the middle half of the cases and the amber tick is the median. Each step counts the cases
                  that finished it in the last 6 months, or 12 when 6 hold too few, so older years don&apos;t outvote
                  this one. The blue line is the median by the month each case finished.
                </p>
                <div className="mt-5">
                  <StepsByStage steps={summary.steps} agency={agencyNotes} />
                </div>{" "}
                {board ? <BesideTheCase metrics={board.metrics} /> : null}{" "}
                <p className="mt-6 max-w-3xl text-base leading-relaxed">
                  What each step means, and what to do while you wait:{" "}
                  <Link href="/guides/i485-timeline-each-step" className="link font-bold">
                    <KeepWhole>{"the I-485 timeline"}</KeepWhole>
                  </Link>
                  ,{" "}
                  <Link href="/guides/i485-transferred-to-field-office" className="link font-bold">
                    a transfer to a field office
                  </Link>{" "}
                  and{" "}
                  <Link href="/guides/i485-interview-to-green-card" className="link font-bold">
                    the wait after the interview
                  </Link>
                  .
                </p>
              </>
            ) : board ? (
              <>
                <p className="mt-2 max-w-2xl text-base text-muted-foreground">
                  The bar is the middle half of the reports and the amber tick is the median. Every timeline counts here,
                  shared on the board or not
                  {board.scanCapped ? `, up to the newest ${board.scanCap.toLocaleString("en-US")}` : ""}.
                </p>
                <div className="mt-5">
                  <StageMedians metrics={board.metrics} />
                </div>
              </>
            ) : null}{" "}
            {papers && (papers.ead || papers.ap) ? (
              <p className="mt-5 max-w-2xl text-base leading-relaxed">
                {`USCIS's own posted times, as of its ${formatAsOf(papers.published)} posting: ${[
                  papers.ead ? `${papers.ead.months} months for a work permit based on a pending I-485, at the ${papers.ead.office}` : null,
                  papers.ap ? `${papers.ap.months} months for advance parole` : null,
                ]
                  .filter(Boolean)
                  .join(", and ")}. Each is the time within which it decided 8 cases in 10.`}{" "}
                <Link href="/uscis-processing-times" className="link font-bold">
                  Every time USCIS posts
                </Link>
              </p>
            ) : null}
          </section>

          <section className="mt-12" aria-labelledby="waiting-h">
            <h2 id="waiting-h" className="font-heading text-2xl font-bold sm:text-3xl">
              Who&apos;s waiting, and where
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              {summary?.waiting.open
                ? `The ${formatInt(summary.waiting.heard)} people heard from in the last year, at the furthest step each reported, then by category and country. Someone who last posted two years ago isn't counted as still waiting. Counts only, so no line can be traced to a person.`
                : "Each timeline at the furthest step it reports, by category and country. Counts only, from every timeline here, so no line can be traced to a person."}
            </p>
            <div className="mt-5">
              {summary?.waiting.open ? (
                <WhoIsWaiting waiting={summary.waiting} total={summary.waiting.heard} noun={["person", "people"]} />
              ) : /* Optional chaining: a backend older than this page sends no `waiting`. */ board?.waiting?.open ? (
                <WhoIsWaiting waiting={board.waiting} total={board.total} />
              ) : board ? (
                <p className="text-base text-muted-foreground">
                  Opens at {board.opensAt} timelines, like the board. {board.total.toLocaleString("en-US")} so far.
                </p>
              ) : null}
            </div>
          </section>

          <ReportedOverview overview={reported} counted={summary?.headline.cases ?? null} />{" "}

          {board ? (
          <>
          <section className="mt-12" aria-labelledby="board-h">
            <h2 id="board-h" className="font-heading text-2xl font-bold sm:text-3xl">
              Timelines shared here
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              {`${formatInt(board.total)} ${board.total === 1 ? "timeline was" : "timelines were"} shared on this site and checked by us before ${board.total === 1 ? "it counts" : "they count"}, and ${formatInt(board.shared)} of them chose to be listed. Every one counts in the figures above. The RFE reasons, account updates and contacts below come only from these, because only this form asks.`}
            </p>{" "}
            {board.open ? (
              <>
                <p className="mt-2 max-w-2xl text-base text-muted-foreground">
                  {board.shared > board.rows.length
                    ? `The newest ${board.rows.length.toLocaleString("en-US")} of ${board.shared.toLocaleString("en-US")} shared timelines, one row each. `
                    : "One row per shared timeline, newest first. "}
                  Each mark sits at the day it happened, counted from the PERM filing. No case number or employer is
                  shown.
                </p>
                <div className="mt-4">
                  <BoardKey />
                </div>
                <div className="mt-4">
                  <BoardTable rows={board.rows} />
                </div>
              </>
            ) : (
              <NoteBanner className="mt-4 [&_p]:max-w-3xl">
                <p className="font-heading text-xl font-bold">
                  Opens at {board.opensAt} shared timelines. {board.shared.toLocaleString("en-US")} so far.
                </p>{" "}
                <p className="mt-2">
                  A list with a handful of rows lets anyone pick one person out, so it stays shut until there are
                  enough to read as a crowd. The figures above already count every case, these included.
                </p>
              </NoteBanner>
            )}
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-soft">
              {offices.length > 0 ? (
                <>
                  By USCIS office:{" "}
                  {offices.map((o, i) => (
                    <span key={o.href}>
                      {i > 0 ? ", " : ""}
                      <Link href={o.href} className="link font-bold">
                        {o.name}
                      </Link>{" "}
                      ({o.shared.toLocaleString("en-US")})
                    </span>
                  ))}
                  .{" "}
                </>
              ) : null}
              <Link href="/i485-by-field-office" className="link font-bold">
                Every USCIS office&apos;s page
              </Link>{" "}
              has its own list, which opens at {OFFICE_LIST_OPENS_AT} shared timelines from that office.
            </p>
          </section>

          <section className="mt-12" aria-labelledby="rfe-h">
            <h2 id="rfe-h" className="font-heading text-2xl font-bold sm:text-3xl">
              Requests for evidence
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              What the RFEs on the timelines shared here asked about, and how they ended. It&apos;s self-reported, and people who got one
              are likelier to say so than people who didn&apos;t. So read it as a list of reasons. It isn&apos;t a rate.
            </p>
            <div className="mt-5">
              <RfeBars rfe={board.rfe} />
            </div>
          </section>

          {/* Optional: a backend older than Nov 17 2026 sends no codes and no third-FTA0 count. */}
          {board.codes?.length || board.thirdFta0?.reported ? (
            <section className="mt-12" aria-labelledby="codes-h">
              <h2 id="codes-h" className="font-heading text-2xl font-bold sm:text-3xl">
                Account updates
              </h2>{" "}
              {board.thirdFta0 ? (
                <div className="mt-4">
                  <ThirdFta0Line r={board.thirdFta0} />
                </div>
              ) : null}{" "}
              <AccountCodes codes={board.codes ?? []} where="shared timelines" className="mt-4" />
            </section>
          ) : null}

          {/* Optional: a backend older than Nov 18 2026 sends no contacts and no interview answers. */}
          {board.contacts?.some((o) => o.reported > 0) || board.interviews ? (
            <section className="mt-12" aria-labelledby="contacts-h">
              <h2 id="contacts-h" className="font-heading text-2xl font-bold sm:text-3xl">
                Interviews, and what people did to move a case
              </h2>{" "}
              {board.interviews ? (
                <div className="mt-4">
                  <InterviewLine r={board.interviews} />
                </div>
              ) : null}{" "}
              <div className="mt-4">
                <ContactOutcomes outcomes={board.contacts ?? []} />
              </div>
            </section>
          ) : null}
          </>
          ) : (
            <NoteBanner alert className="mt-12 max-w-2xl">
              <p>The timelines shared on this site can&apos;t be read right now, so their list, RFE reasons and contacts
                are missing. Every figure above still counts them. Try again in a few minutes.</p>
            </NoteBanner>
          )}
        </>
      ) : (
        <NoteBanner alert className="mt-8 max-w-2xl">
          <p>The timelines can&apos;t be read right now. Try again in a few minutes.</p>
        </NoteBanner>
      )}

      {board || summary ? null : (
        <section className="mt-10 max-w-3xl" aria-labelledby="add-h">
          <h2 id="add-h" className="font-heading text-2xl font-bold sm:text-3xl">
            Add yours
          </h2>{" "}
          <ShareTimeline sharePath="/green-card-timelines" shareLabel="the green card timelines" className="mt-3" />
        </section>
      )}

      <details className="mt-10 max-w-3xl border-t-2 border-border pt-4">
        <summary className="cursor-pointer list-none font-heading text-lg font-bold marker:content-none">
          <span className="inline-flex min-h-11 items-center">What these figures can&apos;t tell you</span>
        </summary>
        <div className="mt-3 space-y-3 text-base leading-relaxed text-soft">
          <p>
            <b>They aren&apos;t a sample of everyone.</b> People with a fast or a stuck case are likelier to add their
            dates than people whose case went as expected, and nobody can check a date after PERM. Read a median here
            as what the people who reported saw. It doesn&apos;t say what will happen to a case.
          </p>{" "}
          <p>
            <b>USCIS publishes its own medians.</b> For the office-wide picture, see{" "}
            <Link href="/uscis-processing-times" className="font-bold link">
              USCIS processing times
            </Link>
            , which are USCIS&apos;s figures across every case, and the{" "}
            <Link href="/visa-bulletin" className="font-bold link">
              visa bulletin
            </Link>
            <KeepWhole>{", which decides when an I-485 can be filed at all."}</KeepWhole>
          </p>{" "}
          <p>
            <b><KeepWhole>{"Premium and regular I-140s are kept apart"}</KeepWhole></b>, because a median across both describes neither. A
            timeline that doesn&apos;t say is left out of both.
          </p>
        </div>
      </details>

      <StepBothSources here="/green-card-timelines" groups={["pwd", "perm", "i140", "i485", "consular"]} reported={false} />{" "}
      <section className="mt-12 max-w-3xl">
        <h2 className="font-heading text-2xl font-bold sm:text-3xl">Questions about these timelines</h2>{" "}
        <FaqList items={FAQS} />
      </section>{" "}
      <DataProvenance
        datasets={["reported-cases", "community-posts-telegram", "community-posts-reddit", "community-posts-facebook", "community-visastats", "uscis-posted-times"]}
      />
    </div>
  );
}
