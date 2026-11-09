"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";

import { DateInput } from "@/components/forms/DateInput";
import { DayCaseRow } from "@/components/queue/DayCaseRow";
import { DidYouMean } from "@/components/search/DidYouMean";
import { RequestFailed } from "@/components/tools/RequestFailed";
import { choiceVariants } from "@/components/ui/choice";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/useDebounce";
import { usePublicQuery } from "@/hooks/usePublicQuery";
import { FINDER_SHOWN, NEARBY_DAYS, enoughTyped, findOnDay, nearbyDays } from "@/lib/caseFinder";
import { FILINGS_FROM, type DayCase } from "@/lib/filingDay";
import { PROGRAM_NAMES, dayHref, shiftDay, type FilingProgram } from "@/lib/filingsByDay";
import { formatInt } from "@/lib/format";
import { trackFinder } from "@/lib/funnelEvents";
import { cn } from "@/lib/utils";
import { ISO_DATE_REGEX } from "@convex/lib/dateValidation";
import { longDate } from "@convex/lib/months";
import { easternDay } from "@convex/lib/time";

/**
 * A case found without its number: an employer's name and the day it was filed, read against
 * that day's list from DOL's live record and its published files (/api/filed-on). Many people
 * waiting never saw the receipt because their lawyer filed it, and they do know who filed and
 * roughly when.
 *
 * The day's list is asked for once and matched in the browser as the name is typed, so typing
 * costs no requests. When nothing on the day fits, it offers the close spellings that did file
 * that day, then the days either side on which a name starting the same way filed, and always
 * the full search. A failed read says so: it never reads as "no such case".
 *
 * Two shapes. With `day` given, the host owns the date (an estimator's date field) and this is
 * one more field of its form. Without it, the finder asks for the day itself.
 */

const ALL_PROGRAMS: readonly FilingProgram[] = ["perm", "pwd", "lca", "seasonal"];
const KIND_LABEL: Record<FilingProgram, string> = {
  perm: "PERM case",
  pwd: "Wage request",
  lca: "H-1B LCA",
  seasonal: "H-2A, H-2B or CW-1",
};
/** Nearby days offered when the asked day holds no match. */
const NEARBY_SHOWN = 6;
/** How long the name rests before the nearby days are asked for. */
const NEARBY_WAIT_MS = 400;

type DayList = { cases: DayCase[]; capped: boolean };
type NearbySearch = { rows?: { filedOn: string | null }[] };

export interface CaseFinderProps {
  /** Which filings it looks through. One kind leaves the chooser off. */
  programs?: readonly FilingProgram[];
  /** The host's filing day, `YYYY-MM-DD` or empty. Left out, the finder asks for the day itself. */
  day?: string;
  /** A nearby day the reader picked, for a host that owns the date. */
  onDay?: (day: string) => void;
  /** A name to open with: the employer whose page the finder is on. */
  employer?: string;
  /** Which page it's on, for the funnel's event. */
  source: string;
  /** The heading over a finder that stands apart. Left out, it reads as one more field of its host's form. */
  heading?: string;
  className?: string;
}

export function CaseFinder({ programs = ALL_PROGRAMS, day: hostDay, onDay, employer = "", source, heading, className }: CaseFinderProps) {
  const nameId = useId();
  const dayId = useId();
  const jobId = useId();
  const headingId = useId();
  const [typed, setTyped] = useState(employer);
  const [job, setJob] = useState("");
  const [ownDay, setOwnDay] = useState("");
  const [picked, setPicked] = useState<FilingProgram | null>(null);
  const [allFor, setAllFor] = useState("");
  // Read once, so a list open across midnight keeps one idea of today.
  const [today] = useState(() => easternDay());

  const program: FilingProgram = picked && programs.includes(picked) ? picked : (programs[0] ?? "perm");
  const hosted = hostDay !== undefined;
  const day = hosted ? hostDay : ownDay;
  const name = typed.trim();
  const isDay = ISO_DATE_REGEX.test(day);
  const tooEarly = isDay && day < FILINGS_FROM;
  const notYet = isDay && day > today;
  const ready = isDay && !tooEarly && !notYet && enoughTyped(name);

  // The address carries the day and the kind only, so typing never asks again.
  const list = usePublicQuery<DayList>(ready ? `/api/filed-on?day=${day}&program=${program}` : "skip");
  const answer = useMemo(() => (list.data ? findOnDay(list.data.cases, name, job) : null), [list.data, name, job]);
  // No case of that employer's on the day. A job title that fits none of its cases is a different answer.
  const noMatch = ready && answer !== null && answer.ofEmployer === 0;
  // A big employer files dozens a day: past the first few, the job title is what tells them apart.
  const offerJob = answer !== null && (answer.ofEmployer > FINDER_SHOWN || job !== "");

  const rested = useDebounce(name, NEARBY_WAIT_MS);
  const near = usePublicQuery<NearbySearch>(
    noMatch && rested === name
      ? `/api/case-search?q=${encodeURIComponent(name)}&programs=${program}&from=${shiftDay(day, -NEARBY_DAYS)}&to=${shiftDay(day, NEARBY_DAYS)}&limit=200`
      : "skip",
  );
  const nearby = noMatch && near.data?.rows ? nearbyDays(near.data.rows, day).slice(0, NEARBY_SHOWN) : [];

  // One event an answer, once the name has rested: how it ended, never what was typed.
  const told = useRef("");
  const outcome = answer === null ? null : answer.ofEmployer > 0 ? "cases" : answer.close.length > 0 ? "close-names" : "none";
  useEffect(() => {
    if (!ready || outcome === null || rested !== name) return;
    const key = `${day}|${program}|${name.toLowerCase()}`;
    if (told.current === key) return;
    told.current = key;
    trackFinder(source, program, outcome);
  }, [ready, outcome, rested, name, day, program, source]);

  const key = `${day}|${program}|${name.toLowerCase()}|${job.trim().toLowerCase()}`;
  const shown = answer ? (allFor === key ? answer.matches : answer.matches.slice(0, FINDER_SHOWN)) : [];
  const names = PROGRAM_NAMES[program];
  const dayLabel = longDate(day) ?? day;
  const pickDay = (d: string) => (hosted ? onDay?.(d) : setOwnDay(d));
  const searchHref = `/case-search?q=${encodeURIComponent(name)}`;
  const wholeDayHref = `${dayHref(day, program)}${program === "perm" ? "?" : "&"}q=${encodeURIComponent(name)}`;

  return (
    <section
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : "Find your case without its number"}
      className={cn(heading && "border-2 border-border bg-card p-4 sm:p-5", className)}
    >
      {heading ? (
        <h3 id={headingId} className="font-heading text-lg font-bold leading-tight">
          {heading}
        </h3>
      ) : null}{" "}
      {programs.length > 1 ? (
        <div role="group" aria-label="Kind of filing" className={cn("flex flex-wrap gap-2", heading && "mt-3")}>
          {programs.map((p) => (
            <Fragment key={p}>
              <button type="button" aria-pressed={program === p} onClick={() => setPicked(p)} className={choiceVariants({ on: program === p })}>
                {KIND_LABEL[p]}
              </button>{" "}
            </Fragment>
          ))}
        </div>
      ) : null}{" "}
      {/* `grid-cols-1` and `[&>*]:min-w-0`: a date control in a grid sizes from its content on iOS without them. */}
      <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3 [&>*]:min-w-0", !hosted && "sm:grid-cols-[minmax(0,1fr)_12rem]", (heading || programs.length > 1) && "mt-4")}>
        <div>
          <Label htmlFor={nameId} className="text-sm font-bold">
            {hosted ? "No number? Type your employer’s name" : "Employer’s name"}
          </Label>{" "}
          <input
            id={nameId}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="organization"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={120}
            className={cn("mt-2 block min-h-11 w-full min-w-0 border-2 border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2", hosted && "sm:max-w-sm")}
          />
        </div>{" "}
        {hosted ? null : (
          <div>
            <Label htmlFor={dayId} className="text-sm font-bold">
              Date it was filed
            </Label>{" "}
            <DateInput
              id={dayId}
              value={ownDay}
              maxDate={today}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || ISO_DATE_REGEX.test(v)) setOwnDay(v);
              }}
              className="mt-2"
            />
          </div>
        )}
      </div>{" "}
      {/* Only the one-line answers are announced: a live region around the list would read every row on each key. */}
      <div className="text-base leading-relaxed">
        {!enoughTyped(name) ? null : !isDay ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {hosted ? "Pick the filing date above and that day’s cases from this employer list here." : "Add the filing date and that day’s cases from this employer list here."}
          </p>
        ) : tooEarly ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            The day lists start on {longDate(FILINGS_FROM)}.{" "}
            <Link href={searchHref} className="link">
              Search every filing by this employer
            </Link>
            .
          </p>
        ) : notYet ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {dayLabel} hasn&apos;t come yet, so nothing was filed on it.
          </p>
        ) : list.failed ? (
          <RequestFailed className="mt-3 border-2 border-border bg-tint p-4" what={`The ${names.plural} filed on ${dayLabel}`} failure={list.failure} onRetry={list.retry} />
        ) : !answer ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Reading the {names.plural} filed on {dayLabel}.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {answer.day.filed === 0
                ? `DOL’s record holds no ${names.plural} filed on ${dayLabel}.`
                : `DOL’s record holds ${formatInt(answer.day.filed)} ${answer.day.filed === 1 ? names.one : names.plural} filed on ${dayLabel}: ${formatInt(answer.day.decided)} decided, ${formatInt(answer.day.waiting)} still waiting.`}{" "}
              {answer.day.filed === 0
                ? null
                : answer.ofEmployer > 0
                  ? `${formatInt(answer.ofEmployer)} ${answer.ofEmployer === 1 ? "is" : "are"} from an employer matching “${name}”${job.trim() ? `, ${formatInt(answer.matches.length)} with “${job.trim()}” in the job title` : ""}.`
                  : `None is from an employer matching “${name}”.`}
            </p>{" "}
            {offerJob ? (
              <div className="mt-3">
                <Label htmlFor={jobId} className="text-sm font-bold">
                  Job title, to narrow these
                </Label>{" "}
                <input
                  id={jobId}
                  type="text"
                  value={job}
                  onChange={(e) => setJob(e.target.value)}
                  autoComplete="organization-title"
                  spellCheck={false}
                  enterKeyHint="search"
                  maxLength={80}
                  className="mt-2 block min-h-11 w-full min-w-0 border-2 border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 sm:max-w-sm"
                />
              </div>
            ) : null}{" "}
            {shown.length > 0 ? (
              <ul className="mt-2 divide-y-2 divide-border border-y-2 border-border">
                {shown.map((c) => (
                  <DayCaseRow key={c.caseNumber} c={c} />
                ))}
              </ul>
            ) : null}{" "}
            {answer.matches.length > shown.length ? (
              <button type="button" onClick={() => setAllFor(key)} className={cn(choiceVariants({ on: false }), "mt-3")}>
                Show all {formatInt(answer.matches.length)}
              </button>
            ) : null}{" "}
            {list.data?.capped ? (
              <p className="mt-3 text-sm text-muted-foreground">
                This day holds more filings than its list carries, so a case can be missing here.{" "}
                <Link href={searchHref} className="link">
                  The full search has every one
                </Link>
                .
              </p>
            ) : null}{" "}
            {noMatch ? (
              <>
                <DidYouMean
                  className="mt-4"
                  label="Filed that day under a close name"
                  suggestions={answer.close.map((n) => ({
                    label: n.employer,
                    note: `${formatInt(n.cases)} that day`,
                    onPick: () => setTyped(n.employer),
                  }))}
                />{" "}
                <DidYouMean
                  className="mt-4"
                  label={`Names starting “${name}” filed on these days nearby`}
                  loading={near.data === undefined && !near.failed}
                  loadingLabel="Checking the days either side…"
                  suggestions={nearby.map((n) => ({
                    label: longDate(n.day) ?? n.day,
                    note: `${formatInt(n.cases)} ${n.cases === 1 ? "filing" : "filings"}`,
                    ...(hosted && !onDay ? { href: dayHref(n.day, program) } : { onPick: () => pickDay(n.day) }),
                  }))}
                />
              </>
            ) : null}{" "}
            <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href={searchHref} className="link inline-flex min-h-11 items-center">
                Search every filing by this employer
              </Link>{" "}
              {answer.day.filed > 0 ? (
                <Link href={wholeDayHref} className="link inline-flex min-h-11 items-center">
                  See everything filed that day
                </Link>
              ) : null}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
