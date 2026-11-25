"use client";

import { useId, useMemo, useState } from "react";

import { DateInput } from "@/components/forms/DateInput";
import { DateRuler } from "@/components/tools/DateRuler";
import { RuleNotes } from "@/components/tools/RuleNotes";
import { ChoiceRow } from "@/components/ui/choice-row";
import { KeepWhole } from "@/components/ui/keep-whole";
import { Label } from "@/components/ui/label";
import { I140_PREMIUM_BUSINESS_DAYS, premiumActionDeadline, type I140PremiumClass } from "@/lib/perm";
import { readerToday } from "@/lib/readerToday";
import { longDate, weekdayName } from "@convex/lib/months";

/**
 * The day USCIS must act on a premium I-140 by, from the day it received the I-907 (or the answer to its request for
 * evidence, which starts a new period). The rule is premiumActionDeadline in convex/lib/perm; this file only renders,
 * with the parts the RFI deadline tool uses.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CLASSES = [
  { value: "standard", label: `Most classifications: ${I140_PREMIUM_BUSINESS_DAYS.standard} business days` },
  {
    value: "e13OrNiw",
    label: `EB-1C or a national interest waiver: ${I140_PREMIUM_BUSINESS_DAYS.e13OrNiw} business days`,
  },
] as const satisfies readonly { value: I140PremiumClass; label: string }[];

export function PremiumClock() {
  const receivedId = useId();
  const hintId = useId();
  const [received, setReceived] = useState("");
  const [cls, setCls] = useState<I140PremiumClass>("standard");
  const today = useMemo(() => readerToday(), []);

  const due = useMemo(() => {
    if (!DATE_RE.test(received)) return null;
    try {
      return premiumActionDeadline(received, cls);
    } catch {
      return null;
    }
  }, [received, cls]);
  const days = I140_PREMIUM_BUSINESS_DAYS[cls];

  return (
    <div className="object mt-6 p-5 sm:p-6">
      <h3 className="font-heading text-lg font-bold">
        <KeepWhole>{"When USCIS must act"}</KeepWhole>
      </h3>{" "}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Label htmlFor={receivedId}>The day USCIS received it</Label>{" "}
          <DateInput
            id={receivedId}
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            aria-describedby={hintId}
            className="mt-1.5"
          />{" "}
          <p id={hintId} className="mt-1 text-sm text-muted-foreground">
            <KeepWhole>
              {cls === "standard"
                ? "The I-907's receipt date, or the day USCIS received your answer to its request for evidence, " +
                  "which starts a new count."
                : "The day USCIS had everything it needs to decide: the petition, its fees and the I-907, usually " +
                  "the I-907's receipt date (8 CFR 106.4(f)(2)), or the day it received your answer to a request " +
                  "for evidence, which starts a new count."}
            </KeepWhole>
          </p>
        </div>{" "}
        <ChoiceRow
          label="Classification"
          labelClassName="block text-sm font-semibold leading-none"
          className="sm:col-span-2"
          options={CLASSES}
          value={cls}
          onChange={setCls}
        />
      </div>{" "}
      <DateRuler
        className="mt-6"
        from={due ? received : null}
        to={due}
        fromLabel="USCIS received it"
        toLabel={`USCIS acts by (business day ${days})`}
        today={today}
        emptyHint="Enter the day USCIS received it"
        // The count under the ruler is calendar days; the deadline is business days.
        leftWord="left on the calendar"
      />{" "}
      <div aria-live="polite">
        {due ? (
          <p className="mt-4 text-base leading-relaxed">
            <b className="font-bold">
              {weekdayName(due)}, {longDate(due)}
            </b>
            <KeepWhole>
              {": by then USCIS approves, denies, or sends a request for evidence or a notice of intent to deny. " +
                "If it does none of these, it refunds the premium fee."}
            </KeepWhole>
          </p>
        ) : null}
      </div>{" "}
      <div className="mt-4">
        <RuleNotes
          items={[
            "USCIS, How Do I Request Premium Processing? (last reviewed November 10, 2026): 15 business days for most I-140 classifications, 45 for E13 multinational executives and managers and E21 national interest waivers, from the day USCIS receives a properly completed I-907.",
            "A request for evidence or a notice of intent to deny stops the count. A new period begins the day USCIS receives the response.",
            "Business days leave out weekends and federal holidays. A day federal offices close for weather doesn't count either, and no calculator can know one in advance.",
          ]}
        />
      </div>
    </div>
  );
}
