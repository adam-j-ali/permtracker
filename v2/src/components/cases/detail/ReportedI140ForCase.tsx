"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { differenceInCalendarDays, parseISO } from "date-fns";

import { formatShare } from "@/lib/format";
import { REPORTED_PLACES } from "@/lib/reportedPlaces";
import { easternDay } from "@/lib/time";
import type { Premium } from "@/lib/reportedI140";
import { windowText, type I140Summary } from "@/lib/reportedSummary";

/**
 * "How I-140s like this one are going", on a saved case's I-140 tab: the I-140s people reported in the same category
 * and with the same premium processing, decided in the recent window (the hourly build's figures,
 * scripts/lib_reported_summary.py `i140_figures`, read through /api/reported-i140), beside this case's own days.
 *
 * Nothing about the case leaves the browser: the page asks for the figures every case shares and compares here.
 */

/** Each kind of row in a case's words: a case either paid for premium processing or didn't. */
const KIND: Record<Premium, string> = {
  "with filing": "with premium processing",
  yes: "with premium processing",
  "after filing": "with premium processing added later",
  none: "without premium processing",
  "not given": "premium processing not said",
};

/** The case form's categories as the reported figures name them. */
const CATEGORY: Record<string, string> = { "EB-1": "EB-1", "EB-2": "EB-2", "EB-2-NIW": "EB-2 NIW", "EB-3": "EB-3" };

/**
 * The reported rows to compare a case with: its category, with premium from filing (or premium when not said, when
 * that row has no figure) when the case paid for premium, without premium when it didn't, and both when it doesn't
 * say. A kind with no row of its own comes back empty, never as another kind's figure: people rarely say "no premium"
 * on a PERM case, and the "premium not said" rows are mostly premium cases, so borrowing one would show an ordinary
 * case a wait of weeks for a step that takes months.
 */
export function pickI140Rows(rows: I140Summary[], category: string | undefined, premium: boolean | undefined): I140Summary[] {
  const cat = category ? CATEGORY[category] : undefined;
  if (!cat) return [];
  const row = (p: Premium) => rows.find((r) => r.category === cat && r.premium === p);
  const empty = (p: Premium): I140Summary => ({
    category: cat, premium: p, reported: 0, decidedAllTime: 0, windowDays: 365, decided: 0,
    approvedShare: null, medianDays: null, rfeShare: null,
  });
  const paid = (() => {
    const fromFiling = row("with filing");
    if (fromFiling && fromFiling.medianDays !== null) return fromFiling;
    const said = row("yes");
    if (said && said.medianDays !== null) return said;
    return fromFiling ?? said ?? empty("with filing");
  })();
  const unpaid = row("none") ?? empty("none");
  return premium === true ? [paid] : premium === false ? [unpaid] : [paid, unpaid];
}

type Got = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rows: I140Summary[] };

export function ReportedI140ForCase({
  category,
  premium,
  filedOn,
  decidedOn,
}: {
  category?: string;
  premium?: boolean;
  /** The I-140's filing day, YYYY-MM-DD. */
  filedOn?: string;
  /** Its approval or denial day, YYYY-MM-DD. */
  decidedOn?: string;
}) {
  const [got, setGot] = useState<Got>({ kind: "loading" });

  useEffect(() => {
    if (!category || !CATEGORY[category]) return;
    let live = true;
    fetch("/api/reported-i140")
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { ok?: boolean; i140?: I140Summary[] } | null;
        if (!live) return;
        setGot(r.ok && j?.ok && Array.isArray(j.i140) ? { kind: "ready", rows: j.i140 } : { kind: "error" });
      })
      .catch(() => live && setGot({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [category]);

  const cat = category ? CATEGORY[category] : undefined;
  // This case's days: filing to its decision, or filing to today while it waits.
  const days = filedOn ? differenceInCalendarDays(parseISO(decidedOn ?? easternDay()), parseISO(filedOn)) : null;

  return (
    <section className="detail-card" aria-labelledby="reported-i140-h">
      <div className="detail-card-head ch-i140">
        <h2 id="reported-i140-h" className="flex items-center gap-1.5">
          <UsersThreeIcon className="h-3.5 w-3.5" aria-hidden="true" />
          How I-140s like this one are going
        </h2>
      </div>{" "}
      <div className="detail-card-body grid grid-cols-1 gap-4 [&>*]:min-w-0">
        {!cat ? (
          <p className="text-base text-muted-foreground">
            Add the I-140&apos;s category in the case form to compare it with the I-140s people reported.
          </p>
        ) : got.kind === "loading" ? (
          <p className="text-base text-muted-foreground">Reading the I-140s people reported…</p>
        ) : got.kind === "error" ? (
          <p className="text-base" role="alert">
            The reported I-140 figures couldn&apos;t be read just now. Try again in a minute.
          </p>
        ) : (
          <Rows rows={pickI140Rows(got.rows, category, premium)} cat={cat} days={days} decided={!!decidedOn} />
        )}{" "}
        <p className="text-sm text-muted-foreground">
          {`From the I-140s people reported in ${REPORTED_PLACES} and on PERM Tracker, updated each hour. USCIS posts its own processing times as well.`}{" "}
          <Link href="/uscis-processing-times/i-140" className="link">
            USCIS&apos;s posted times and every category
          </Link>
        </p>
      </div>
    </section>
  );
}

function Rows({ rows, cat, days, decided }: { rows: I140Summary[]; cat: string; days: number | null; decided: boolean }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.premium} className="grid grid-cols-1 gap-2 [&>*]:min-w-0">
          <p className="text-sm font-bold">{`${cat} ${KIND[r.premium]}`}</p>{" "}
          {r.medianDays === null ? (
            <p className="text-base text-muted-foreground">
              {`${r.decided === 0 ? "None were reported decided" : `Only ${r.decided} were reported decided`} in ${windowText(r.windowDays)}, too few for a typical wait. USCIS's posted processing time is the better guide here.`}
            </p>
          ) : (
            <>
              <p className="text-base">
                <span className="font-heading text-2xl font-bold tabular-nums">{`${r.medianDays} days`}</span>{" "}
                <span className="text-muted-foreground">{"from filing to a decision, the median"}</span>
              </p>{" "}
              <p className="text-sm text-muted-foreground">
                {[
                  `${r.decided} decided in ${windowText(r.windowDays)}`,
                  r.approvedShare !== null ? `${formatShare(r.approvedShare)} approved` : null,
                  r.rfeShare !== null ? `${formatShare(r.rfeShare)} had an RFE` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>{" "}
              {days !== null && days >= 0 ? <Yours days={days} median={r.medianDays} decided={decided} /> : null}
            </>
          )}
        </div>
      ))}
    </>
  );
}

/** This case's days against the median: a bar from filing, the median marked on it. */
function Yours({ days, median, decided }: { days: number; median: number; decided: boolean }) {
  const scale = Math.max(days, median) * 1.15 || 1;
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const text = decided
    ? `This one took ${days} days, ${days <= median ? "no longer than" : "longer than"} the median of ${median}.`
    : `This one has been waiting ${days} days. Half of those decided took ${median} days or less.`;
  return (
    <div className="grid grid-cols-1 gap-1 [&>*]:min-w-0">
      <div className="relative h-4 border-2 border-border" role="img" aria-label={text}>
        <div className="h-full" style={{ width: pct(days), background: "var(--stage-i140)" }} />
        <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: pct(median) }} />
      </div>{" "}
      <p className="text-sm">{text}</p>
    </div>
  );
}
