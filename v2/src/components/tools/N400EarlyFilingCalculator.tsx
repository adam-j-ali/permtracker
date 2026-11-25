"use client";

import { useId, useMemo, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";

import { DateInput } from "@/components/forms/DateInput";
import { DateRuler } from "@/components/tools/DateRuler";
import { RuleNotes } from "@/components/tools/RuleNotes";
import { ChoiceRow } from "@/components/ui/choice-row";
import { KeepWhole } from "@/components/ui/keep-whole";
import { Label } from "@/components/ui/label";
import { N400_EARLY_FILING_DAYS, n400EarliestFiling, NATURALIZATION_RESIDENCE_YEARS, type NaturalizationPath } from "@/lib/perm";
import { readerToday } from "@/lib/readerToday";
import { longDate, weekdayName } from "@convex/lib/months";

/**
 * The first day a green card holder can file the N-400. The rule is n400EarliestFiling in convex/lib/perm; this file
 * asks for the dates and draws the answer, with the parts the other date calculators use.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PATHS = [
  { value: "five", label: `${NATURALIZATION_RESIDENCE_YEARS.five} years as a permanent resident` },
  { value: "three", label: `${NATURALIZATION_RESIDENCE_YEARS.three} years, married to a U.S. citizen` },
] as const satisfies readonly { value: NaturalizationPath; label: string }[];

const dated = (iso: string) => `${weekdayName(iso)}, ${longDate(iso)}`;

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 bg-tint p-3 text-sm border-2 border-border">
      <WarningIcon size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" /> {children}
    </p>
  );
}

export function N400EarlyFilingCalculator() {
  const ids = { since: useId(), sinceHint: useId(), married: useId(), marriedHint: useId(), citizen: useId(), citizenHint: useId() };
  const [path, setPath] = useState<NaturalizationPath>("five");
  const [since, setSince] = useState("");
  const [married, setMarried] = useState("");
  const [citizen, setCitizen] = useState("");
  const today = useMemo(() => readerToday(), []);

  const r = useMemo(() => {
    if (!DATE_RE.test(since)) return null;
    try {
      return n400EarliestFiling({
        residentSince: since,
        path,
        ...(path === "three" && DATE_RE.test(married) ? { marriedOn: married } : {}),
        ...(path === "three" && DATE_RE.test(citizen) ? { spouseCitizenSince: citizen } : {}),
      });
    } catch {
      return null;
    }
  }, [since, path, married, citizen]);
  const years = NATURALIZATION_RESIDENCE_YEARS[path];
  const canFileNow = r !== null && r.earliest <= today;
  const needsMarriage = path === "three" && !DATE_RE.test(married);

  return (
    <div className="object p-5 sm:p-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <ChoiceRow
          label="Which rule you apply under"
          labelClassName="block text-sm font-semibold leading-none"
          className="sm:col-span-2"
          options={PATHS}
          value={path}
          onChange={setPath}
        />{" "}
        <div>
          <Label htmlFor={ids.since}>Resident since</Label>{" "}
          <DateInput id={ids.since} value={since} onChange={(e) => setSince(e.target.value)} aria-describedby={ids.sinceHint} className="mt-1.5" />{" "}
          <p id={ids.sinceHint} className="mt-1 text-sm text-muted-foreground">
            The date under &ldquo;Resident since&rdquo; on your green card.
          </p>
        </div>{" "}
        {path === "three" ? (
          <>
            <div>
              <Label htmlFor={ids.married}>The day you married</Label>{" "}
              <DateInput id={ids.married} value={married} onChange={(e) => setMarried(e.target.value)} aria-describedby={ids.marriedHint} className="mt-1.5" />{" "}
              <p id={ids.marriedHint} className="mt-1 text-sm text-muted-foreground">
                Your spouse has to be a citizen, and the two of you living together, for all three years before you file.
              </p>
            </div>{" "}
            <div>
              <Label htmlFor={ids.citizen}>Your spouse became a citizen (optional)</Label>{" "}
              <DateInput id={ids.citizen} value={citizen} onChange={(e) => setCitizen(e.target.value)} aria-describedby={ids.citizenHint} className="mt-1.5" />{" "}
              <p id={ids.citizenHint} className="mt-1 text-sm text-muted-foreground">
                Only if it was after the wedding. Leave it blank if your spouse was already a citizen.
              </p>
            </div>
          </>
        ) : null}
      </div>{" "}
      <DateRuler
        className="mt-6"
        from={r ? since : null}
        to={r ? r.earliest : null}
        fromLabel="Resident since"
        toLabel="Apply from"
        today={today}
        leftWord="to go"
        // On the marriage rule the residence can allow a day the marriage doesn't yet: mark it on the way.
        marks={r?.setByMarriage ? [{ at: r.earlyFilingOpens, label: "The residence alone allows", tone: "ink" as const }] : []}
        emptyHint="Enter the date on your green card"
      />{" "}
      <div aria-live="polite">
        {r ? (
          <p className="mt-4 text-base leading-relaxed">
            <KeepWhole>{canFileNow ? "You can apply now. The first day was " : "The first day USCIS accepts your N-400 is "}</KeepWhole>
            <b className="font-bold">{dated(r.earliest)}</b>
            <KeepWhole>
              {r.setByMarriage
                ? `, the day you've been married to a citizen for three years. The residence alone would allow ${longDate(r.earlyFilingOpens)}.`
                : `, ${N400_EARLY_FILING_DAYS} days before your ${years} years are complete on ${longDate(r.residenceComplete)}. You can be interviewed before then, but you aren't eligible to naturalize until that day.`}
            </KeepWhole>
          </p>
        ) : null}
      </div>{" "}
      {r && needsMarriage ? (
        <Note>
          <KeepWhole>{"Add the day you married: on this rule the three years of marriage have to be complete before you file."}</KeepWhole>
        </Note>
      ) : null}{" "}
      {r?.leapDay ? (
        <Note>
          A February 29 has no anniversary in a common year, and USCIS hasn&apos;t said which day it counts. This counts
          March 1, the later day, so the date is never early.
        </Note>
      ) : null}{" "}
      <div className="mt-4">
        <RuleNotes
          items={[
            "INA 334(a): an application may be filed up to 3 months before the applicant first meets the continuous residence requirement. 8 CFR 334.2(b) says 90 days, and USCIS counts 90 calendar days.",
            "USCIS Policy Manual, Volume 12, Part D, Chapter 6, Section D (current as of November 20, 2026): residence first complete on June 10, 2010 means the earliest filing day is March 12, 2010. The person isn't eligible until the full period is complete.",
            "Policy Manual, Volume 12, Part G, Chapter 3: on the three-year rule, the early filing covers the residence only. The three years of marital union, with a spouse who was a citizen throughout, must be complete when you file.",
            "Physical presence is counted separately: at least 30 months (913 days) of the five years, or 18 months (548 days) of the three, in the United States. So is living 3 months in your state or USCIS district, which may fall inside the 90 days (8 CFR 334.2(b)).",
          ]}
        />
      </div>
    </div>
  );
}
