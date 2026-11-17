"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { LockSimpleIcon } from "@phosphor-icons/react";

import { ShareTimeline } from "@/components/community/ShareTimeline";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { TimelineInput } from "@/lib/communityTimeline";
import { ACCOUNT_CODE_INFO, EVIDENCE_WORDS } from "@/lib/uscis/accountCodes";
import { readAccount, timelineFrom, type ReadCase } from "@/lib/uscis/accountReader";
import { longDate } from "@convex/lib/months";
import { officeByCode } from "@/lib/uscisOffices";

/**
 * Paste what your own USCIS account shows; see each update by date with what its code is known to mean, and add them
 * to your timeline if you want to.
 *
 * NOTHING LEAVES THE BROWSER. The paste is read by src/lib/uscis/accountReader.ts in this tab: no request is made,
 * nothing is stored, and the box and the results are marked so analytics never records them (`ph-no-capture`).
 * The timeline form below only sends what the person sees in it, and only when they press Save.
 */

const INFO = new Map(ACCOUNT_CODE_INFO.map((c) => [c.code, c]));

function caseName(c: ReadCase): string {
  const parts = [c.formLabel ?? "A case", c.receipt ? `receipt ${c.receipt}` : null];
  const center = c.center ? officeByCode(c.center)?.name : null;
  return [parts.filter(Boolean).join(", "), center ? `taken in at the ${center}` : null].filter(Boolean).join(", ");
}

/** Each distinct code on a case, its full reading once: where it comes from, what filers report, any caution. */
function CodeReadings({ codes }: { codes: readonly (string | null)[] }) {
  const known = [...new Set(codes)].map((c) => (c ? INFO.get(c) : undefined)).filter((x) => x !== undefined);
  if (known.length === 0) return null;
  return (
    <dl className="mt-4 grid grid-cols-1 gap-3 text-sm leading-relaxed">
      {known.map((info) => (
        <div key={info.code} className="border-l-4 border-data-info-ink bg-tint px-4 py-3">
          <dt className="font-mono font-bold">{info.code} </dt>{" "}
          <dd className="m-0 mt-1">
            <span className="font-semibold">{EVIDENCE_WORDS[info.evidence]}</span>{" "}
            {info.government ? <span>{`"${info.government}" (${info.source}). `}</span> : null}
            <span>{info.filers} </span>
            {info.caution ? <span className="mt-1 block text-muted-foreground">{info.caution} </span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function UscisAccountReader() {
  const uid = useId();
  const [text, setText] = useState("");
  const [prefill, setPrefill] = useState<TimelineInput | null>(null);
  const reading = useMemo(() => readAccount(text), [text]);
  const total = reading.cases.reduce((n, c) => n + c.updates.length, 0);

  return (
    <div className="ph-no-capture" data-ph-no-capture>
      <Label htmlFor={`${uid}-paste`} className="text-base font-semibold">
        Paste what your USCIS account shows
      </Label>{" "}
      <textarea
        id={`${uid}-paste`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPrefill(null);
        }}
        rows={8}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`${uid}-paste-hint`}
        className="ph-no-capture mt-2 block w-full min-w-0 border-2 border-input bg-card p-3 font-mono text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={"I-485  FTA0  06/01/2026\nI-485  IAF   03/04/2026"}
      />{" "}
      <p id={`${uid}-paste-hint`} className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
        <LockSimpleIcon className="mt-0.5 size-4 shrink-0" weight="bold" aria-hidden="true" />
        <span>
          It stays in this browser. Nothing you paste is sent or saved, and this page never signs in to USCIS. A receipt
          number shows only as its letters and last four digits.
        </span>
      </p>{" "}

      <div aria-live="polite" data-testid="reading" className="mt-6">
        {text.trim() === "" ? null : reading.kind === "none" ? (
          <p className="text-base">
            No updates found in that. Paste the case data your account sent, or lines that each hold a date and a code.
          </p>
        ) : (
          <>
            <p className="text-base font-semibold">
              {total} {total === 1 ? "update" : "updates"} on {reading.cases.length} {reading.cases.length === 1 ? "case" : "cases"}
            </p>{" "}
            {reading.cases.map((c, i) => (
              <section key={`${c.receipt ?? c.formLabel ?? "case"}-${i}`} className="mt-5" aria-labelledby={`${uid}-case-${i}`}>
                <h3 id={`${uid}-case-${i}`} className="font-heading text-lg font-bold">
                  {caseName(c)}
                </h3>{" "}
                {c.receivedOn ? <p className="text-sm text-muted-foreground">Received {longDate(c.receivedOn)} </p> : null}
                {/* One line an update: the day, the code and a few words. Each code's full reading follows once. */}
                <ol className="mt-3 border-t-2 border-border" aria-label={`Updates on ${caseName(c)}, by date`}>
                  {c.updates.map((u) => {
                    const info = u.code ? INFO.get(u.code) : undefined;
                    return (
                      <li
                        key={`${u.on}-${u.code}`}
                        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 border-b border-border/60 py-2.5 sm:grid-cols-[11rem_5rem_1fr] [&>*]:min-w-0"
                      >
                        <span className="tabular-nums">{longDate(u.on)} </span>{" "}
                        <span className="font-mono font-bold">{u.code ?? "No code"} </span>{" "}
                        <span className="col-span-2 text-sm text-muted-foreground sm:col-span-1 sm:text-base sm:text-foreground">
                          {info ? info.short : "Not a code we have a reading for"}{" "}
                        </span>
                      </li>
                    );
                  })}
                </ol>{" "}
                <CodeReadings codes={c.updates.map((u) => u.code)} />
              </section>
            ))}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => setPrefill(timelineFrom(reading.cases))}>
                Add these to my timeline
              </Button>{" "}
              <p className="text-sm text-muted-foreground">
                It fills the form below. Nothing is sent until you press Save, and{" "}
                <Link href="/green-card-timelines" className="link">
                  each timeline is checked before it shows
                </Link>
                .
              </p>
            </div>
          </>
        )}
      </div>

      {prefill ? (
        <div className="mt-6">
          <ShareTimeline sharePath="/green-card-timelines" shareLabel="the green card timelines" prefill={prefill} />
        </div>
      ) : null}
    </div>
  );
}
