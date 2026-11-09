"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import { longDate } from "@convex/lib/months";
import { DateInput } from "@/components/forms/DateInput";
import { Label } from "@/components/ui/label";
import { DateRuler, type RulerMark } from "@/components/tools/DateRuler";
import { SelectedInFull } from "@/components/tools/SelectedInFull";
import { caseMarks, congressNote, inquiryAnswer, ombudsmanFrom, OMBUDSMAN, postedInSentence, type InquiryAnswer } from "@/lib/uscisInquiry";
import { formatInt } from "@/lib/format";

/** One line of USCIS's newest posting as the page passes it: a form, a category and an office. */
export interface InquiryRow {
  form: string;
  subtype: string;
  label: string;
  office: string;
  officeLabel: string;
  /** The receipt date before which USCIS takes a question about a case. */
  requestDate: string | null;
  /** USCIS's posted time, the months it took to finish eight in ten, as a number and as printed. */
  posted: number | null;
  postedText: string | null;
  /** The quarterly median for the same kind of case, where USCIS's report has a line that counts the same cases. */
  median: { months: number; quarter: string } | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The category a form opens on, where the first one USCIS lists isn't the one most readers here hold. */
const OPENS_ON: Record<string, string> = { "I-485": "131A" };
const SELECT =
  "mt-1.5 block min-h-11 w-full min-w-0 border-2 border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const INPUT =
  "mt-1.5 block min-h-11 w-full min-w-0 border-2 border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** The reader's own calendar date. `toISOString()` is UTC, which after about 8 PM Eastern is already tomorrow. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const long = (iso: string) => longDate(iso) ?? iso;

const E_REQUEST = "https://egov.uscis.gov/e-request/ccpt";
const USCIS_TIMES = "https://egov.uscis.gov/processing-times/";
const HOUSE = "https://www.house.gov/representatives/find-your-representative";
const SENATE = "https://www.senate.gov/senators/senators-contact.htm";
const OMBUDSMAN_PAGE = "https://www.dhs.gov/case-assistance";

/**
 * A USCIS case on its own calendar, from the form, the office and the receipt date: the day half of such cases
 * were decided by, the day eight in ten were, and the day USCIS will take a question about it, each from USCIS's
 * own figures. Then the steps after that day, in order, and a note for a congressional office. Everything typed
 * stays in this browser: the page sends nothing anywhere.
 */
export function UscisCaseTimeline({ rows, published, formNames }: { rows: InquiryRow[]; published: string; formNames: Record<string, string> }) {
  const ids = { form: useId(), subtype: useId(), office: useId(), receipt: useId(), name: useId(), number: useId(), asked: useId(), ref: useId(), extra: useId() };
  const forms = useMemo(() => [...new Set(rows.map((r) => r.form))].sort((a, b) => a.localeCompare(b, "en", { numeric: true })), [rows]);
  const [form, setForm] = useState(forms.includes("I-485") ? "I-485" : (forms[0] ?? ""));
  const subtypes = useMemo(() => [...new Map(rows.filter((r) => r.form === form).map((r) => [r.subtype, r.label])).entries()], [rows, form]);
  const [subtype, setSubtype] = useState("");
  // USCIS lists the family-based adjustment first; this site's readers are on the employment-based one.
  const opensOn = OPENS_ON[form] && subtypes.some(([s]) => s === OPENS_ON[form]) ? OPENS_ON[form]! : (subtypes[0]?.[0] ?? "");
  const pickedSubtype = subtypes.some(([s]) => s === subtype) ? subtype : opensOn;
  const offices = useMemo(() => rows.filter((r) => r.form === form && r.subtype === pickedSubtype), [rows, form, pickedSubtype]);
  const [office, setOffice] = useState("");
  const row = offices.find((r) => r.office === office) ?? offices[0] ?? null;
  const [receipt, setReceipt] = useState("");
  const today = useMemo(() => localToday(), []);

  const dated = row !== null && DATE_RE.test(receipt) && receipt <= today;
  const notYet = DATE_RE.test(receipt) && receipt > today;
  const answer: InquiryAnswer | null = row && dated ? inquiryAnswer(receipt, row.requestDate, published, today) : null;
  const canAsk = answer !== null && (answer.kind === "now" || (answer.kind === "default" && answer.now));
  const marks = row && dated ? caseMarks(receipt, row.median?.months ?? null, row.posted) : null;
  // The day a question opens: the cutoff already behind the case, or the day USCIS's formula gives.
  const askFrom = answer === null ? null : answer.kind === "later" || answer.kind === "default" ? answer.from : null;
  const rulerEnd = askFrom ?? marks?.eightInTen ?? marks?.half ?? null;
  const rulerMarks: RulerMark[] = [
    ...(marks?.half && marks.half !== rulerEnd ? [{ at: marks.half, label: "Half decided by" } as RulerMark] : []),
    ...(marks?.eightInTen && marks.eightInTen !== rulerEnd ? [{ at: marks.eightInTen, label: "8 in 10 decided by" } as RulerMark] : []),
  ];

  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [asked, setAsked] = useState("");
  const [reference, setReference] = useState("");
  const [extra, setExtra] = useState("");
  const [copied, setCopied] = useState(false);
  const formLabel = `${form}${formNames[form] ? `, ${formNames[form]}` : ""}${row?.label ? ` (${row.label})` : ""}`;
  const note = row
    ? congressNote({
        name,
        receiptNumber: number.trim(),
        form: formLabel,
        filedOn: DATE_RE.test(receipt) ? long(receipt) : "",
        office: row.officeLabel,
        cutoff: row.requestDate && answer?.kind === "now" ? long(row.requestDate) : null,
        published: long(published),
        askedUscis: DATE_RE.test(asked) ? long(asked) : "",
        reference: reference.trim(),
        extra,
      })
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="object p-5 sm:p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
          <div>
            <Label htmlFor={ids.form}>Form</Label>{" "}
            <select id={ids.form} value={form} onChange={(e) => { setForm(e.target.value); setSubtype(""); setOffice(""); }} className={SELECT}>
              {forms.map((f) => (
                <option key={f} value={f}>{formNames[f] ? `${f}, ${formNames[f]}` : f}</option>
              ))}
            </select>{" "}
            <SelectedInFull label={formNames[form] ? `${form}, ${formNames[form]}` : form} />
          </div>{" "}
          <div>
            <Label htmlFor={ids.subtype}>Category</Label>{" "}
            <select id={ids.subtype} value={pickedSubtype} onChange={(e) => { setSubtype(e.target.value); setOffice(""); }} className={SELECT}>
              {subtypes.map(([s, l]) => (
                <option key={s} value={s}>{l}</option>
              ))}
            </select>{" "}
            <SelectedInFull label={subtypes.find(([s]) => s === pickedSubtype)?.[1]} />
          </div>{" "}
          <div>
            <Label htmlFor={ids.office} className="leading-snug">Office on your receipt notice</Label>{" "}
            <select id={ids.office} value={row?.office ?? ""} onChange={(e) => setOffice(e.target.value)} className={SELECT}>
              {offices.map((r) => (
                <option key={r.office} value={r.office}>{r.officeLabel}</option>
              ))}
            </select>{" "}
            <SelectedInFull label={row?.officeLabel} />
          </div>{" "}
          <div>
            <Label htmlFor={ids.receipt}>Receipt date</Label>{" "}
            <DateInput id={ids.receipt} value={receipt} onChange={(e) => setReceipt(e.target.value)} className="mt-1.5" />
          </div>
        </div>{" "}

        <div className="mt-6" aria-live="polite">
          {/* The picture first: the case's own calendar, with USCIS's two figures ticked on it. */}
          <DateRuler
            from={dated ? receipt : null}
            to={dated ? rulerEnd : null}
            fromLabel="Received"
            toLabel={askFrom ? "You can ask from" : marks?.eightInTen ? "8 in 10 decided by" : "Half decided by"}
            today={today}
            marks={rulerMarks}
            leftWord="to go"
            emptyHint="Enter your receipt date"
          />{" "}
          {marks && (marks.half || marks.eightInTen) ? (
            <ul className="mt-5 space-y-2 text-base leading-relaxed">
              {marks.half && row?.median ? (
                <li>
                  <b className="font-bold">Half of cases like yours were decided by {long(marks.half)}.</b> USCIS&apos;s median for this kind of
                  case was {row.median.months} months in {row.median.quarter}, across every office.
                </li>
              ) : null}{" "}
              {marks.eightInTen ? (
                <li>
                  <b className="font-bold">Eight in ten were decided by {long(marks.eightInTen)}.</b> USCIS&apos;s posted time for this
                  office is {postedInSentence(row?.postedText) ?? "not printed"}.
                </li>
              ) : null}
            </ul>
          ) : null}{" "}
          {notYet ? (
            <p className="mt-4 text-base text-muted-foreground">That date hasn&apos;t come yet. Enter the receipt date on your notice.</p>
          ) : !answer ? (
            <p className="mt-4 text-base text-muted-foreground">Enter the receipt date on your notice to see your case&apos;s dates.</p>
          ) : answer.kind === "now" ? (
            <Verdict tone="good" headline="You can ask USCIS about your case now.">
              USCIS takes questions for this one when the receipt date is before {long(answer.cutoff)}, and yours is.
              Its posted time here is {postedInSentence(row?.postedText) ?? "not printed"}.
            </Verdict>
          ) : answer.kind === "edge" ? (
            <Verdict tone="warn" headline="Your receipt date is USCIS's cutoff day itself.">
              That&apos;s too close to call from the posting. Check it with USCIS&apos;s own tool, linked below, before you ask.
            </Verdict>
          ) : answer.kind === "later" ? (
            <Verdict tone="wait" headline={`You can ask from about ${long(answer.from)}.`}>
              That&apos;s {formatInt(answer.days)} day{answer.days === 1 ? "" : "s"} from today, if USCIS&apos;s time for this one doesn&apos;t
              change. USCIS takes questions now only for receipt dates before {long(answer.cutoff)}, and the cutoff moves with each
              monthly posting.
            </Verdict>
          ) : (
            <Verdict tone={answer.now ? "good" : "wait"} headline={answer.now ? "You can ask USCIS about your case now." : `You can ask from ${long(answer.from)}.`}>
              USCIS posts no time for this one, so its default applies: a case may be asked about once it has been pending six months.
            </Verdict>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            From USCIS&apos;s posting of {long(published)}. USCIS&apos;s own{" "}
            <a href={USCIS_TIMES} className="link" target="_blank" rel="noopener noreferrer">processing times tool</a>{" "}
            is the last word.
          </p>
        </div>
      </div>{" "}

      {form === "I-485" && (pickedSubtype === "131A" || pickedSubtype === "131A-FAM") ? (
        <p className="max-w-3xl border-l-[6px] border-l-data-warn pl-4 text-base leading-relaxed">
          <b className="font-bold">One thing the dates above can&apos;t see: your priority date.</b> USCIS can approve this application
          only while a visa number is available for it. The{" "}
          <Link href="/tools/priority-date-calculator" className="link">priority date calculator</Link>{" "}
          checks yours against this month&apos;s visa bulletin.
        </p>
      ) : null}{" "}

      <section aria-labelledby={`${ids.form}-way`}>
        <h2 id={`${ids.form}-way`} className="font-heading text-2xl font-bold">What happens along the way</h2>{" "}
        <p className="mt-2 max-w-3xl text-base leading-relaxed">
          USCIS mails a receipt notice with your receipt number, and for many forms an appointment to take fingerprints and a photo.
          It may send a request for evidence or schedule an interview before it decides. None of these has a posted time, so the
          calendar above doesn&apos;t date them. The{" "}
          <Link href="/uscis-case-status" className="link">USCIS case status lookup</Link>{" "}
          shows the step your own case is on.
        </p>
      </section>{" "}

      <section aria-labelledby={`${ids.form}-steps`}>
        <h2 id={`${ids.form}-steps`} className="font-heading text-2xl font-bold">If it runs late: the steps, in order</h2>{" "}
        <p className="mt-2 max-w-3xl text-base text-muted-foreground">Each step has its own wait before the next one opens.</p>{" "}
        <ol className="mt-4 space-y-4">
          <Step n={1} title="Ask USCIS" now={canAsk}>
            Once you&apos;re past the date above, send a case inquiry through{" "}
            <a href={E_REQUEST} className="link" target="_blank" rel="noopener noreferrer">USCIS&apos;s e-Request</a>, or call the Contact Center at
            800-375-5283. Keep the reference number USCIS sends: the Ombudsman asks for it later. USCIS aims to answer within 15 business days.
          </Step>{" "}
          <Step n={2} title="Ask your representative or senators">
            A congressional office can ask USCIS on your behalf, usually once your case is outside normal processing. You&apos;ll sign the
            office&apos;s privacy release, because USCIS answers an office only with one. Find yours at{" "}
            <a href={HOUSE} className="link" target="_blank" rel="noopener noreferrer">house.gov</a> or{" "}
            <a href={SENATE} className="link" target="_blank" rel="noopener noreferrer">senate.gov</a>. The note below drafts the message.
          </Step>{" "}
          <Step n={3} title="Ask the CIS Ombudsman">
            The{" "}
            <a href={OMBUDSMAN_PAGE} className="link" target="_blank" rel="noopener noreferrer">Ombudsman</a>{" "}
            takes a delayed case once you asked USCIS in the last {OMBUDSMAN.contactWithinDays} days and gave it at least {OMBUDSMAN.waitAtLeastDays},
            and not within {OMBUDSMAN.afterCongressDays} days of a congressional inquiry.
            {DATE_RE.test(asked) ? ` If you asked USCIS on ${long(asked)}, that's from ${long(ombudsmanFrom(asked, null))}.` : ""}
          </Step>{" "}
          <Step n={4} title="Talk to an immigration attorney about mandamus">
            A mandamus case asks a federal court to order USCIS to decide. Courts treat it as a last resort, once the steps above are used up.
            Whether a delay is long enough is a question for a lawyer.
          </Step>
        </ol>
      </section>{" "}

      <section aria-labelledby={`${ids.form}-note`} className="object p-5 sm:p-8">
        <h2 id={`${ids.form}-note`} className="font-heading text-2xl font-bold">A note for a congressional office</h2>{" "}
        <p className="mt-2 max-w-3xl text-base text-muted-foreground">
          Fill in what you have, then copy the note into the office&apos;s form or email. It stays in this browser, and nothing is sent anywhere.
          Never put a Social Security number in it.
        </p>{" "}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <Label htmlFor={ids.name}>Your name</Label>{" "}
            <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoComplete="name" />
          </div>{" "}
          <div>
            <Label htmlFor={ids.number}>Receipt number</Label>{" "}
            <input id={ids.number} value={number} onChange={(e) => setNumber(e.target.value)} className={INPUT} autoComplete="off" spellCheck={false} />
          </div>{" "}
          <div>
            <Label htmlFor={ids.asked} className="leading-snug">The day you asked USCIS (optional)</Label>{" "}
            <DateInput id={ids.asked} value={asked} onChange={(e) => setAsked(e.target.value)} className="mt-1.5" />
          </div>{" "}
          <div>
            <Label htmlFor={ids.ref} className="leading-snug">USCIS&apos;s reference number (optional)</Label>{" "}
            <input id={ids.ref} value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} autoComplete="off" spellCheck={false} />
          </div>
        </div>{" "}
        <div className="mt-4">
          <Label htmlFor={ids.extra} className="leading-snug">Anything the office should know (optional)</Label>{" "}
          <textarea id={ids.extra} value={extra} onChange={(e) => setExtra(e.target.value)} rows={3} className={INPUT} />
        </div>{" "}
        <pre className="mt-5 whitespace-pre-wrap break-words border-2 border-border bg-muted p-4 text-base leading-relaxed" data-testid="congress-note">
          {note}
        </pre>{" "}
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-3 inline-flex min-h-11 items-center gap-2 border-2 border-foreground bg-primary px-4 py-2 font-bold text-primary-foreground"
        >
          {copied ? <CheckIcon size={18} weight="bold" aria-hidden="true" /> : <CopyIcon size={18} weight="bold" aria-hidden="true" />}
          {copied ? "Copied" : "Copy the note"}
        </button>
      </section>
    </div>
  );
}

function Verdict({ tone, headline, children }: { tone: "good" | "warn" | "wait"; headline: string; children: React.ReactNode }) {
  // Green for open now, yellow for waiting: the site's one status code.
  const border = tone === "good" ? "border-l-data-good" : "border-l-data-warn";
  return (
    <div className={`mt-5 border-l-[6px] ${border} pl-4`}>
      <p className="font-heading text-2xl font-bold">{headline}</p>{" "}
      <p className="mt-2 text-base leading-relaxed">{children}</p>
    </div>
  );
}

function Step({ n, title, now = false, children }: { n: number; title: string; now?: boolean; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
      <span className={`flex size-11 items-center justify-center border-2 border-foreground font-heading text-lg font-bold ${now ? "bg-primary text-primary-foreground" : ""}`} aria-hidden="true">
        {n}
      </span>
      <div>
        <p className="font-heading text-lg font-bold">
          {title}
          {now ? <span className="ml-2 text-base font-normal text-soft">Open to you now</span> : null}
        </p>{" "}
        <p className="mt-1 text-base leading-relaxed">{children}</p>
      </div>
    </li>
  );
}

