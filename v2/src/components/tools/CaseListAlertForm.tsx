"use client";

import { useId, useMemo, useState } from "react";
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { CASES_PER_ADDRESS, LIST_TEXT_MAX, readCaseList } from "@/lib/caseList";
import { isQueued } from "@/lib/alertReply";
import { AlertDone, AlertNote, EmailField, OptInFold } from "@/components/alerts/AlertParts";
import { Button } from "@/components/ui/button";
import { formText } from "@/lib/forms/formText";
import { trackAlertSignup } from "@/lib/alertSignupEvent";
import { useAlertFormTelemetry } from "@/lib/funnelEvents";
import { convexSiteUrl } from "@/lib/convexSite";
import { announceWatchChange, browserStore, rememberAsked } from "@/lib/caseWatchMemory";
import { easternDay } from "@/lib/time";
import { formatInt } from "@convex/lib/format";

/**
 * Watch several cases with one form: paste the numbers, get ONE confirmation email naming each with DOL's status,
 * and one click confirms them all.
 *
 * For the person who keeps a list: an HR or mobility lead, a paralegal, a household with a PERM case and its wage
 * request. The single-case form asks for one number at a time, which is the wrong shape for a spreadsheet column.
 *
 * Two halves. The box on the left takes whatever is pasted (one per line, commas, or whole spreadsheet rows). The
 * panel on the right says what was read, as it's typed: the count, the numbers as they'll be sent, and any line
 * with no case number on it, so a typo shows before anything is sent. `readCaseList` does the reading, and the
 * server reads the list again with the same function.
 *
 * The same contract as `CaseAlertForm`: the server's `message` is drawn verbatim, it's double opt-in, and the
 * reply never depends on what the address already watches.
 */

/** How many of the numbers read are listed in the panel; the rest are counted. */
const SHOWN = 8;
/** How many unread lines are listed; the rest are counted. */
const UNREAD_SHOWN = 4;

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; message: string; queued: boolean }
  | { kind: "refused"; message: string };

export function CaseListAlertForm({ source, className }: { source: string; className?: string }) {
  const { observe, onFocusCapture } = useAlertFormTelemetry("case", `${source}-list`);
  const listId = useId();
  const readId = useId();
  const emailId = useId();
  const noteId = useId();
  const newsId = useId();
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [news, setNews] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  const read = useMemo(() => readCaseList(text), [text]);
  const sent = read.numbers.slice(0, CASES_PER_ADDRESS);
  const over = read.numbers.length - sent.length;

  const endpoint = convexSiteUrl("/case-alert/subscribe-list");
  if (!endpoint) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    // The email box itself, not only React's copy: an autofilled address can skip the event React listens for
    // (formText). The list is typed or pasted, which React always hears, and a form's own copy of a multi-line
    // box can differ in its line endings alone.
    const numbers = sent;
    const address = formText(e.currentTarget, "email", email).trim();
    setEmail(address);
    if (numbers.length === 0) {
      setState({ kind: "refused", message: "Paste at least one case number first. It looks like G-100-26125-868956." });
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch(endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: address,
          caseNumbers: numbers,
          source: `${source}-list`,
          news: news || undefined,
          newsletter: newsletter || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      // The server's own words, whatever the code. A fallback only when there's no body to read.
      const message = body?.message ?? "That didn't go through. Try again in a moment.";
      setState(res.ok ? { kind: "done", message, queued: isQueued(body) } : { kind: "refused", message });
      if (res.ok) {
        // Each case's own page then says "you asked" in place of its form. Only what this browser did.
        const store = browserStore();
        const today = easternDay();
        for (const n of numbers) rememberAsked(store, n, today);
        announceWatchChange();
      }
      trackAlertSignup("case", res.ok ? "accepted" : "refused", { source: `${source}-list`, status: res.status, list: numbers.length });
    } catch {
      trackAlertSignup("case", "error", { source: `${source}-list` });
      setState({
        kind: "refused",
        message: "That didn't go through, which usually means the connection dropped. Try again in a moment.",
      });
    }
  }

  if (state.kind === "done") {
    return <AlertDone message={state.message} queued={state.queued} className={className} />;
  }

  return (
    <form ref={observe} onFocusCapture={onFocusCapture} onSubmit={submit} className={cn("print:hidden", className)}>
      {/* The box and what was read from it sit side by side, and on a phone the second comes straight under the
          first: the reader sees what was read before the button, never after it. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-8 [&>*]:min-w-0">
        <div className="flex flex-col">
          <label htmlFor={listId} className="block text-base font-semibold text-foreground">
            Case numbers
          </label>{" "}
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            One per line, or separated by commas. Rows copied from a spreadsheet work too.
          </p>{" "}
          <textarea
            id={listId}
            name="cases"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={LIST_TEXT_MAX}
            spellCheck={false}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder={"G-100-26125-868956\nG-100-26130-111111\nP-100-26131-222222"}
            aria-describedby={readId}
            className="mt-2 block min-h-[13rem] w-full min-w-0 flex-1 resize-y border border-input bg-card px-3 py-2.5 font-mono text-base leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>{" "}
        <ReadSoFar id={readId} numbers={sent} over={over} unread={read.unread} repeats={read.repeats} />
      </div>{" "}
      <div className="mt-5 max-w-2xl">
        <label htmlFor={emailId} className="block text-base font-semibold text-foreground">
          Your email address
        </label>{" "}
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <EmailField
            id={emailId}
            value={email}
            onChange={setEmail}
            describedBy={noteId}
            invalid={state.kind === "refused"}
            className="sm:flex-1"
          />{" "}
          <Button type="submit" size="lg" loading={state.kind === "sending"} data-ph-capture-attribute-cta="case-list-alert">
            Email me their changes
          </Button>
        </div>{" "}
        {state.kind === "refused" ? (
          <p id={noteId} role="alert" className="mt-2 text-sm font-semibold text-data-warn-ink">
            {state.message}
          </p>
        ) : (
          <AlertNote id={noteId} className="mt-2" />
        )}{" "}
        <OptInFold id={newsId} news={news} newsletter={newsletter} onNews={setNews} onNewsletter={setNewsletter} className="mt-1" />
      </div>
    </form>
  );
}

/**
 * What the confirmation email's list looks like, drawn in the empty panel: three made-up cases, one in each state
 * the email can show. The bar's colour is the site's status code, and the words beside it carry the meaning.
 */
const EXAMPLE_ROWS = [
  { number: "G-100-26125-868956", status: "Analyst Review", bar: "border-l-data-warn" },
  { number: "G-100-26130-111111", status: "Certified", bar: "border-l-data-good" },
  { number: "P-100-26131-222222", status: "Not in our records yet", bar: "border-l-muted-foreground/40" },
] as const;

/** The panel that says what was read: the count, the numbers as they'll be sent, and what couldn't be read. */
function ReadSoFar({
  id,
  numbers,
  over,
  unread,
  repeats,
}: {
  id: string;
  numbers: readonly string[];
  over: number;
  unread: readonly string[];
  repeats: number;
}) {
  const n = numbers.length;
  return (
    <div className="border-2 border-border bg-card p-4 sm:p-5">
      {/* The one line read out as the list changes: the count, and whether anything needs a look. The rows under
          it are ordinary content, so a screen reader isn't read the whole list on every keystroke. */}
      <p id={id} role="status" aria-live="polite" aria-atomic="true" className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-4xl font-bold leading-none text-foreground">{formatInt(n)}</span>{" "}
        <span className="text-base font-semibold text-foreground">{n === 1 ? "case number read" : "case numbers read"}</span>
        {unread.length > 0 || over > 0 ? <span className="sr-only">. Something below needs a look.</span> : null}
      </p>{" "}
      {n === 0 ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Each number you paste shows here as it&apos;ll be sent. One email then names them all, each with DOL&apos;s
            status, and one click confirms the list.
          </p>{" "}
          <p className="mt-4 text-sm font-semibold text-foreground">An example of the email&apos;s list</p>{" "}
          <ul className="mt-2 border-t border-border">
            {EXAMPLE_ROWS.map((row) => (
              <li
                key={row.number}
                className={cn("flex flex-wrap items-baseline gap-x-3 border-b border-l-[6px] border-border py-2 pl-2.5 text-sm", row.bar)}
              >
                <span className="font-mono font-semibold text-foreground">{row.number}</span>{" "}
                <span className="text-muted-foreground">{row.status}</span>{" "}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <ul className="mt-3 border-t border-border">
            {numbers.slice(0, SHOWN).map((number) => (
              <li key={number} className="flex items-center gap-2 border-b border-border py-2 font-mono text-sm font-semibold text-foreground">
                <CheckCircleIcon className="size-4 shrink-0 text-data-good-ink" weight="fill" aria-hidden="true" />{" "}
                <span className="min-w-0 break-all">{number}</span>{" "}
              </li>
            ))}
          </ul>{" "}
          {n > SHOWN ? (
            <p className="mt-2 text-sm text-muted-foreground">and {formatInt(n - SHOWN)} more, all named in the email</p>
          ) : null}
        </>
      )}{" "}
      {over > 0 ? (
        <p className="mt-3 flex items-start gap-2 text-sm font-semibold leading-relaxed text-data-warn-ink">
          <WarningIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden="true" />{" "}
          <span>
            One address can watch {CASES_PER_ADDRESS} cases, so the first {CASES_PER_ADDRESS} go and {formatInt(over)} stay
            behind. For a whole company&apos;s cases, follow the employer from its page instead.
          </span>
        </p>
      ) : null}{" "}
      {unread.length > 0 ? (
        <div className="mt-3 text-sm leading-relaxed text-data-warn-ink">
          <p className="flex items-start gap-2 font-semibold">
            <WarningIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden="true" />{" "}
            <span>
              {unread.length === 1 ? "1 line has no case number we can read:" : `${formatInt(unread.length)} lines have no case number we can read:`}
            </span>
          </p>{" "}
          <ul className="mt-1 pl-6 font-mono text-foreground">
            {unread.slice(0, UNREAD_SHOWN).map((line, i) => (
              <li key={`${i}-${line}`} className="break-all">
                {line}{" "}
              </li>
            ))}
          </ul>{" "}
          {unread.length > UNREAD_SHOWN ? (
            <p className="mt-1 pl-6 text-muted-foreground">and {formatInt(unread.length - UNREAD_SHOWN)} more</p>
          ) : null}
        </div>
      ) : null}{" "}
      {repeats > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {repeats === 1 ? "1 repeat was counted once." : `${formatInt(repeats)} repeats were each counted once.`}
        </p>
      ) : null}
    </div>
  );
}
