"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";

import { DateInput } from "@/components/forms/DateInput";
import { DayCaseRow } from "@/components/queue/DayCaseRow";
import { DidYouMean } from "@/components/search/DidYouMean";
import { RequestFailed } from "@/components/tools/RequestFailed";
import { choiceVariants } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
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
  /** The kind the chooser opens on: a wage-request page's finder starts on wage requests. */
  program?: FilingProgram;
  /** The host's filing day, `YYYY-MM-DD` or empty. Left out, the finder asks for the day itself. */
  day?: string;
  /** A nearby day the reader picked, for a host that owns the date. */
  onDay?: (day: string) => void;
  /** A name to open with: the employer whose page the finder is on. */
  employer?: string;
  /** A host that takes a case from the list (the signed-in form fills its number in): each row gets one button. */
  onPick?: (c: DayCase) => void;
  /** That button's words. */
  pickLabel?: string;
  /** Which page it's on, for the funnel's event. */
  source: string;
  /** The title over a finder that stands apart, which names its region. Left out, it reads as one more field of its host's form. */
  heading?: string;
  /**
   * A titled finder that opens inside a box draws no box of its own: a card in a card is two frames around one
   * thing. It sits flat on its host's ground.
   */
  flat?: boolean;
  /**
   * Opened by a press: the cursor goes to the first field still empty. A finder can be drawn a screen away from
   * the link that opened it (under a header, at the page's width), and the cursor is where the eye lands.
   */
  autoFocus?: boolean;
  className?: string;
}

export function CaseFinder({ programs = ALL_PROGRAMS, program: opensOn, day: hostDay, onDay, employer = "", onPick, pickLabel = "Use this case", source, heading, flat = false, autoFocus = false, className }: CaseFinderProps) {
  const nameId = useId();
  const dayId = useId();
  const jobId = useId();
  const headingId = useId();
  const hintId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(employer);
  const [job, setJob] = useState("");
  const [ownDay, setOwnDay] = useState("");
  const [picked, setPicked] = useState<FilingProgram | null>(opensOn ?? null);
  const [allFor, setAllFor] = useState("");
  // Read once, so a list open across midnight keeps one idea of today.
  const [today] = useState(() => easternDay());

  // On an employer's own page the name comes filled in, so the day is the first thing still to give.
  const opensOnDay = employer.trim() !== "" && hostDay === undefined;
  useEffect(() => {
    if (!autoFocus) return;
    (opensOnDay ? document.getElementById(dayId) : nameRef.current)?.focus();
  }, [autoFocus, opensOnDay, dayId]);

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
    // Once a day, kind and outcome: a name typed in three sittings is one answer of that kind.
    const answered = `${day}|${program}|${outcome}`;
    if (told.current === answered) return;
    told.current = answered;
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
      className={cn("@container text-base", heading && !flat && "border-2 border-border bg-card p-5", className)}
    >
      {/* A line, never a heading: the finder opens under a box that can sit below an h1, in a card or in a
          footer, and a heading here would skip a level on some of them. The section is named by it instead. */}
      {heading ? (
        <p id={headingId} className="font-heading text-lg font-bold leading-tight">
          {heading}
        </p>
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
      {/* `grid-cols-1` and `[&>*]:min-w-0`: a date control in a grid sizes from its content on iOS without them.
          The two fields share a row by the finder's own width, never the screen's: in a list page's side box the
          name field was left a few characters wide. */}
      <div className={cn("grid grid-cols-1 gap-x-4 gap-y-3 [&>*]:min-w-0", !hosted && "@md:grid-cols-[minmax(0,26rem)_12rem] @md:justify-start", (heading || programs.length > 1) && "mt-4")}>
        <div>
          <Label htmlFor={nameId} className="text-sm font-bold">
            {hosted ? "No number? Type your employer’s name" : "Employer’s name"}
          </Label>{" "}
          {/* The site's own text field, on the date control's ground beside it: the pair reads as one form. */}
          <Input
            id={nameId}
            ref={nameRef}
            aria-describedby={!hosted && !enoughTyped(name) ? hintId : undefined}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="organization"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={120}
            className={cn("mt-2 bg-background", hosted && "sm:max-w-sm")}
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
        {!enoughTyped(name) ? (
          // What the two boxes are for, until the first is used. A host that owns the date says it in its own label.
          hosted ? null : (
            <p id={hintId} className="mt-3 text-sm text-muted-foreground">
              Type the employer&apos;s name and the day it was filed. Its filings from that day show here.
            </p>
          )
        ) : !isDay ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {hosted ? "Pick the filing date above to see this employer’s cases from that day." : "Add the filing date to see this employer’s cases from that day."}
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
                <Input
                  id={jobId}
                  type="text"
                  value={job}
                  onChange={(e) => setJob(e.target.value)}
                  autoComplete="organization-title"
                  spellCheck={false}
                  enterKeyHint="search"
                  maxLength={80}
                  className="mt-2 bg-background sm:max-w-sm"
                />
              </div>
            ) : null}{" "}
            {shown.length > 0 ? (
              <ul className="mt-2 divide-y-2 divide-border border-y-2 border-border">
                {shown.map((c) => (
                  <DayCaseRow
                    key={c.caseNumber}
                    c={c}
                    action={
                      onPick ? (
                        <button type="button" onClick={() => onPick(c)} aria-label={`${pickLabel}: ${c.caseNumber}`} className={choiceVariants({ on: false })}>
                          {pickLabel}
                        </button>
                      ) : undefined
                    }
                  />
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
