import Link from "next/link";

import type { BasicsEntry } from "@/components/data/PageBasics";
import { formatAsOf, formatMonth } from "@/lib/dolFormat";
import { formatInt } from "@/lib/format";
import type { MoveRow } from "@/lib/stageMoves";
import { stageInSentence } from "@/components/rfi/stageMeta";

/**
 * The questions on a review stage's page, answered from the page's own live figures. Phrased the way people search
 * ("how long does a PERM reconsideration take"), each answer self-contained, every count dated, PERM Tracker named
 * where the sentence stands alone (the house rules in `components/data/PageBasics.tsx`).
 */

export interface StageBasicsFigures {
  status: string;
  label: string;
  cases: number;
  asOf: string | null;
  known: number;
  median: number | null;
  longest: number | null;
  answered: number;
  /** Of the cases our check saw arrive, followed at least `days` days: how many, and how many had left by then. */
  watched: { days: number; eligible: number; left: number } | null;
  moves: { total: number; rows: MoveRow[] } | null;
  /** DOL's last posted month for this step, where it posts one (reconsideration until Oct 31 2026). */
  posted: { month: string; asOf: string; droppedAsOf: string | null } | null;
}

/** "How long does ... take?", per stage, in the words people search with. */
const HOW_LONG: Record<string, string> = {
  "RECONSIDERATION APPEALS": "How long does a PERM reconsideration take?",
  "RFI ISSUED": "How long does a PERM RFI take to resolve?",
  "APPLICATION ON HOLD": "How long does a PERM application stay on hold?",
  "NORD ISSUED": "How long does a PERM case stay at NORD issued?",
  "BALCA APPEALS": "How long does a BALCA appeal of a PERM denial take?",
  "REQUEST FOR REVIEW": "How long does a PERM request for review take?",
};

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;
/** A destination's label inside a sentence: "certified", "back to analyst review", but "NORD issued" as DOL prints it. */
const phrase = (label: string) => (/^[A-Z]{2,}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

export function stageBasics(f: StageBasicsFigures): BasicsEntry[] {
  const lower = stageInSentence(f.status);
  const asOf = f.asOf ? formatAsOf(f.asOf) : null;
  const out: BasicsEntry[] = [];

  out.push({
    q: HOW_LONG[f.status] ?? `How long do PERM cases stay at ${lower}?`,
    a: (
      <>
        {f.posted
          ? `DOL last posted a month for this step on ${formatAsOf(f.posted.asOf)}: it was working on requests from ${formatMonth(f.posted.month)}${f.posted.droppedAsOf ? `, and its page has left the line out since its ${formatAsOf(f.posted.droppedAsOf)} update` : ""}. `
          : "DOL doesn't publish a time for this step. "}
        {f.watched && f.watched.eligible > 0
          ? `Of the ${formatInt(f.watched.eligible)} cases PERM Tracker's daily check saw arrive and has followed for at least ${f.watched.days} days, ${formatInt(f.watched.left)} (${pct(f.watched.left, f.watched.eligible)}) had left by then. `
          : ""}
        {f.median !== null
          ? `The ${formatInt(f.known)} cases waiting here now with a start on record have waited ${formatInt(f.median)} days so far, typically, and the longest ${formatInt(f.longest ?? f.median)}${asOf ? ` (as of ${asOf})` : ""}.`
          : "None of the cases waiting here now has a start on record yet."}
      </>
    ),
  });

  if (f.moves && f.moves.rows.length > 0) {
    const top = f.moves.rows.slice(0, 3);
    out.push({
      q: `What happens to PERM cases after ${lower}?`,
      a: (
        <>
          Since August 30, 2026, PERM Tracker&apos;s daily check has seen {formatInt(f.moves.total)} cases leave this
          step:{" "}
          {top.map((r, i) => `${i === 0 ? "" : i === top.length - 1 ? " and " : ", "}${pct(r.n, f.moves!.total)} ${phrase(r.label)}`).join("")}
          . Every one of them is listed on this page, with the day it moved and how long it had waited.
        </>
      ),
    });
  }

  out.push({
    q: "How do I know when my case moves?",
    a: (
      <>
        DOL&apos;s own <a href="https://flag.dol.gov/case-status-search" className="link" target="_blank" rel="noopener noreferrer">case-status search</a>{" "}
        shows a case&apos;s status today. To hear the day it changes instead of checking, enter the case number in{" "}
        <Link href="/perm-case-status" className="link">
          PERM Tracker&apos;s case lookup
        </Link>{" "}
        and turn on an alert: one free email when DOL moves it.
      </>
    ),
  });

  return out;
}
