"use client";

import { useId, useMemo, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";

import { DateInput } from "@/components/forms/DateInput";
import { DateRuler } from "@/components/tools/DateRuler";
import { RuleNotes } from "@/components/tools/RuleNotes";
import { KeepWhole } from "@/components/ui/keep-whole";
import { Label } from "@/components/ui/label";
import { I751_FILING_WINDOW_DAYS, i751FilingWindow } from "@/lib/perm";
import { readerToday } from "@/lib/readerToday";
import { longDate, weekdayName } from "@convex/lib/months";

/**
 * The 90 days to file the I-751, from the date under "Card expires" on a two-year green card. The rule is
 * i751FilingWindow in convex/lib/perm; this file asks for the date and draws the window.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dated = (iso: string) => `${weekdayName(iso)}, ${longDate(iso)}`;

export function I751WindowCalculator() {
  const ids = { expires: useId(), hint: useId() };
  const [expires, setExpires] = useState("");
  const today = useMemo(() => readerToday(), []);

  const r = useMemo(() => {
    if (!DATE_RE.test(expires)) return null;
    try {
      return i751FilingWindow({ cardExpires: expires, today });
    } catch {
      return null;
    }
  }, [expires, today]);
  const lastWeekday = r ? weekdayName(r.lastDay) : null;

  return (
    <div className="object p-5 sm:p-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Label htmlFor={ids.expires}>Card expires</Label>{" "}
          <DateInput id={ids.expires} value={expires} onChange={(e) => setExpires(e.target.value)} aria-describedby={ids.hint} className="mt-1.5" />{" "}
          <p id={ids.hint} className="mt-1 text-sm text-muted-foreground">
            The date under &ldquo;Card expires&rdquo; on the two-year green card: two years after &ldquo;Resident since.&rdquo;
          </p>
        </div>
      </div>{" "}
      <DateRuler
        className="mt-6"
        from={r ? r.opens : null}
        to={r ? r.expires : null}
        fromLabel="Window opens"
        toLabel="Card expires"
        today={today}
        leftWord="left to file"
        marks={r ? [{ at: r.lastDay, label: "Last day to file", tone: "warn" as const }] : []}
        emptyHint="Enter the date the card expires"
      />{" "}
      <div aria-live="polite">
        {r ? (
          <p className="mt-4 text-base leading-relaxed">
            <KeepWhole>{"File the I-751 from "}</KeepWhole>
            <b className="font-bold">{dated(r.opens)}</b> to <b className="font-bold">{dated(r.lastDay)}</b>
            <KeepWhole>
              {r.stage === "early"
                ? `. It hasn't opened yet. A joint petition has to arrive inside these ${I751_FILING_WINDOW_DAYS} days.`
                : r.stage === "open"
                  ? `. The window is open now.`
                  : `. The window has closed. A late petition needs a written explanation, and USCIS excuses it only for good cause.`}
            </KeepWhole>
          </p>
        ) : null}
      </div>{" "}
      {r && (lastWeekday === "Saturday" || lastWeekday === "Sunday") ? (
        <p className="mt-4 flex items-start gap-2 bg-tint p-3 text-sm border-2 border-border">
          <WarningIcon size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" />{" "}
          <KeepWhole>{`The last day is a ${lastWeekday}. USCIS counts a petition as filed the day it arrives, so send it in time to arrive before the weekend.`}</KeepWhole>
        </p>
      ) : null}{" "}
      <div className="mt-4">
        <RuleNotes
          items={[
            `8 CFR 216.4(a)(1): the joint petition is filed within the ${I751_FILING_WINDOW_DAYS}-day period immediately before the second anniversary of the day conditional residence began. That anniversary is the date under "Card expires."`,
            "USCIS, When to File Your Petition to Remove Conditions: its own calculator gives April 1, 2023 as the first day for a card that expires June 30, 2023. So the 90 days end the day before the card's date.",
            "8 CFR 216.4(a)(6): not filing in the window ends the conditional status. A late petition is taken only when the petitioner shows good cause in writing. 8 CFR 103.2(a)(7)(i): a petition is filed on the day USCIS receives it.",
            "USCIS, Removing Conditions on Permanent Residence Based on Marriage: a request to waive the joint filing can be made before or after the 90 days, and a child who got status more than 90 days after the parent files a separate I-751.",
          ]}
        />
      </div>
    </div>
  );
}
