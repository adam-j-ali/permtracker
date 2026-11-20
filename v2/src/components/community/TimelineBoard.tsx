import { Fragment } from "react";
import Link from "next/link";

import {
  CATEGORIES,
  COUNTRIES,
  DATE_FIELDS,
  METRIC_MIN_N,
  CONTACT_KINDS,
  RECENT_MIN,
  SIDE_METRIC_IDS,
  ROUTES,
  type BoardRow,
  type MetricResult,
  type UpdatesSummary,
  type RfeSummary,
  type WaitingView,
  type RecentApprovals,
} from "@/lib/communityTimeline";
import { ChartTips } from "@/components/data/ChartTips";
import { cn } from "@/lib/utils";
import { ScrollBox } from "@/components/ui/scroll-box";
import { officeByCode } from "@/lib/uscisOffices";

/** One stage in the empty state: its name and how many of the five reports a median needs it holds. */
function EmptyStep({ m, n }: { m: MetricResult; n: number | null }) {
  return (
    <li className="flex items-start gap-3 bg-sage p-3 border-2 border-border">
      {n !== null ? (
        <span className="flex size-7 shrink-0 items-center justify-center border-input font-mono text-sm font-bold border">
          {n}
        </span>
      ) : null}{" "}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{m.label}</span>{" "}
        <span aria-hidden="true" className="mt-2 flex gap-1">
          {Array.from({ length: METRIC_MIN_N }, (_, k) => (
            <span
              key={k}
              className={cn("h-2 flex-1 border border-input", k < m.n ? "bg-primary" : "bg-soft-wait")}
            />
          ))}
        </span>{" "}
        <span className="mt-1 block text-sm text-muted-foreground">
          {`${Math.min(m.n, METRIC_MIN_N)} of ${METRIC_MIN_N} reports`}
        </span>
      </span>
    </li>
  );
}

/**
 * The visual half of the green card timelines page, server-rendered, no
 * client code. Three pieces: the stage medians (a bar per stage, the middle
 * half drawn and the median marked), the board (one row per shared timeline,
 * each a track of dots placed by days since PERM filing), and the RFE counts.
 *
 * EVERY NUMBER CARRIES ITS COUNT, and a stage below the minimum says so in
 * words instead of drawing a bar. A median over three self-reported dates is
 * an anecdote with a decimal point.
 */

const label = <T extends { id: string; label: string }>(list: readonly T[], id: string | null) =>
  id ? (list.find((x) => x.id === id)?.label ?? id) : null;

const monthName = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" });

const days = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "day" : "days"}`;

export function StageMedians({ metrics }: { metrics: readonly MetricResult[] }) {
  const measured = metrics.filter((m) => m.median !== null);
  // One scale for every bar, so two stages can be compared by eye. Rounded up
  // to a whole 60 days so the axis reads as chosen.
  const top = Math.max(120, ...measured.map((m) => m.p75 ?? 0));
  const span = Math.ceil(top / 60) * 60;
  const pct = (d: number) => `${Math.min(100, (d / span) * 100)}%`;

  // NO STEP MEASURED YET: one chain of the steps, each with how many reports
  // it holds of the five a median needs, instead of the same sentence once a
  // step. Every row is still listed, so a reader sees what will be measured.
  if (measured.length === 0) {
    const chain = metrics.filter((m) => !SIDE_METRIC_IDS.includes(m.id));
    const side = metrics.filter((m) => SIDE_METRIC_IDS.includes(m.id));
    return (
      <div className="border-2 border-dashed border-foreground/40 p-4 sm:p-5">
        <p className="text-base text-muted-foreground">
          {`No step has the ${METRIC_MIN_N} reports a median needs yet. Each fills in as timelines arrive.`}
        </p>{" "}
        <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {chain.map((m, i) => (
            <Fragment key={m.id}>
              {" "}
              <EmptyStep m={m} n={i + 1} />
            </Fragment>
          ))}
        </ol>{" "}
        {side.length > 0 ? (
          <>
            <p className="mt-4 text-sm font-bold">Beside the case: RFEs and a spouse&apos;s H-4</p>{" "}
            <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
              {side.map((m) => (
                <Fragment key={m.id}>
                  {" "}
                  <EmptyStep m={m} n={null} />
                </Fragment>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <ChartTips label="Days each stage took, the median and the middle half">
    <ul className="grid grid-cols-1 gap-3">
      {metrics.map((m) => (
        <Fragment key={m.id}>
          {" "}
          <li className="bg-sage p-4 border-2 border-border">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-heading text-base font-bold">{m.label}</p>{" "}
              <p className="text-sm text-muted-foreground">
                {m.verified ? "DOL's record" : "self-reported"}, {m.n.toLocaleString("en-US")}{" "}
                {m.n === 1 ? "timeline" : "timelines"}
              </p>
            </div>{" "}
            {m.median !== null && m.p25 !== null && m.p75 !== null ? (
              <>
                <div
                  className="relative mt-3 h-6 border-input bg-card border"
                  aria-hidden="true"
                  data-tip={`${m.label}\nMedian ${days(m.median)}\nMiddle half ${m.p25.toLocaleString("en-US")} to ${days(m.p75)}\n${m.n.toLocaleString("en-US")} ${m.n === 1 ? "timeline" : "timelines"}, ${m.verified ? "DOL's record" : "self-reported"}`}
                >
                  <span
                    className={cn("absolute inset-y-0 border-x-2 border-input", m.verified ? "bg-primary" : "bg-card bg-hatch text-primary-text")}
                    style={{ left: pct(m.p25), width: `calc(${pct(m.p75)} - ${pct(m.p25)})` }}
                  />{" "}
                  {/* The median in the amber ink (round 3, Oct 15 2026: no black
                      marks in charts), ringed in the card's colour so it parts
                      from the lime bar in dark mode, where the two inks are close. */}
                  <span className="absolute inset-y-[-4px] w-1 bg-data-warn-ink ring-2 ring-card" style={{ left: pct(m.median) }} />
                </div>{" "}
                <p className="mt-2 text-base">
                  <b>Median {days(m.median)}</b>,{" "}
                  <span className="text-muted-foreground">
                    the middle half {m.p25.toLocaleString("en-US")} to {days(m.p75)}
                  </span>
                </p>
              </>
            ) : (
              <p className="mt-2 text-base text-muted-foreground">
                Not enough timelines yet: a median needs {METRIC_MIN_N}, and this stage has {m.n}.
              </p>
            )}
          </li>
        </Fragment>
      ))}
    </ul>
    </ChartTips>
  );
}

/** The stops a board row can show, in order, with a short name for the key. */
const STOPS = [
  { id: "permCertifiedOn", short: "PERM certified" },
  ...DATE_FIELDS.map((f) => ({ id: f.id as string, short: f.short as string })),
] as const;

/**
 * Tones by stage family (round 3, Oct 15 2026: no black or grey marks). A
 * decision is green, dark for DOL's certification and lime for USCIS's
 * approvals; a filing is the waiting yellow; the work and travel papers are
 * blue; the interview stays an open ring and biometrics an open square. The
 * key names every one, and the green card is a diamond, so no mark depends on
 * its colour alone.
 */
const DOT: Record<string, string> = {
  permCertifiedOn: "bg-data-good-ink",
  i140FiledOn: "bg-chart-yellow",
  i140ApprovedOn: "bg-primary",
  i485FiledOn: "bg-chart-yellow",
  biometricsOn: "bg-card",
  eadOn: "bg-chart-blue",
  apOn: "bg-chart-blue",
  i485jApprovedOn: "bg-chart-blue",
  interviewOn: "bg-card",
  greenCardOn: "bg-primary",
};

/** A mark's outline: the green card a diamond, biometrics a square, every other step a circle. */
const shape = (id: string) => (id === "greenCardOn" ? "rotate-45" : id === "biometricsOn" ? "" : "rounded-full");

export function BoardKey() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="What each mark means">
      {STOPS.map((s) => (
        <Fragment key={s.id}>
          {" "}
          <li className="inline-flex items-center gap-2">
            <span
              className={cn("inline-block size-3 border-input border", DOT[s.id], shape(s.id))}
              aria-hidden="true"
            />{" "}
            {s.short}
          </li>
        </Fragment>
      ))}
    </ul>
  );
}

const dayName = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The approvals people reported this week, so a day like a wave of work permits shows as a count. Each step prints
 * once RECENT_MIN people report it in the week; below that it reads "fewer than" the floor, never one person's date.
 */
/** The week's approvals: the shared timelines' (Convex) or every reported case's (the summary), one shape. */
export function RecentApprovals({
  recent,
}: {
  recent: Pick<RecentApprovals, "from" | "through"> & { steps: readonly { id: string; label: string; count: number | null }[] };
}) {
  const counted = recent.steps.filter((s) => s.count !== null);
  return (
    <section className="mt-8 max-w-3xl" aria-labelledby="recent-h">
      <h2 id="recent-h" className="font-heading text-2xl font-bold sm:text-3xl">
        Approvals reported this week
      </h2>{" "}
      <p className="mt-2 text-base text-muted-foreground">
        {`${dayName(recent.from)} to ${dayName(recent.through)}, by the dates people added. Each count shows once ${RECENT_MIN} people report one.`}
      </p>{" "}
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
        {recent.steps.map((s) => (
          <li key={s.id} className="flex items-baseline justify-between gap-3 border-2 border-border px-4 py-3">
            <span>{s.label}</span>{" "}
            <span className={s.count === null ? "text-muted-foreground" : "font-heading text-xl font-bold tabular-nums"}>
              {s.count === null ? `Fewer than ${RECENT_MIN}` : s.count.toLocaleString("en-US")}
            </span>{" "}
          </li>
        ))}
      </ul>{" "}
      {counted.length === 0 ? (
        <p className="mt-3 text-base text-soft">Got a work permit, a travel document or a green card this week? Adding the date is how a wave shows here.</p>
      ) : null}
    </section>
  );
}

export function BoardTable({ rows }: { rows: readonly BoardRow[] }) {
  const far = Math.max(365, ...rows.flatMap((r) => r.stops.map((s) => s.day ?? 0)));
  const span = Math.ceil(far / 90) * 90;
  const at = (d: number) => `${Math.max(0, Math.min(100, (d / span) * 100))}%`;
  return (
    <ChartTips label="Shared timelines, each step by days from PERM filing" scroll="border-t-2 border-[var(--object-border)]">
      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
        <thead className="bg-sage">
          <tr>
            <th scope="col" className="px-3 py-2 font-bold">PERM filed{" "}</th>
            <th scope="col" className="px-3 py-2 font-bold">Category{" "}</th>
            <th scope="col" className="px-3 py-2 font-bold">Country{" "}</th>
            <th scope="col" className="px-3 py-2 font-bold">Route{" "}</th>
            <th scope="col" className="w-[45%] px-3 py-2 font-bold">
              Days from PERM filing, 0 to {span.toLocaleString("en-US")}{" "}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const shown = r.stops.filter((s) => s.day !== null && s.day >= 0);
            const words = shown.map((s) => `${STOPS.find((x) => x.id === s.id)?.short ?? s.id} day ${s.day}`).join(", ");
            return (
              <tr key={`${r.filedMonth}-${i}`} className="border-t-2 border-border/40 align-middle">
                <td className="px-3 py-3 tabular-nums">
                  {r.filedMonth ? monthName(r.filedMonth) : "Not found at DOL"}
                  {r.permVerified ? null : (
                    <span className="block text-muted-foreground">PERM dates not checked yet</span>
                  )}{" "}
                </td>
                <td className="px-3 py-3">{label(CATEGORIES, r.category) ?? ""}{" "}</td>
                <td className="px-3 py-3">{label(COUNTRIES, r.country) ?? ""}{" "}</td>
                <td className="px-3 py-3">
                  {r.route ? (label(ROUTES, r.route) ?? "").replace(/ \(.*\)$/, "") : ""}{" "}
                  {r.premium ? <span className="block text-muted-foreground">premium I-140</span> : null}{" "}
                  {r.applicant === "dependent" ? <span className="block text-muted-foreground">a dependent&apos;s case</span> : null}{" "}
                  {r.interview === "waived" ? <span className="block text-muted-foreground">interview waived</span> : null}{" "}
                  {r.contacts ? <span className="block text-muted-foreground">{`${contactsText(r.contacts)} `}</span> : null}{" "}
                  {/* Optional: a backend older than Nov 18 2026 sends no H-4. */}
                  {r.h4 ? <span className="block text-muted-foreground">{`${h4Text(r.h4)} `}</span> : null}{" "}
                  {/* Optional: a backend older than Nov 11 2026 sends no office. */}
                  {r.office && officeByCode(r.office) ? (
                    <span className="block text-muted-foreground">{`I-485 at ${officeByCode(r.office)!.name}`}</span>
                  ) : null}{" "}
                  {/* Optional: a backend older than Nov 17 2026 sends no center. */}
                  {r.center && officeByCode(r.center) ? (
                    <span className="block text-muted-foreground">{`Taken in at the ${officeByCode(r.center)!.name}`}</span>
                  ) : null}{" "}
                </td>
                <td className="px-3 py-3">
                  <div className="relative h-5" role="img" aria-label={words || "No dated steps yet"}>
                    <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-chart-sage" aria-hidden="true" />
                    {shown.map((s) => (
                      <span
                        key={s.id}
                        data-tip={`${STOPS.find((x) => x.id === s.id)?.short ?? s.id}\nDay ${(s.day as number).toLocaleString("en-US")} from PERM filing${s.month ? `\n${monthName(s.month)}` : ""}${r.filedMonth ? `\nPERM filed ${monthName(r.filedMonth)}` : ""}`}
                        className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 border-input border", DOT[s.id], shape(s.id))}
                        style={{ left: at(s.day as number) }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  {/* Optional: a backend older than Nov 18 2026 sends only the first RFE. */}
                  {(r.rfes?.length ? r.rfes : r.rfe ? [r.rfe] : []).map((e, j) => (
                    <span key={`${e.form}-${j}`} className="mt-1 block text-muted-foreground">
                      {`RFE on the ${e.form === "i140" ? "I-140" : "I-485"}${e.outcome === "approved" ? ", approved after it" : e.outcome === "denied" ? ", denied" : ""} `}
                    </span>
                  ))}{" "}
                  {r.updates ? <span className="mt-1 block text-muted-foreground">{`${updatesText(r.updates, "PERM filing")} `}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ChartTips>
  );
}

/** "Account updates: 2 (IAF, FTA0), the newest on day 124 from the I-485 filing": a row's updates, or nothing. */
export function updatesText(u: UpdatesSummary | null | undefined, from = "the I-485 filing"): string {
  if (!u || u.count === 0) return "";
  const codes = u.codes.length > 0 ? ` (${u.codes.join(", ")})` : "";
  const when = u.lastDay !== null ? `, the newest on day ${u.lastDay.toLocaleString("en-US")} from ${from}` : "";
  return `Account updates: ${u.count}${codes}${when}`;
}

/**
 * What people saw in their USCIS accounts: how many timelines report each code. The query prints a code only once
 * METRIC_MIN_N timelines report it. Blue, the colour for information: a count is never a pick or an action.
 */
export function AccountCodes({
  codes,
  where,
  className,
}: {
  codes: readonly { code: string; timelines: number; listed: boolean }[];
  /** "shared timelines", "timelines from the Hartford office": whose reports these are. */
  where: string;
  className?: string;
}) {
  if (codes.length === 0) return null;
  const most = Math.max(...codes.map((c) => c.timelines), 1);
  return (
    <figure className={cn("m-0 max-w-3xl", className)}>
      <figcaption>
        <span className="block text-base font-semibold">What people saw in their USCIS accounts</span>{" "}
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
          How many {where} report each code. A code shows here once {METRIC_MIN_N} timelines report it, and a code is never
          a decision.{" "}
          <Link href="/guides/uscis-silent-updates" className="link">
            What each code is known to mean
          </Link>
        </span>
      </figcaption>{" "}
      <ChartTips label="Account codes people reported" className="mt-3">
        <ul className="grid grid-cols-1 gap-2">
          {codes.map((c) => (
            <Fragment key={c.code}>
              {" "}
              <li
                data-tip={`${c.code}\n${c.timelines.toLocaleString("en-US")} timelines report it${c.listed ? "" : "\nTyped in by the people who reported it"}`}
                className="grid grid-cols-[5rem_1fr_auto] items-center gap-3 text-sm"
              >
                <span className="font-mono font-bold">{c.code}</span>{" "}
                <span className="h-4 border border-input bg-background" aria-hidden="true">
                  <span className="block h-full border-r-2 border-data-info-ink bg-chart-blue" style={{ width: `${(c.timelines / most) * 100}%` }} />
                </span>{" "}
                <span className="tabular-nums">{c.timelines.toLocaleString("en-US")}</span>
              </li>
            </Fragment>
          ))}
        </ul>
      </ChartTips>
    </figure>
  );
}

/**
 * After a third FTA0: both halves, the cards and the still waiting. Counts always; a median only from METRIC_MIN_N.
 * What these people saw, never a forecast for anyone else's case.
 */
/** A row's contacts in words: "2 contacts: an Emma chat, a congressional inquiry". */
/** A row's H-4 papers in words, durations only: "H-4 extension in 181 days, H-4 work permit in 162 days, filed with the I-539". */
export function h4Text(h: { extensionDays: number | null; workPermitDays: number | null; together: boolean }): string {
  return [
    h.extensionDays !== null ? `H-4 extension in ${days(h.extensionDays)}` : null,
    h.workPermitDays !== null ? `H-4 work permit in ${days(h.workPermitDays)}${h.together ? ", filed with the I-539" : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function contactsText(c: { count: number; kinds: readonly string[] }): string {
  const names = c.kinds.map((k) => CONTACT_KINDS.find((x) => x.id === k)?.short ?? k);
  return `${c.count} ${c.count === 1 ? "contact" : "contacts"}: ${names.join(", ")}`;
}

type Outcome = { kind: string; label: string; reported: number; withCard: number; medianToCard: number | null; waiting: number };

/**
 * After each kind of contact, how many got a green card and how soon. Only kinds someone reported show. A median
 * needs METRIC_MIN_N cards. It reports what these people saw, never what a contact will do.
 */
export function ContactOutcomes({ outcomes }: { outcomes: readonly Outcome[] }) {
  const shown = outcomes.filter((o) => o.reported > 0);
  if (shown.length === 0) return null;
  const n = (x: number, one: string, many: string) => `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;
  return (
    <div className="max-w-3xl border-l-4 border-data-info-ink bg-tint px-4 py-3">
      <p className="text-base font-semibold">After a contact</p>{" "}
      <ul className="mt-1 space-y-1 text-base leading-relaxed">
        {shown.map((o) => (
          <li key={o.kind}>
            {`After ${/^[aeiou]/i.test(o.label) ? "an" : "a"} ${o.label}: ${n(o.reported, "timeline", "timelines")}, ${o.withCard === 0 ? "none with a green card yet" : `${o.withCard.toLocaleString("en-US")} with a green card${o.medianToCard !== null ? `, a median of ${days(o.medianToCard)} later` : ""}`}${o.waiting ? `, ${o.waiting.toLocaleString("en-US")} still waiting` : ""}.`}{" "}
          </li>
        ))}
      </ul>{" "}
      <p className="mt-1 text-sm text-muted-foreground">
        Self-reported. A median shows from {METRIC_MIN_N} green cards. It says what these people saw, not what a contact
        will do for a case.
      </p>
    </div>
  );
}

/** Of the green cards that say how the interview went, how many came without one, once METRIC_MIN_N say. */
export function InterviewLine({ r }: { r: { answered: number; waived: number } | null }) {
  if (!r || r.answered < METRIC_MIN_N) return null;
  return (
    <p className="max-w-3xl text-base leading-relaxed">
      {`Of the ${r.answered.toLocaleString("en-US")} green cards whose timelines say how the interview went, ${r.waived.toLocaleString("en-US")} came without one.`}
    </p>
  );
}

export function ThirdFta0Line({ r }: { r: { reported: number; withCard: number; medianToCard: number | null; waiting: number; medianWaiting: number | null } }) {
  if (r.reported === 0) return null;
  const n = (x: number, one: string, many: string) => `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;
  const card =
    r.withCard === 0
      ? "none has a green card after it yet."
      : `${n(r.withCard, "has", "have")} a green card${r.medianToCard !== null ? `, a median of ${days(r.medianToCard)} after it` : ""}.`;
  const wait =
    r.waiting === 0
      ? ""
      : ` ${n(r.waiting, "is", "are")} still waiting${r.medianWaiting !== null ? `, a median of ${days(r.medianWaiting)} so far` : ""}.`;
  return (
    <div className="max-w-3xl border-l-4 border-data-info-ink bg-tint px-4 py-3">
      <p className="text-base font-semibold">After a third FTA0</p>{" "}
      <p className="mt-1 text-base leading-relaxed">
        {`Of the ${n(r.reported, "timeline", "timelines")} reporting a third FTA0 on the I-485, ${card}${wait}`}
      </p>{" "}
      <p className="mt-1 text-sm text-muted-foreground">
        Self-reported, and counted only from timelines updated in the last 60 days for the still waiting. A median shows
        from {METRIC_MIN_N} timelines. It says what these people saw, not what will happen to a case.
      </p>
    </div>
  );
}

export function RfeBars({ rfe }: { rfe: RfeSummary }) {
  if (rfe.total === 0) {
    return <p className="text-base text-muted-foreground">Nobody has reported an RFE yet.</p>;
  }
  const most = Math.max(...rfe.byReason.map((r) => r.count), 1);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr] [&>*]:min-w-0">
      <ChartTips label="RFEs reported, by reason">
      <ul className="grid grid-cols-1 gap-2">
        {rfe.byReason.map((r) => (
          <Fragment key={r.id}>
            {" "}
            <li
              data-tip={`${r.label}\n${r.count.toLocaleString("en-US")} of ${rfe.total.toLocaleString("en-US")} RFEs reported`}
              className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm"
            >
              <span className="font-bold">{r.label}</span>{" "}
              <span className="h-4 border-input bg-background border" aria-hidden="true">
                <span className="block h-full bg-primary" style={{ width: `${(r.count / most) * 100}%` }} />
              </span>{" "}
              <span className="tabular-nums">{r.count}</span>
            </li>
          </Fragment>
        ))}
      </ul>
      </ChartTips>{" "}
      <dl className="grid grid-cols-1 gap-2 self-start bg-soft-wait p-4 text-sm border-2 border-border">
        {rfe.byForm.map((f) => (
          <Fragment key={f.id}>
            {" "}
            <div className="flex justify-between gap-4">
              <dt>RFEs on the {f.label}</dt>{" "}
              <dd className="font-bold tabular-nums">{f.count}</dd>
            </div>
          </Fragment>
        ))}{" "}
        {rfe.byOutcome.map((o) => (
          <Fragment key={o.id}>
            {" "}
            <div className="flex justify-between gap-4 border-t border-border/40 pt-2">
              <dt>{o.label}</dt>{" "}
              <dd className="font-bold tabular-nums">{o.count}</dd>
            </div>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * Where the people who shared a timeline are now: a bar per step, then a
 * table of category and country lines. A cell under the minimum reads "under
 * 5" rather than a count, and a line too small to show is counted in words.
 */
/** The shape both counts share: the shared timelines' (Convex) and every reported case's (the summary). */
type WaitingCounts = Pick<WaitingView, "unlisted"> & {
  byStage: readonly { id: string; label: string; count: number }[];
  lines: readonly { category: string; country: string; counts: readonly (number | null)[]; total: number }[];
};

export function WhoIsWaiting({
  waiting,
  total,
  noun = ["timeline", "timelines"],
}: {
  waiting: WaitingCounts;
  total: number;
  /** What one count is: a shared timeline, or a person who reported a case. */
  noun?: readonly [string, string];
}) {
  const [one, many] = noun;
  const most = Math.max(...waiting.byStage.map((s) => s.count), 1);
  return (
    <div className="grid grid-cols-1 gap-6 [&>*]:min-w-0">
      <ChartTips label={`${many[0]!.toUpperCase()}${many.slice(1)} by the step they've reached`}>
        <ul className="grid grid-cols-1 gap-2">
          {waiting.byStage.map((s) => (
            <Fragment key={s.id}>
              {" "}
              <li
                data-tip={`${s.label}\n${s.count.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${many}`}
                className="grid grid-cols-[minmax(0,15rem)_1fr_auto] items-center gap-3 text-sm"
              >
                <span className="font-bold">{s.label}</span>{" "}
                <span className="h-4 border-input bg-background border" aria-hidden="true">
                  <span className="block h-full bg-primary" style={{ width: `${(s.count / most) * 100}%` }} />
                </span>{" "}
                <span className="tabular-nums">{s.count.toLocaleString("en-US")}</span>
              </li>
            </Fragment>
          ))}
        </ul>
      </ChartTips>{" "}
      {waiting.lines.length ? (
        <ScrollBox label={`${many[0]!.toUpperCase()}${many.slice(1)} by category, country and step`} className="border-t-2 border-[var(--object-border)]">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">{`${many[0]!.toUpperCase()}${many.slice(1)} by category, country and step`}</caption>
            <thead>
              <tr className="border-b-2 border-border bg-sage text-left">
                <th scope="col" className="p-2 font-bold">
                  Category and country{" "}
                </th>
                {waiting.byStage.map((s) => (
                  <th key={s.id} scope="col" className="p-2 text-right font-bold">
                    {`${s.label} `}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {waiting.lines.map((l) => (
                <tr key={`${l.category}|${l.country}`} className="border-b border-border/50">
                  <th scope="row" className="p-2 text-left font-bold">
                    {`${l.category}, ${l.country} `}
                  </th>
                  {l.counts.map((c, i) => (
                    <td key={waiting.byStage[i]?.id ?? i} className="p-2 text-right tabular-nums">
                      {c === null ? "under 5 " : `${c.toLocaleString("en-US")} `}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      ) : null}{" "}
      {waiting.unlisted ? (
        <p className="text-sm text-muted-foreground">
          {`${waiting.unlisted.toLocaleString("en-US")} more ${waiting.unlisted === 1 ? `${one} sits` : `${many} sit`} on a category and country with fewer than 5 ${many}, or gave neither, so ${waiting.unlisted === 1 ? "it isn't" : "they aren't"} listed by line.`}
        </p>
      ) : null}
    </div>
  );
}
