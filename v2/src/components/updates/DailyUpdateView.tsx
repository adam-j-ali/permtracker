import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, EnvelopeSimpleIcon, HandPalmIcon, XCircleIcon } from "@phosphor-icons/react/ssr";

import { Figure, FigureRow } from "@/components/data/FigureRow";
import { PageSection } from "@/components/data/PageSection";
import { FiledOnDay } from "@/components/queue/FiledOnDay";
import { CaseLookupForm } from "@/components/tools/CaseLookupForm";
import { ShareLine } from "@/components/updates/ShareLine";
import { SearchParamsBoundary } from "@/hooks/useUrlSearchParams";
import type { ActivityDay } from "@/lib/activityStats";
import { UPDATES_PATH, daySpan, monthsToDraw, shareLabel, shareLine, trendAgainst, type DailyUpdate } from "@/lib/dailyUpdate";
import type { DayCase } from "@/lib/filingDay";
import { formatInt } from "@/lib/format";
import { federalHolidayName } from "@/lib/perm";
import { nextCheckLabel } from "@/lib/sweepSchedule";
import { checkedLabel, easternDay } from "@/lib/time";
import { longDate, shortDate, weekdayName } from "@convex/lib/months";

/**
 * One DOL day on one screen: how many PERM cases it certified, denied and saw withdrawn, which filing days the
 * certified ones came from, a line to paste into a chat, and the cases themselves.
 *
 * WHO IT'S FOR. Someone waiting on a PERM decision who asks, every evening, "what did DOL do today, and has it
 * reached my filing date?" The figures answer the first half and the filing-day picture the second, before any
 * list. People pass these counts around in group chats, so the day is also one sentence with the address typed
 * out.
 *
 * A DAY DOL IS STILL WORKING SAYS SO. Its counts can rise until 7 AM the next morning (src/lib/dolDay.ts), so the
 * page says "so far", names the last check and the next one, and compares nothing with a usual day: a part of a
 * day against a whole one always reads as a drop.
 *
 * THE COUNTS ARE THE DAILY SERIES' COUNTS, by the same buckets (src/lib/dailyUpdate.ts), so this page and the
 * homepage can't give one day two numbers.
 */

export interface DailyUpdateViewProps {
  /** The DOL day shown, "YYYY-MM-DD". */
  day: string;
  perm: DailyUpdate;
  wage: DailyUpdate;
  /** Every PERM move that day, for the list. */
  cases: DayCase[];
  /** False while DOL's day is still open: the counts can rise. */
  final: boolean;
  /** When our last check of DOL's record finished, epoch ms, or null when that couldn't be read. */
  checkedAt: number | null;
  /** The render's clock, epoch ms. */
  now: number;
  /** What this weekday usually brings, or null with nothing to compare. */
  usual: { certified: number | null; denied: number | null; withdrawn: number | null };
  /** Earlier days with a decision, newest first. */
  earlier: readonly ActivityDay[];
  /** The day after, when our record holds one. */
  nextDay: string | null;
  /** A day newer than this one that DOL was closed on, named above the figures (the index leads with a working day). */
  closedAfter?: { date: string; name: string }[];
  /** The day's list was cut at the feed's cap. */
  capped: boolean;
}

const dayHref = (iso: string) => `${UPDATES_PATH}/${iso}`;
/** "Dec 2025": short, so a month's name stays on one line beside its bar on a phone. */
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });

/** Certifications by the month they were filed in: one bar a month, the count beside it, the small months as one row. */
function FiledMonths({ months, total }: { months: DailyUpdate["certifiedByMonth"]; total: number }) {
  const { rows, rest } = monthsToDraw(months, total);
  const max = Math.max(1, ...rows.map((m) => m.n));
  const bar = (n: number) => (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="h-5 shrink-0 border-2 border-foreground bg-primary" style={{ width: `${Math.max(1.5, (n / max) * 70)}%` }} />{" "}
      <span className="whitespace-nowrap font-mono text-sm tabular-nums">
        {formatInt(n)}
        <span className="text-soft">{` (${shareLabel(n, total)})`}</span>
      </span>
    </span>
  );
  return (
    <table className="mt-5 w-full max-w-2xl border-collapse text-left text-base">
      <caption className="sr-only">Certified cases by the month they were filed, with each month&apos;s share of the day</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Filed in{" "}</th>
          <th scope="col">Certified{" "}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.month} className="align-middle">
            <th scope="row" className="w-24 whitespace-nowrap py-1.5 pr-3 text-sm font-normal text-soft">
              {`${monthLabel(m.month)} `}
            </th>
            <td className="py-1.5">{bar(m.n)}</td>
          </tr>
        ))}
        {rest ? (
          <tr className="align-middle">
            <th scope="row" className="w-24 py-1.5 pr-3 text-sm font-normal text-soft">
              {`${rest.months} other months `}
            </th>
            <td className="py-1.5">{bar(rest.n)}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export function DailyUpdateView({ day, perm, wage, cases, final, checkedAt, now, usual, earlier, nextDay, closedAfter = [], capped }: DailyUpdateViewProps) {
  const weekday = weekdayName(day) ?? "";
  const dayLabel = longDate(day) ?? day;
  const holiday = federalHolidayName(day);
  const nextCheck = final ? null : nextCheckLabel(now);
  const f = perm.certifiedFiled;
  const core = perm.certifiedCore;
  const busiest = perm.busiestFilingDay;
  const previous = earlier[0]?.date ?? null;
  const today = easternDay(now);

  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-6 pb-12 sm:px-6 sm:pb-16">
      <header>
        <p className="text-base text-soft">
          {weekday}
          {holiday ? `. ${holiday}: DOL ${final ? "was" : "is"} closed` : final ? "" : ". DOL is still working this day"}
        </p>{" "}
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">PERM decisions, {dayLabel}</h1>
      </header>{" "}
      {/* The search comes first: most people land here asking about one case. */}
      <CaseLookupForm className="mt-5 max-w-2xl" compact label="Case number or employer" names help={null} source="perm-updates" flatFinder />{" "}
      {closedAfter.length > 0 ? (
        // data-card-hide: left off the social card, which is framed just under it and must say nothing dated.
        <p data-card-hide className="mt-5 max-w-2xl text-base leading-relaxed text-soft">
          {closedAfter.map((c) => {
            const now_ = c.date === today;
            return (
              <span key={c.date}>
                {now_ ? "Today" : `${weekdayName(c.date)}, ${shortDate(c.date)}`} {now_ ? "is" : "was"} {c.name}, a federal holiday: DOL {now_ ? "is" : "was"} closed.{" "}
                <Link href={dayHref(c.date)} className="link">
                  What our check still saw {now_ ? "today" : "that day"}
                </Link>
                .{" "}
              </span>
            );
          })}
        </p>
      ) : null}{" "}
      {/* #counts is where the page's social card is framed from (scripts/page-cards.json): the figures, masked. */}
      <FigureRow id="counts" className="mt-6 scroll-mt-24">
        <Figure
          label="Certified"
          tone="lime"
          icon={<CheckCircleIcon weight="bold" />}
          value={formatInt(perm.certified)}
          trend={final ? (trendAgainst(perm.certified, usual.certified, weekday, "good") ?? undefined) : undefined}
          note={final ? undefined : "so far"}
        />{" "}
        <Figure
          label="Denied"
          icon={<XCircleIcon weight="bold" />}
          value={formatInt(perm.denied)}
          trend={final ? (trendAgainst(perm.denied, usual.denied, weekday, "bad") ?? undefined) : undefined}
          note={final ? undefined : "so far"}
        />{" "}
        <Figure
          label="Withdrawn"
          icon={<HandPalmIcon weight="bold" />}
          value={formatInt(perm.withdrawn)}
          trend={final ? (trendAgainst(perm.withdrawn, usual.withdrawn, weekday, "info") ?? undefined) : undefined}
          note={final ? "by the employer" : "so far, by the employer"}
        />{" "}
        <Figure label="Letters sent" icon={<EnvelopeSimpleIcon weight="bold" />} value={formatInt(perm.asked)} note="an RFI, an audit or a notice to the employer" />
      </FigureRow>{" "}
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-soft">
        {final ? (
          <>This day is complete: it ran from 7 AM Eastern to 7 AM the next morning, when DOL&apos;s evening work lands.</>
        ) : (
          <>
            These counts can still rise.{checkedAt ? ` Our last check of DOL's record finished ${checkedLabel(checkedAt)}.` : ""}
            {nextCheck ? ` The next starts at ${nextCheck} Eastern, and the list follows about half an hour later.` : ""}
          </>
        )}
      </p>{" "}
      {perm.certified > 0 ? (
        <PageSection
          id="filed"
          title="Which filing dates DOL certified"
          lede={
            core ? (
              <>
                8 in 10 of the day&apos;s certifications were filed between <b className="font-semibold text-foreground">{daySpan(core.from, core.to)}</b>
                {busiest ? (
                  <>
                    . The busiest filing day was {longDate(busiest.day)}, with {formatInt(busiest.n)}
                  </>
                ) : null}
                .
              </>
            ) : f && f.oldest !== f.newest ? (
              <>
                They were filed between <b className="font-semibold text-foreground">{daySpan(f.oldest, f.newest)}</b>.
              </>
            ) : f ? (
              <>
                {perm.certified === 1 ? "It was" : "They were"} filed <b className="font-semibold text-foreground">{longDate(f.oldest)}</b>.
              </>
            ) : (
              <>DOL&apos;s record names no filing day for them.</>
            )
          }
        >
          {perm.certifiedByMonth.length > 0 && f ? <FiledMonths months={perm.certifiedByMonth} total={f.n} /> : null}{" "}
          {f && core && (f.oldest !== core.from || f.newest !== core.to) ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-soft">
              The whole span runs from {longDate(f.oldest)} to {longDate(f.newest)}: a few older cases come back from an RFI or an appeal, and a few newer ones are decided out of order.
            </p>
          ) : null}
        </PageSection>
      ) : null}{" "}
      <PageSection id="share" title="The day in one line" lede="For a group chat, with the page's address typed out.">
        <ShareLine className="mt-4" line={shareLine(perm, { final })} day={day} />
      </PageSection>{" "}
      <PageSection
        id="cases"
        title="The cases"
        lede={
          perm.total > 0 ? "Every PERM case DOL moved that day. Pick a status to narrow the list." : undefined
        }
      >
        {perm.total === 0 ? (
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-soft">
            Our checks saw DOL move no PERM case on {dayLabel}.{holiday ? ` It ${final ? "was" : "is"} ${holiday}, a federal holiday.` : ""} That&apos;s a real
            answer: nothing is missing.
          </p>
        ) : (
          <div className="mt-5">
            {/* The list reads its filters from the address, so it needs a boundary whose fallback is the list itself. */}
            <SearchParamsBoundary>
              <FiledOnDay perm={cases} pwd={[]} dayLabel={dayLabel} moved tabs={false} />
            </SearchParamsBoundary>
            {capped ? (
              <p className="mt-4 text-sm text-soft">This day holds more moves than the list shows. The counts above are of the whole day.</p>
            ) : null}
          </div>
        )}
      </PageSection>{" "}
      {wage.total > 0 ? (
        <PageSection id="wage" title="Prevailing wage requests">
          <p className="mt-3 max-w-2xl text-base leading-relaxed">
            DOL issued <b className="font-semibold">{formatInt(wage.certified)}</b> {wage.certified === 1 ? "wage determination" : "wage determinations"}
            {wage.certifiedCore ? <>, 8 in 10 of them on requests filed between {daySpan(wage.certifiedCore.from, wage.certifiedCore.to)}</> : null}
            {wage.asked > 0 ? <>, and asked for more on {formatInt(wage.asked)}</> : null}.{" "}
            <Link href={`/perm-decision-activity?day=${day}#day`} className="link">
              Every wage request DOL moved that day
            </Link>
          </p>
        </PageSection>
      ) : null}{" "}
      <nav aria-label="Other days" className="mt-12 border-t-2 border-border pt-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {previous ? (
            <Link href={dayHref(previous)} className="link inline-flex min-h-11 items-center gap-1.5">
              <ArrowLeftIcon aria-hidden="true" className="size-4" weight="bold" /> {longDate(previous)}
            </Link>
          ) : null}{" "}
          {nextDay ? (
            <Link href={dayHref(nextDay)} className="link inline-flex min-h-11 items-center gap-1.5">
              {longDate(nextDay)} <ArrowRightIcon aria-hidden="true" className="size-4" weight="bold" />
            </Link>
          ) : null}{" "}
          <Link href="/perm-decision-activity" className="link inline-flex min-h-11 items-center sm:ml-auto">
            Every day, and DOL&apos;s pace over time
          </Link>
        </div>{" "}
        {earlier.length > 0 ? (
          <ul className="mt-4 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-5 [&>*]:min-w-0">
            {earlier.map((d) => (
              <li key={d.date}>
                <Link href={dayHref(d.date)} className="block min-h-11 border-2 border-border bg-card px-3 py-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span className="block text-sm text-soft">
                    {weekdayName(d.date)?.slice(0, 3)}, {shortDate(d.date)}
                  </span>{" "}
                  <span className="block font-heading text-lg font-bold tabular-nums">
                    {formatInt(d.certified)} <span className="text-sm font-normal text-soft">certified</span>
                  </span>
                </Link>{" "}
              </li>
            ))}
          </ul>
        ) : null}
      </nav>
    </div>
  );
}
