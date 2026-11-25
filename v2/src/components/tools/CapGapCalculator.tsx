"use client";

import { useId, useMemo, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";

import { DateInput } from "@/components/forms/DateInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChoiceRow } from "@/components/ui/choice-row";
import { DateRuler } from "@/components/tools/DateRuler";
import { RuleNotes } from "@/components/tools/RuleNotes";
import { formatInt } from "@/lib/format";
import { calculateCapGap, calculateOptUnemployment, optUnemploymentFromJobs } from "@/lib/perm";
import { cn } from "@/lib/utils";
import { KeepWhole } from "@/components/ui/keep-whole";
import { readerToday } from "@/lib/readerToday";

const STEM_CHOICES = [
  { value: "no", label: "No: post-completion OPT" },
  { value: "yes", label: "Yes: 24-month STEM OPT" },
] as const;

/**
 * Two F-1 dates, each from its regulation: how far the cap-gap carries a student's status and OPT to the H-1B, and
 * how many OPT unemployment days are left. The rules live in `@/lib/perm` (f1Dates); this file asks and draws.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const long = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const INPUT =
  "mt-1.5 min-h-11 w-full min-w-0 border-2 border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 bg-tint p-3 text-sm border-2 border-border">
      <WarningIcon size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" /> {children}
    </p>
  );
}

export function CapGapPart() {
  const ids = { opt: useId(), start: useId(), filed: useId(), approved: useId() };
  const [optEnds, setOptEnds] = useState("");
  const [start, setStart] = useState("");
  const [filed, setFiled] = useState("");
  const [approved, setApproved] = useState("");
  const today = useMemo(() => readerToday(), []);
  const r = useMemo(() => {
    if (![optEnds, start, filed].every((d) => DATE_RE.test(d))) return null;
    try {
      return calculateCapGap({ optEnds, requestedStart: start, filed, ...(DATE_RE.test(approved) ? { approvedStart: approved } : {}) });
    } catch {
      return null;
    }
  }, [optEnds, start, filed, approved]);

  return (
    <div className="object p-5 sm:p-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <div>
          <Label htmlFor={ids.opt}>OPT ends</Label>{" "}
          <DateInput id={ids.opt} value={optEnds} onChange={(e) => setOptEnds(e.target.value)} className="mt-1.5" />{" "}
          <p className="mt-1 text-sm text-muted-foreground">The end date on the EAD.</p>
        </div>{" "}
        <div>
          <Label htmlFor={ids.start}><KeepWhole>{"H-1B start asked for"}</KeepWhole></Label>{" "}
          <DateInput id={ids.start} value={start} onChange={(e) => setStart(e.target.value)} className="mt-1.5" />{" "}
          <p className="mt-1 text-sm text-muted-foreground">Usually October 1.</p>
        </div>{" "}
        <div>
          <Label htmlFor={ids.filed}><KeepWhole>{"H-1B petition filed"}</KeepWhole></Label>{" "}
          <DateInput id={ids.filed} value={filed} onChange={(e) => setFiled(e.target.value)} className="mt-1.5" />
        </div>{" "}
        <div>
          <Label htmlFor={ids.approved}>Approved start (optional)</Label>{" "}
          <DateInput id={ids.approved} value={approved} onChange={(e) => setApproved(e.target.value)} className="mt-1.5" />{" "}
          <p className="mt-1 text-sm text-muted-foreground">Once USCIS approves it.</p>
        </div>
      </div>{" "}
      <DateRuler
        className="mt-6"
        from={r ? optEnds : null}
        to={r ? r.until : null}
        fromLabel="OPT ends"
        toLabel={r?.byApproval ? "Extended until the approved start" : "Extended until"}
        today={today}
        leftWord="to go"
        marks={r && !r.byApproval ? [{ at: start, label: "H-1B start asked for", tone: "good" as const }] : []}
        emptyHint="Enter the OPT end, the H-1B start and the filing date"
      />{" "}
      {r ? (
        <div className="mt-4">
          {!r.gap ? <Note><KeepWhole>{"The OPT runs past the H-1B start, so there's no gap to bridge."}</KeepWhole></Note> : null}
          {!r.optValidAtFiling ? (
            <Note>
              The OPT had ended by the day the petition was filed. The rule extends the student&apos;s status and the OPT work
              authorization the student holds. With the OPT over, there&apos;s none to extend. Ask the school&apos;s DSO what
              the record shows.
            </Note>
          ) : null}
          <p className="mt-4 text-base leading-relaxed">
            For the fiscal year {r.fiscalYear} cap, the extension runs until <strong>{long(r.until)}</strong>
            {r.byApproval
              ? ", the approved petition's start date, which comes before April 1."
              : " while the petition is pending. Once it's approved, it runs until the approved start date if that's earlier."}{" "}
            It ends at once if the petition, or the change of status in it, is rejected, denied, revoked or withdrawn.
          </p>{" "}
          <RuleNotes
            items={[
              "8 CFR 214.2(f)(5)(vii)(A): an F-1 student named in a timely filed, nonfrivolous H-1B cap petition asking for a change of status keeps the status and any OPT work authorization until April 1 of that fiscal year, or the approved petition's start date if earlier.",
              "8 CFR 214.2(f)(5)(vii)(B): the extension ends on the petition's rejection, denial, revocation or withdrawal, or the change of status being denied or withdrawn.",
              "April 1 since the H-1B modernization rule, 89 FR 103054, effective January 17, 2025. It was October 1 before.",
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The most jobs the form takes: enough for a year of short contracts, few enough to read on a phone. */
const MAX_JOBS = 8;

/** The days used, as a bar against the limit, and what's left: the same figure for either way of counting. */
function DaysFigure({
  r,
  emptyHint,
}: {
  r: { used: number; limit: number; left: number; over: boolean; lastDay: string | null; firstDayOver?: string | null } | null;
  emptyHint: string;
}) {
  const share = r ? Math.min(1, r.used / r.limit) : 0;
  return (
    <figure className="mt-6 bg-tint p-4 sm:p-5 border-2 border-border">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="text-sm text-muted-foreground">Unemployment days used</p>{" "}
        <p className="font-heading text-2xl font-bold tabular-nums sm:text-3xl">
          {r ? `${formatInt(r.used)} of ${formatInt(r.limit)}` : <span aria-hidden="true" className="inline-block h-6 w-28 bg-foreground/10 align-middle" />}
        </p>
      </div>{" "}
      <div aria-hidden="true" className="relative mt-4 h-10 border border-input">
        {r ? (
          <div className={cn("absolute inset-y-0 left-0", r.over ? "bg-data-bad" : "bg-foreground")} style={{ width: `${share * 100}%` }} />
        ) : (
          <div className="flex h-full items-center justify-center bg-hatch">
            <span className="bg-background px-2 text-sm font-bold text-muted-foreground">{emptyHint}</span>
          </div>
        )}
      </div>{" "}
      {r ? (
        <p className="mt-4 border-t-2 border-border pt-3 text-base">
          {r.over ? (
            <>
              <strong>Over the limit</strong> by {formatInt(r.used - r.limit)} {r.used - r.limit === 1 ? "day" : "days"}
              {r.firstDayOver ? (
                <>
                  , since <strong>{long(r.firstDayOver)}</strong>.
                </>
              ) : (
                "."
              )}
            </>
          ) : (
            <>
              <span className="font-heading text-3xl font-bold tabular-nums">{formatInt(r.left)}</span> {r.left === 1 ? "day" : "days"} left
              {r.lastDay ? (
                <>
                  . Without work from here on, day {formatInt(r.limit)} is <strong>{long(r.lastDay)}</strong>.
                </>
              ) : (
                "."
              )}
            </>
          )}
        </p>
      ) : null}
    </figure>
  );
}

const OPT_RULE_NOTES = [
  "8 CFR 214.2(f)(10)(ii)(E): no more than 90 days of unemployment in all during post-completion OPT. The limit is 150 in all once a 24-month STEM extension is granted, the first OPT period included.",
  "The rule counts days of unemployment, not working days. Which days count as employment is the record the school's DSO keeps.",
];

/**
 * OPT unemployment counted from the job dates, the way SEVIS counts: every day from the OPT start that no job covers.
 * The rule is optUnemploymentFromJobs in `@/lib/perm`; this asks for the dates and draws the count.
 */
export function OptJobDaysPart() {
  const ids = { start: useId(), startHint: useId(), end: useId(), endHint: useId(), jobs: useId() };
  const [stem, setStem] = useState<"no" | "yes">("no");
  const [optStart, setOptStart] = useState("");
  const [optEnd, setOptEnd] = useState("");
  const [jobs, setJobs] = useState<{ key: number; start: string; end: string }[]>([{ key: 0, start: "", end: "" }]);
  const [nextKey, setNextKey] = useState(1);
  const today = useMemo(() => readerToday(), []);

  // The job whose last day comes before its first, by its place in the list, or -1.
  const backwards = jobs.findIndex((j) => DATE_RE.test(j.start) && DATE_RE.test(j.end) && j.end < j.start);
  const r = useMemo(() => {
    if (!DATE_RE.test(optStart) || backwards >= 0) return null;
    try {
      return optUnemploymentFromJobs({
        optStart,
        stem: stem === "yes",
        ...(DATE_RE.test(optEnd) ? { optEnd } : {}),
        jobs: jobs.filter((j) => DATE_RE.test(j.start)).map((j) => ({ start: j.start, ...(DATE_RE.test(j.end) ? { end: j.end } : {}) })),
        today,
      });
    } catch {
      return null;
    }
  }, [optStart, optEnd, stem, jobs, backwards, today]);

  const setJob = (key: number, field: "start" | "end", value: string) =>
    setJobs((list) => list.map((j) => (j.key === key ? { ...j, [field]: value } : j)));

  return (
    <div className="object p-5 sm:p-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <ChoiceRow
          label="STEM extension granted"
          labelClassName="block text-sm font-semibold leading-none"
          options={STEM_CHOICES}
          value={stem}
          onChange={setStem}
        />{" "}
        <div>
          <Label htmlFor={ids.start}>OPT start date</Label>{" "}
          <DateInput id={ids.start} value={optStart} onChange={(e) => setOptStart(e.target.value)} aria-describedby={ids.startHint} className="mt-1.5" />{" "}
          <p id={ids.startHint} className="mt-1 text-sm text-muted-foreground">The start date on the EAD.</p>
        </div>{" "}
        <div>
          <Label htmlFor={ids.end}>OPT end date (optional)</Label>{" "}
          <DateInput id={ids.end} value={optEnd} onChange={(e) => setOptEnd(e.target.value)} aria-describedby={ids.endHint} className="mt-1.5" />{" "}
          <p id={ids.endHint} className="mt-1 text-sm text-muted-foreground">The last day on the EAD, or the STEM extension&apos;s. The count stops there.</p>
        </div>
      </div>{" "}
      <fieldset className="mt-6" aria-describedby={ids.jobs}>
        <legend className="text-sm font-semibold">Jobs on OPT</legend>{" "}
        <p id={ids.jobs} className="mt-1 text-sm text-muted-foreground">
          Each job of 20 hours a week or more. Leave the last day blank for a job you still have.
        </p>{" "}
        <ol className="mt-3 space-y-4">
          {jobs.map((j, i) => (
            <li key={j.key} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end [&>*]:min-w-0">
              <div>
                <Label htmlFor={`${ids.jobs}-${j.key}-start`}>Job {i + 1}: first day</Label>{" "}
                <DateInput id={`${ids.jobs}-${j.key}-start`} value={j.start} onChange={(e) => setJob(j.key, "start", e.target.value)} className="mt-1.5" />
              </div>{" "}
              <div>
                <Label htmlFor={`${ids.jobs}-${j.key}-end`}>Job {i + 1}: last day</Label>{" "}
                <DateInput id={`${ids.jobs}-${j.key}-end`} value={j.end} onChange={(e) => setJob(j.key, "end", e.target.value)} className="mt-1.5" />
              </div>{" "}
              {jobs.length > 1 ? (
                <Button type="button" variant="outline" onClick={() => setJobs((list) => list.filter((x) => x.key !== j.key))}>
                  Remove<span className="sr-only"> job {i + 1}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ol>{" "}
        {jobs.length < MAX_JOBS ? (
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => {
              setJobs((list) => [...list, { key: nextKey, start: "", end: "" }]);
              setNextKey((k) => k + 1);
            }}
          >
            Add a job
          </Button>
        ) : null}
      </fieldset>{" "}
      {backwards >= 0 ? <Note>Job {backwards + 1} ends before it starts. Check its dates.</Note> : null}{" "}
      <div aria-live="polite">
        <DaysFigure r={r} emptyHint="Enter the OPT start date" />
      </div>{" "}
      {r ? (
        <div className="mt-4">
          <RuleNotes
            items={[
              ...OPT_RULE_NOTES,
              "SEVIS Help Hub, Unemployment Counter (last updated July 27, 2026): SEVIS looks back to the OPT start date and counts each day without employer information.",
              "SEVP Policy Guidance 1004-03: every day without qualifying work counts, weekends included, and a job counts at 20 hours a week or more. Time abroad counts too, unless it's on leave from the job or travel for it.",
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export function OptDaysPart() {
  const ids = { used: useId(), since: useId() };
  const [stem, setStem] = useState<"no" | "yes">("no");
  const [used, setUsed] = useState("");
  const [since, setSince] = useState("");
  const today = useMemo(() => readerToday(), []);
  const usedNum = used.trim() === "" ? 0 : Number(used);
  const bad = !Number.isFinite(usedNum) || usedNum < 0 || usedNum > 400;
  const r = useMemo(() => {
    if (bad || (used.trim() === "" && !DATE_RE.test(since))) return null;
    try {
      return calculateOptUnemployment({ stem: stem === "yes", usedBefore: usedNum, ...(DATE_RE.test(since) ? { unemployedSince: since } : {}), today });
    } catch {
      return null;
    }
  }, [bad, used, since, stem, usedNum, today]);

  return (
    <div className="object p-5 sm:p-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <ChoiceRow
          label="STEM extension granted"
          labelClassName="block text-sm font-semibold leading-none"
          options={STEM_CHOICES}
          value={stem}
          onChange={setStem}
        />{" "}
        <div>
          <Label htmlFor={ids.used}>Days without work so far</Label>{" "}
          <input
            id={ids.used}
            type="number"
            inputMode="numeric"
            min={0}
            max={400}
            value={used}
            onChange={(e) => setUsed(e.target.value)}
            placeholder="0"
            className={INPUT}
          />{" "}
          <p className="mt-1 text-sm text-muted-foreground">Before any stretch going on now.</p>
        </div>{" "}
        <div>
          <Label htmlFor={ids.since}>Without work since (optional)</Label>{" "}
          <DateInput id={ids.since} value={since} onChange={(e) => setSince(e.target.value)} className="mt-1.5" />{" "}
          <p className="mt-1 text-sm text-muted-foreground">The first day of a stretch going on now.</p>
        </div>
      </div>{" "}
      {bad ? <Note>Days must be a whole number from 0 to 400.</Note> : null}{" "}
      <DaysFigure r={r} emptyHint="Enter the days used" />{" "}
      {r ? (
        <div className="mt-4">
          <RuleNotes items={OPT_RULE_NOTES} />
        </div>
      ) : null}
    </div>
  );
}
