import type { Metadata } from "next";
import Link from "next/link";
import { queryStatic } from "@/lib/convexStatic";

import { api } from "@convex/_generated/api";
import { ShareTimeline } from "@/components/community/ShareTimeline";
import { BoardKey, BoardTable, RfeBars, StageMedians, WhoIsWaiting } from "@/components/community/TimelineBoard";
import { JsonLdScript } from "@/components/seo/JsonLdScript";
import { FaqList } from "@/components/tools/FaqList";
import { BOARD_OPENS_AT, METRIC_MIN_N, OFFICE_LIST_OPENS_AT } from "@/lib/communityTimeline";
import { officeByCode, officeHref } from "@/lib/uscisOffices";
import { openGraphBase } from "@/lib/openGraphBase";
import { withSocialCard } from "@/lib/socialCard";
import { NoteBanner } from "@/components/ui/note";
import { softFail } from "@/lib/softRead";

/**
 * Green card timelines, as the people waiting report them.
 *
 * The PERM half of every timeline is read from DOL's own record by case
 * number; everything after PERM is self-reported, because USCIS publishes
 * nothing case by case, and the page says which is which at every figure.
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

const TITLE = "Green Card Timelines, as Reported";
const DESCRIPTION =
  "How long the I-140 and I-485 took, by step and by USCIS office, from the people waiting. Self-reported, checked before it shows, case numbers hidden.";
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
  return queryStatic(api.communityTimelines.board, {}, revalidate);
}


/** The questions people ask about this page, with answers that hold whatever the counts are. */
const FAQS = [
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

export default async function GreenCardTimelinesPage() {
  const board: Board | null = await fetchBoard().catch(softFail("green-card-timelines/page.fetchBoard", null));
  // Optional chaining: a backend older than Nov 11 2026 sends no `offices`.
  const offices = (board?.offices ?? []).flatMap((o) => {
    const office = officeByCode(o.code);
    const href = officeHref(o.code);
    return office && href ? [{ name: office.name, href: `${href}#timelines`, shared: o.shared }] : [];
  });
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage" as const,
    mainEntity: FAQS.map((f) => ({ "@type": "Question" as const, name: f.q, acceptedAnswer: { "@type": "Answer" as const, text: f.a } })),
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16">
      <JsonLdScript schema={faqSchema} />
      <div className="pt-10 sm:pt-12" />
      <header>
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">Green card timelines</h1>{" "}
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          How long each step after PERM took, from the people who went through it. The PERM dates are checked against
          DOL&apos;s record. The rest is self-reported, because USCIS doesn&apos;t publish it case by case.
        </p>
      </header>

      {board ? (
        <>
          {/* Soft grounds by meaning (round 3, Oct 15 2026): the record in sage,
              what's shared in green, RFEs in the waiting yellow. */}
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

          <section className="mt-8 max-w-3xl" aria-labelledby="add-h">
            <h2 id="add-h" className="sr-only">
              Add yours
            </h2>{" "}
            <p className="text-base leading-relaxed text-soft">
              Waiting on an I-140 or an I-485? Add your dates. It takes a minute, with no account and no case number, and
              we check each timeline before it counts.
            </p>{" "}
            <ShareTimeline sharePath="/green-card-timelines" shareLabel="the green card timelines" className="mt-3" />
          </section>

          <section className="mt-10" aria-labelledby="stages-h">
            <h2 id="stages-h" className="font-heading text-2xl font-bold sm:text-3xl">
              How long each step took
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              The bar is the middle half of the reports and the amber tick is the median. Every timeline counts here,
              shared on the board or not
              {board.scanCapped ? `, up to the newest ${board.scanCap.toLocaleString("en-US")}` : ""}.
            </p>
            <div className="mt-5">
              <StageMedians metrics={board.metrics} />
            </div>
          </section>

          <section className="mt-12" aria-labelledby="board-h">
            <h2 id="board-h" className="font-heading text-2xl font-bold sm:text-3xl">
              The board
            </h2>{" "}
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
                  A board with a handful of rows lets anyone pick one person out, so it stays shut until there are
                  enough to read as a crowd. The medians above already count every timeline added.
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

          <section className="mt-12" aria-labelledby="waiting-h">
            <h2 id="waiting-h" className="font-heading text-2xl font-bold sm:text-3xl">
              Who&apos;s waiting, and where
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              Each timeline at the furthest step it reports, by category and country. Counts only, from every timeline
              here, so no line can be traced to a person.
            </p>
            <div className="mt-5">
              {/* Optional chaining: a backend older than this page sends no `waiting`. */}
              {board.waiting?.open ? (
                <WhoIsWaiting waiting={board.waiting} total={board.total} />
              ) : (
                <p className="text-base text-muted-foreground">
                  Opens at {board.opensAt} timelines, like the board. {board.total.toLocaleString("en-US")} so far.
                </p>
              )}
            </div>
          </section>

          <section className="mt-12" aria-labelledby="rfe-h">
            <h2 id="rfe-h" className="font-heading text-2xl font-bold sm:text-3xl">
              Requests for evidence
            </h2>{" "}
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">
              What the RFEs people reported asked about, and how they ended. It&apos;s self-reported, and people who got one
              are likelier to say so than people who didn&apos;t. So read it as a list of reasons. It isn&apos;t a rate.
            </p>
            <div className="mt-5">
              <RfeBars rfe={board.rfe} />
            </div>
          </section>
        </>
      ) : (
        <NoteBanner alert className="mt-8 max-w-2xl">
          <p>The timelines can&apos;t be read right now. Try again in a few minutes.</p>
        </NoteBanner>
      )}

      {board ? null : (
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
            , which decides when an I-485 can be filed at all.
          </p>{" "}
          <p>
            <b>Premium and regular I-140s are kept apart</b>, because a median across both describes neither. A
            timeline that doesn&apos;t say is left out of both.
          </p>
        </div>
      </details>

      <section className="mt-12 max-w-3xl">
        <h2 className="font-heading text-2xl font-bold sm:text-3xl">Questions about these timelines</h2>{" "}
        <FaqList items={FAQS} />
      </section>
    </div>
  );
}
