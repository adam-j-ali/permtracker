"use client";

import { useId, useMemo, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";

import { DateInput } from "@/components/forms/DateInput";
import { DateRuler } from "@/components/tools/DateRuler";
import { RuleNotes } from "@/components/tools/RuleNotes";
import { ChoiceRow } from "@/components/ui/choice-row";
import { KeepWhole } from "@/components/ui/keep-whole";
import { Label } from "@/components/ui/label";
import { NOID_MAX_RESPONSE_DAYS, RFE_MAX_RESPONSE_DAYS, rfeResponseDeadline, USCIS_MAIL_DAYS } from "@/lib/perm";
import { readerToday } from "@/lib/readerToday";
import { longDate, weekdayName } from "@convex/lib/months";

/**
 * The day USCIS must receive the answer to a request for evidence or a notice of intent to deny. The rule is
 * rfeResponseDeadline in convex/lib/perm; this file asks for the notice's date, its period and how it came, and draws
 * the count.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dated = (iso: string) => `${weekdayName(iso)}, ${longDate(iso)}`;
const INPUT =
  "mt-1.5 min-h-11 w-full min-w-0 border-2 border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const HOW = [
  { value: "mail", label: `By mail: ${USCIS_MAIL_DAYS} days added` },
  { value: "online", label: "In my online account" },
] as const;

const PERIODS = [
  { value: "84", label: `${RFE_MAX_RESPONSE_DAYS} days (12 weeks)` },
  { value: "30", label: `${NOID_MAX_RESPONSE_DAYS} days` },
  { value: "other", label: "Another number" },
] as const;

type Period = (typeof PERIODS)[number]["value"];

/** "a Saturday", or a holiday by its name: "Christmas Day, a federal holiday". */
const movedWords = (why: string) => (why === "Saturday" || why === "Sunday" ? `a ${why}` : `${why}, a federal holiday`);

export function UscisRfeDeadlineCalculator() {
  const ids = { notice: useId(), noticeHint: useId(), days: useId() };
  const [notice, setNotice] = useState("");
  const [how, setHow] = useState<"mail" | "online">("mail");
  const [period, setPeriod] = useState<Period>("84");
  const [other, setOther] = useState("");
  const today = useMemo(() => readerToday(), []);

  const days = period === "other" ? Number(other) : Number(period);
  const badDays = period === "other" && other.trim() !== "" && !(Number.isInteger(days) && days >= 1 && days <= RFE_MAX_RESPONSE_DAYS);
  const r = useMemo(() => {
    if (!DATE_RE.test(notice) || !Number.isInteger(days) || days < 1 || days > RFE_MAX_RESPONSE_DAYS) return null;
    try {
      return rfeResponseDeadline({ noticeDate: notice, responseDays: days, mailed: how === "mail" });
    } catch {
      return null;
    }
  }, [notice, days, how]);
  const periodEnds = r ? r.counted : null;

  return (
    <div className="object p-5 sm:p-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Label htmlFor={ids.notice}>Notice date</Label>{" "}
          <DateInput id={ids.notice} value={notice} onChange={(e) => setNotice(e.target.value)} aria-describedby={ids.noticeHint} className="mt-1.5" />{" "}
          <p id={ids.noticeHint} className="mt-1 text-sm text-muted-foreground">
            The date printed on the request for evidence or the notice of intent to deny.
          </p>
        </div>{" "}
        <ChoiceRow
          label="How it reached you"
          labelClassName="block text-sm font-semibold leading-none"
          options={HOW}
          value={how}
          onChange={setHow}
        />{" "}
        <ChoiceRow
          label="Days the notice gives you"
          labelClassName="block text-sm font-semibold leading-none"
          className="sm:col-span-2"
          options={PERIODS}
          value={period}
          onChange={setPeriod}
        />{" "}
        {period === "other" ? (
          <div>
            <Label htmlFor={ids.days}>Days on the notice</Label>{" "}
            <input
              id={ids.days}
              type="number"
              inputMode="numeric"
              min={1}
              max={RFE_MAX_RESPONSE_DAYS}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              className={INPUT}
            />
          </div>
        ) : null}
      </div>{" "}
      {badDays ? (
        <p className="mt-4 flex items-start gap-2 bg-tint p-3 text-sm border-2 border-border">
          <WarningIcon size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" /> A request for evidence gives at
          most {RFE_MAX_RESPONSE_DAYS} days, so enter a whole number from 1 to {RFE_MAX_RESPONSE_DAYS}.
        </p>
      ) : null}{" "}
      <DateRuler
        className="mt-6"
        from={r ? notice : null}
        to={r ? r.due : null}
        fromLabel="Notice date"
        toLabel="USCIS must receive it by"
        today={today}
        marks={r && r.movedBecause && periodEnds ? [{ at: periodEnds, label: `Day ${days + r.mailDays}`, tone: "warn" as const }] : []}
        emptyHint="Enter the date on the notice"
      />{" "}
      <div aria-live="polite">
        {r ? (
          <p className="mt-4 text-base leading-relaxed">
            <b className="font-bold">{dated(r.due)}</b>
            <KeepWhole>
              {`: the day USCIS must receive your response. That's ${days} days from the notice` +
                (r.mailDays ? `, ${r.mailDays} more because it came by mail` : "") +
                (r.movedBecause ? `, then on to the next business day, since day ${days + r.mailDays} is ${movedWords(r.movedBecause)}.` : ".")}
            </KeepWhole>
          </p>
        ) : null}
      </div>{" "}
      {r ? (
        <p className="mt-4 flex items-start gap-2 bg-tint p-3 text-sm border-2 border-border">
          <WarningIcon size={18} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" />{" "}
          <KeepWhole>
            {"The notice states its own deadline. If it differs from this date, go by the notice. USCIS can't give more time, " +
              "and a response sent through your online account counts the day you submit it, a weekend included."}
          </KeepWhole>
        </p>
      ) : null}{" "}
      <div className="mt-4">
        <RuleNotes
          items={[
            `8 CFR 103.2(b)(8)(iv): the notice states the deadline. A request for evidence gives at most twelve weeks, a notice of intent to deny at most ${NOID_MAX_RESPONSE_DAYS} days, and no more time may be granted.`,
            `8 CFR 103.8(b): when a notice is served by mail, ${USCIS_MAIL_DAYS} days are added, and service is complete on mailing. The USCIS Policy Manual (Volume 1, Part E, Chapter 6, Section F, current as of November 20, 2026) puts the longest at 87 days from the day USCIS mailed it.`,
            "8 CFR 1.2, Day: a period whose last day is a Saturday, Sunday or federal holiday runs to the end of the next day that's none of them. The Policy Manual applies it to a mailed response.",
            "Policy Manual tables: 30 days for the I-539 and the I-601A, and 84 for every other form. A naturalization applicant generally gets 30 (33 if mailed). 8 CFR 103.2(b)(13)(i): with no response by the date, the case may be denied.",
          ]}
        />
      </div>
    </div>
  );
}
