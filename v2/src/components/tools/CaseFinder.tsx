"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useRef, useState } from "react";

import { DateInput } from "@/components/forms/DateInput";
import { DayCaseRow } from "@/components/queue/DayCaseRow";
import { DidYouMean } from "@/components/search/DidYouMean";
import { RequestFailed } from "@/components/tools/RequestFailed";
import { choiceVariants } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebounce } from "@/hooks/useDebounce";
import { usePublicQuery } from "@/hooks/usePublicQuery";
import { FINDER_SHOWN, NEARBY_DAYS, askedAnything, boxFilled, finderWindow, nearbyDays, type CloseName, type FoundCase } from "@/lib/caseFinder";
import { FILINGS_FROM } from "@/lib/filingDay";
import { PROGRAM_NAMES, dayHref, shiftDay, type FilingProgram } from "@/lib/filingsByDay";
import { formatInt } from "@/lib/format";
import { trackFinder } from "@/lib/funnelEvents";
import { cn } from "@/lib/utils";
import { ISO_DATE_REGEX } from "@convex/lib/dateValidation";
import { longDate } from "@convex/lib/months";
import { easternDay } from "@convex/lib/time";

/**
 * A case found without its number, from what a person does know: the employer's name, the job title, the law
 * firm, and the day or the days it was filed. Every box is optional and one is enough (owner, Nov 10 2026). Many
 * people waiting never saw the receipt because their lawyer filed it; they know who filed, for what job, and
 * roughly when.
 *
 * The ask goes to /api/find-case once what was typed has rested, so a name costs one request and not one a
 * letter. The rules for what counts as an ask, and for the days two dates name, are the server's own
 * (src/lib/caseFinder.ts), so the form never sends an ask the server refuses. When no employer fits, it offers
 * the close spellings that did file in those days, then the days either side on which a name starting the same
 * way filed, and always the full search. A failed read says so: it never reads as "no such case".
 *
 * Two shapes. With `day` given, the host owns the date (an estimator's date field) and this is one more field of
 * its form: the employer's name, and a job title once the list is long. Without it, the finder asks for
 * everything itself.
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
/** Other firms offered beside the one a law firm's words named. */
const FIRMS_OFFERED = 4;
/** How long a typed box rests before it's asked for. */
const TYPING_WAIT_MS = 350;
/** How long the name rests before the nearby days are asked for. */
const NEARBY_WAIT_MS = 400;

/** The route's answer. A field with nothing to say is left out of it. */
interface Answer {
  /** What this answer was asked, so its words never mix with what's being typed now. */
  asked: { employer: string; title: string; firm: string };
  by: "window" | "index";
  window?: { from: string; to: string; assumed: boolean };
  cases: FoundCase[];
  matched: number;
  ofEmployer?: number;
  capped: boolean;
  period?: { filed: number; decided: number; waiting: number };
  close: CloseName[];
  firm?: { name: string; slug: string; alternatives: { name: string; slug: string }[] };
  firmUnknown: boolean;
  decidedOnly: boolean;
}
type NearbySearch = { rows?: { filedOn: string | null }[] };

export interface CaseFinderProps {
  /** Which filings it looks through. One kind leaves the chooser off. */
  programs?: readonly FilingProgram[];
  /** The kind the chooser opens on: a wage-request page's finder starts on wage requests. */
  program?: FilingProgram;
  /** The host's filing day, `YYYY-MM-DD` or empty. Left out, the finder asks for the days itself. */
  day?: string;
  /** A nearby day the reader picked, for a host that owns the date. */
  onDay?: (day: string) => void;
  /** A name to open with: the employer whose page the finder is on. */
  employer?: string;
  /** A host that takes a case from the list (the signed-in form fills its number in): each row gets one button. */
  onPick?: (c: FoundCase) => void;
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

/** The days a window names, in words: "on January 5, 2026", or "from January 5 to January 31, 2026". */
function spanWords(from: string, to: string): string {
  if (from === to) return `on ${longDate(from) ?? from}`;
  return `from ${longDate(from) ?? from} to ${longDate(to) ?? to}`;
}

export function CaseFinder({ programs = ALL_PROGRAMS, program: opensOn, day: hostDay, onDay, employer = "", onPick, pickLabel = "Use this case", source, heading, flat = false, autoFocus = false, className }: CaseFinderProps) {
  const nameId = useId();
  const jobId = useId();
  const firmId = useId();
  const fromId = useId();
  const toId = useId();
  const headingId = useId();
  const hintId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(employer);
  const [job, setJob] = useState("");
  const [firmTyped, setFirmTyped] = useState("");
  const [ownFrom, setOwnFrom] = useState("");
  const [ownTo, setOwnTo] = useState("");
  const [picked, setPicked] = useState<FilingProgram | null>(opensOn ?? null);
  const [allFor, setAllFor] = useState("");
  // Read once, so a list open across midnight keeps one idea of today.
  const [today] = useState(() => easternDay());

  const hosted = hostDay !== undefined;
  // On an employer's own page the name comes filled in, so the first date is the first thing still to give.
  const opensOnDay = employer.trim() !== "" && !hosted;
  useEffect(() => {
    if (!autoFocus) return;
    (opensOnDay ? document.getElementById(fromId) : nameRef.current)?.focus();
  }, [autoFocus, opensOnDay, fromId]);

  const program: FilingProgram = picked && programs.includes(picked) ? picked : (programs[0] ?? "perm");
  const name = typed.trim();
  const title = job.trim();
  const firm = hosted ? "" : firmTyped.trim();
  const from = hosted ? hostDay : ownFrom;
  const to = hosted ? hostDay : ownTo;

  // What a person sees is decided by what's in the boxes now; what's asked for waits until the typing rests.
  const restedName = useDebounce(name, TYPING_WAIT_MS);
  const restedTitle = useDebounce(title, TYPING_WAIT_MS);
  const restedFirm = useDebounce(firm, TYPING_WAIT_MS);
  const settled = restedName === name && restedTitle === title && restedFirm === firm;

  const w = finderWindow({ from, to }, today, FILINGS_FROM);
  const named = boxFilled(name) || boxFilled(firm);
  // A host's own date is the one day read, so its finder waits for the name; standing apart, any one thing will do.
  const asked = hosted ? boxFilled(name) : askedAnything({ employer: name, title, firm, from, to });
  const hostNeedsDay = hosted && !ISO_DATE_REGEX.test(hostDay);
  const refused: null | "too-early" | "not-yet" | "too-long" = w.ok || w.why === "bad-date" ? null : w.why === "too-long" ? (named ? null : "too-long") : w.why;
  const ready = asked && !hostNeedsDay && refused === null && (w.ok || w.why === "too-long");

  const params = new URLSearchParams({ program });
  if (boxFilled(restedName)) params.set("employer", restedName);
  if (boxFilled(restedTitle)) params.set("title", restedTitle);
  if (boxFilled(restedFirm)) params.set("firm", restedFirm);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  // The rested boxes must still make an ask: a name cleared a moment ago can't ride along as one.
  const restedAsks = hosted ? boxFilled(restedName) : askedAnything({ employer: restedName, title: restedTitle, firm: restedFirm, from, to });
  const found = usePublicQuery<Answer>(ready && restedAsks ? `/api/find-case?${params}` : "skip");
  // The last answer stays up, dimmed, while the next is read: a list that collapses on every letter can't be read.
  const answer = found.data ?? (found.failed ? undefined : found.previous);
  const busy = ready && (found.data === undefined || !settled) && !found.failed;

  const oneDay = w.ok && !w.assumed && w.from === w.to ? w.from : null;
  const noEmployer = answer !== undefined && boxFilled(name) && answer.matched === 0 && (answer.ofEmployer ?? 0) === 0 && !answer.firmUnknown;
  // A big employer files dozens a day: past the first few, the job title is what tells them apart.
  const offerJob = hosted && answer !== undefined && ((answer.ofEmployer ?? answer.matched) > FINDER_SHOWN || job !== "");

  const restedForNearby = useDebounce(name, NEARBY_WAIT_MS);
  const near = usePublicQuery<NearbySearch>(
    ready && settled && noEmployer && oneDay && restedForNearby === name
      ? `/api/case-search?q=${encodeURIComponent(name)}&programs=${program}&from=${shiftDay(oneDay, -NEARBY_DAYS)}&to=${shiftDay(oneDay, NEARBY_DAYS)}&limit=200`
      : "skip",
  );
  const nearby = noEmployer && oneDay && near.data?.rows ? nearbyDays(near.data.rows, oneDay).slice(0, NEARBY_SHOWN) : [];

  // One event an answer, once the typing has rested: how it ended, never what was typed.
  const told = useRef("");
  const outcome = answer === undefined || found.data === undefined ? null : answer.matched > 0 ? "cases" : answer.close.length > 0 ? "close-names" : "none";
  useEffect(() => {
    if (!ready || !settled || outcome === null) return;
    // Once a window, kind and outcome: a name typed in three sittings is one answer of that kind.
    const answered = `${from}|${to}|${program}|${outcome}`;
    if (told.current === answered) return;
    told.current = answered;
    trackFinder(source, program, outcome);
  }, [ready, settled, outcome, from, to, program, source]);

  const key = `${from}|${to}|${program}|${name.toLowerCase()}|${title.toLowerCase()}|${firm.toLowerCase()}`;
  const shown = answer ? (allFor === key ? answer.cases : answer.cases.slice(0, FINDER_SHOWN)) : [];
  const names = PROGRAM_NAMES[program];
  const pickDay = (d: string) => {
    if (hosted) onDay?.(d);
    else {
      setOwnFrom(d);
      setOwnTo("");
    }
  };
  const searchHref = `/case-search?q=${encodeURIComponent(name)}`;
  const wholeDayHref = oneDay ? `${dayHref(oneDay, program)}${boxFilled(name) ? `${program === "perm" ? "?" : "&"}q=${encodeURIComponent(name)}` : ""}` : null;
  const firmLabel = program === "seasonal" ? "Law firm or agent" : "Law firm";

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
      {/* `grid-cols-1` and `[&>*]:min-w-0`: a control in a grid sizes from its content on iOS without them. The
          boxes share a row by the finder's own width, never the screen's: in a list page's side box a field was
          left a few characters wide. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-x-4 gap-y-3 [&>*]:min-w-0",
          !hosted && "@md:grid-cols-2 @3xl:grid-cols-3",
          (heading || programs.length > 1) && "mt-4",
        )}
      >
        <div>
          <Label htmlFor={nameId} className="text-sm font-bold">
            {hosted ? "No number? Type your employer’s name" : "Employer’s name"}
          </Label>{" "}
          {/* The site's own text field, on the date control's ground beside it: the boxes read as one form. */}
          <Input
            id={nameId}
            ref={nameRef}
            aria-describedby={!hosted && !asked ? hintId : undefined}
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
          <>
            <div>
              <Label htmlFor={jobId} className="text-sm font-bold">
                Job title
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
                className="mt-2 bg-background"
              />
            </div>{" "}
            <div>
              <Label htmlFor={firmId} className="text-sm font-bold">
                {firmLabel}
              </Label>{" "}
              <Input
                id={firmId}
                type="text"
                value={firmTyped}
                onChange={(e) => setFirmTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                maxLength={120}
                className="mt-2 bg-background"
              />
            </div>
          </>
        )}
      </div>{" "}
      {hosted ? null : (
        // Two dates are a range. One alone is that one day, so the person who knows the day types it once.
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 [&>*]:min-w-0 @xs:grid-cols-2 @md:grid-cols-[12rem_12rem] @md:justify-start">
          <div>
            <Label htmlFor={fromId} className="text-sm font-bold">
              Filed from
            </Label>{" "}
            <DateInput
              id={fromId}
              value={ownFrom}
              maxDate={today}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || ISO_DATE_REGEX.test(v)) setOwnFrom(v);
              }}
              className="mt-2"
            />
          </div>{" "}
          <div>
            <Label htmlFor={toId} className="text-sm font-bold">
              Filed to
            </Label>{" "}
            <DateInput
              id={toId}
              value={ownTo}
              maxDate={today}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || ISO_DATE_REGEX.test(v)) setOwnTo(v);
              }}
              className="mt-2"
            />
          </div>
        </div>
      )}{" "}
      {/* Only the one-line answers are announced: a live region around the list would read every row on each key. */}
      <div className="text-base leading-relaxed">
        {!asked ? (
          // What the boxes are for, until one is used. A host that owns the date says it in its own label.
          hosted ? null : (
            <p id={hintId} className="mt-3 text-sm text-muted-foreground">
              Fill in what you know. One box is enough, and each one more narrows the list. One date is that day; two
              are the days between, up to three months.
            </p>
          )
        ) : hostNeedsDay ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Pick the filing date above to see this employer’s cases from that day.
          </p>
        ) : refused === "too-early" ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            The day lists start on {longDate(FILINGS_FROM)}.{" "}
            {boxFilled(name) ? (
              <>
                <Link href={searchHref} className="link">
                  Search every filing by this employer
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : refused === "not-yet" ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {longDate(from || to) ?? "That day"} hasn’t come yet, so nothing was filed on it.
          </p>
        ) : refused === "too-long" ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Pick dates three months apart or less, or add the employer’s name or the law firm.
          </p>
        ) : found.failed ? (
          <RequestFailed className="mt-3 border-2 border-border bg-tint p-4" what={`DOL’s record of ${names.plural}`} failure={found.failure} onRetry={found.retry} />
        ) : !answer ? (
          // Nothing to read yet when a date isn't a whole day: the date box says so itself.
          ready ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              Reading DOL’s record of {names.plural}.
            </p>
          ) : null
        ) : (
          <div aria-busy={busy} className={cn(busy && "opacity-60")}>
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              <AnswerWords answer={answer} names={names} />
            </p>{" "}
            {answer.firm && answer.firm.alternatives.length > 0 ? (
              <DidYouMean
                className="mt-3"
                label="Or another firm those words fit"
                suggestions={answer.firm.alternatives.slice(0, FIRMS_OFFERED).map((f) => ({ label: f.name, onPick: () => setFirmTyped(f.name) }))}
              />
            ) : null}{" "}
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
                    filed={oneDay === null}
                    firm={answer.decidedOnly}
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
            {answer.cases.length > shown.length ? (
              <button type="button" onClick={() => setAllFor(key)} className={cn(choiceVariants({ on: false }), "mt-3")}>
                Show all {formatInt(answer.cases.length)}
              </button>
            ) : null}{" "}
            {answer.capped ? (
              <p className="mt-3 text-sm text-muted-foreground">
                More fit than one list carries, so a case can be missing here. Fill in another box or bring the dates
                closer, or{" "}
                <Link href={searchHref} className="link">
                  open the full search
                </Link>
                .
              </p>
            ) : null}{" "}
            {noEmployer ? (
              <>
                <DidYouMean
                  className="mt-4"
                  label={oneDay ? "Filed that day under a close name" : "Filed in those days under a close name"}
                  suggestions={answer.close.map((n) => ({
                    label: n.employer,
                    note: oneDay ? `${formatInt(n.cases)} that day` : `${formatInt(n.cases)} in those days`,
                    onPick: () => setTyped(n.employer),
                  }))}
                />{" "}
                {oneDay ? (
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
                ) : null}
              </>
            ) : null}{" "}
            {boxFilled(name) || wholeDayHref ? (
              <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {boxFilled(name) ? (
                  <Link href={searchHref} className="link inline-flex min-h-11 items-center">
                    Search every filing by this employer
                  </Link>
                ) : null}{" "}
                {wholeDayHref && (answer.period === undefined || answer.period.filed > 0) ? (
                  <Link href={wholeDayHref} className="link inline-flex min-h-11 items-center">
                    See everything filed that day
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The answer in a sentence or three: what DOL's record holds for the days read, then how much of it fits what
 * was typed, then what an answer by law firm can't hold.
 */
function AnswerWords({ answer, names }: { answer: Answer; names: { plural: string; one: string } }) {
  // The answer's own ask, never the boxes: while the next answer is read, the boxes are already ahead of this one.
  const { employer: name, title, firm } = answer.asked;
  const w = answer.window;
  const p = answer.period;
  const byName = boxFilled(name);
  const byTitle = boxFilled(title);
  const typedAny = byName || byTitle || boxFilled(firm);
  const plural = (n: number) => (n === 1 ? names.one : names.plural);

  let held: string;
  if (!w) held = `Looking through every year of DOL’s record of ${names.plural}, the newest filing first.`;
  else if (w.assumed) held = `Looking at ${names.plural} filed in the last three months, since ${longDate(w.from) ?? w.from}. Add dates to look earlier.`;
  else if (!p) held = `Looking at ${names.plural} filed ${spanWords(w.from, w.to)}.`;
  else if (p.filed === 0) held = `DOL’s record holds no ${names.plural} filed ${spanWords(w.from, w.to)}.`;
  else held = `DOL’s record holds ${formatInt(p.filed)} ${plural(p.filed)} filed ${spanWords(w.from, w.to)}: ${formatInt(p.decided)} decided, ${formatInt(p.waiting)} still waiting.`;

  let fits = "";
  const nothingHeld = w !== undefined && !w.assumed && p !== undefined && p.filed === 0;
  if (nothingHeld) fits = "";
  else if (answer.firmUnknown) fits = `No law firm matches “${firm}”.`;
  else if (answer.ofEmployer !== undefined) {
    // Read from the days themselves: the name fits by any of its words, and a job title narrows what it fits.
    if (answer.ofEmployer === 0) fits = `None is from an employer matching “${name}”.`;
    else {
      fits = `${formatInt(answer.ofEmployer)} ${answer.ofEmployer === 1 ? "is" : "are"} from an employer matching “${name}”`;
      fits += byTitle ? `, ${formatInt(answer.matched)} with “${title}” in the job title.` : ".";
    }
  } else if (typedAny) {
    const more = answer.capped ? " or more" : "";
    if (answer.matched === 0) fits = "Nothing fits what you typed.";
    else if (answer.by === "index" && byName && !answer.firm) {
      fits = `${formatInt(answer.matched)}${more} ${answer.matched === 1 && !more ? "is" : "are"} from an employer whose name starts with “${name}”.`;
    } else fits = `${formatInt(answer.matched)}${more} ${answer.matched === 1 && !more ? "fits" : "fit"} what you typed.`;
  }

  const firmWords = answer.firm ? `Showing ${answer.firm.name}.` : "";
  const decided = answer.decidedOnly ? "DOL names a law firm only once it decides a case, so cases still waiting aren’t listed." : "";
  return <>{[held, firmWords, fits, decided].filter(Boolean).join(" ")}</>;
}
