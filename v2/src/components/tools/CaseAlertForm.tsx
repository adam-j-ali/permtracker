"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { programNoun, type FlagProgram } from "@/lib/flagCaseNumber";
import { isQueued } from "@/lib/alertReply";
import { AlertDone, AlertNote, EmailField, OptInFold } from "@/components/alerts/AlertParts";
import { Button } from "@/components/ui/button";
import { formText } from "@/lib/forms/formText";
import { trackAlertSignup } from "@/lib/alertSignupEvent";
import { useAlertFormTelemetry } from "@/lib/funnelEvents";
import { convexSiteUrl } from "@/lib/convexSite";
import { announceWatchChange, browserStore, checkDays, forgetAsked, noteCheck, readAsked, rememberAsked, subscribeWatch } from "@/lib/caseWatchMemory";
import { easternDay } from "@/lib/time";
import { longDate } from "@convex/lib/months";

/**
 * Subscribe to status changes on ONE case.
 *
 * The endpoint and its whole contract belong to the alerts work; this is the
 * form in front of it. Two rules come from that side and are not mine to
 * soften:
 *
 * THE SERVER'S `message` IS RENDERED VERBATIM, on success and on refusal
 * alike. Every reply for an address that already exists is the same neutral
 * string on purpose, because "you're already subscribed to that case" tells
 * anyone who asks whether a given person is waiting on a given case. Writing
 * our own friendlier copy per status code would rebuild that oracle.
 *
 * IT IS DOUBLE OPT-IN, so nothing is sent until the address is confirmed, and
 * the success line says so rather than implying the alert is already armed.
 *
 * IT HAS NO BOX OF ITS OWN: WatchThisNumber places it, in an answer panel or a card.
 *
 * WHERE IT IS OFFERED is decided by the caller, and only for a case that can
 * still change. Mounting it on a decided case would promise mail that can
 * never arrive.
 *
 * THE `program` PROP CHANGES WORDING AND NOTHING ELSE. The endpoint works out
 * which program a number belongs to from the number itself, and it has to,
 * because the case-status page takes all three prefixes and a form cannot be
 * trusted to say. So this prop is presentation: it names the thing the reader
 * is looking at, and tags the source so signup mix can be read per surface.
 * Passing the wrong one produces mildly wrong copy, never a wrong
 * subscription.
 *
 * IT KNOWS A RETURNING BROWSER (src/lib/caseWatchMemory.ts). Most visits to a
 * case's page are a repeat check. A browser that already sent this form for
 * this case sees the day it asked and a way to ask again, in place of the form.
 * A browser on its third day of checking is told so, beside the offer to check
 * for it. Both come from the browser's own storage and say only what the
 * browser did: "you asked", never "you're subscribed", which only the server
 * knows and tells nobody.
 */

/** From this many different days of checking, the form says how many. */
export const RETURNING_FROM_DAYS = 3;

/** Where the signup came from, for the `source` column. Wording aside, inert. */
const SOURCE: Record<FlagProgram, string> = {
  perm: "perm-case-status",
  pwd: "pwd-status",
  lca: "lca-status",
  seasonal: "seasonal-status",
};

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; message: string; queued: boolean }
  | { kind: "refused"; message: string };

export function CaseAlertForm({
  caseNumber,
  program = "perm",
  className,
}: {
  caseNumber: string;
  program?: FlagProgram;
  className?: string;
}) {
  const { observe, onFocusCapture } = useAlertFormTelemetry("case", program);
  const noun = programNoun(program);
  const inputId = useId();
  const noteId = useId();
  const newsId = useId();
  const [email, setEmail] = useState("");
  const [news, setNews] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  // What this browser remembers of the case. The server's render and the first paint know nothing (null, 0), so
  // the markup matches; the browser's own answer follows at once.
  const askedOn = useSyncExternalStore(subscribeWatch, () => readAsked(browserStore(), caseNumber), () => null);
  const daysChecked = useSyncExternalStore(subscribeWatch, () => checkDays(browserStore(), caseNumber), () => 0);
  useEffect(() => {
    noteCheck(browserStore(), caseNumber, easternDay());
    announceWatchChange();
  }, [caseNumber]);

  const endpoint = convexSiteUrl("/case-alert/subscribe");
  if (!endpoint) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    // The box itself, not only React's copy: an autofilled address can skip the
    // event React listens for (formText).
    const address = formText(e.currentTarget, "email", email).trim();
    setEmail(address);
    setState({ kind: "sending" });
    try {
      const res = await fetch(endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: address,
          caseNumber,
          source: SOURCE[program],
          news: news || undefined,
          newsletter: newsletter || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;
      // The server's own words, whatever the code. A generic fallback only
      // for the case where there is no body to read at all.
      const message =
        body?.message ??
        "That didn't go through. Try again in a moment, or check the case on DOL's own status page.";
      setState(res.ok ? { kind: "done", message, queued: isQueued(body) } : { kind: "refused", message });
      // The day is kept so the next visit says "you asked" in place of the form. This visit keeps the server's reply.
      if (res.ok) rememberAsked(browserStore(), caseNumber, easternDay());
      trackAlertSignup("case", res.ok ? "accepted" : "refused", { program, status: res.status });
    } catch {
      trackAlertSignup("case", "error", { program });
      setState({
        kind: "refused",
        message: "That didn't go through, which usually means the connection dropped. Try again in a moment.",
      });
    }
  }

  if (state.kind === "done") {
    return <AlertDone message={state.message} queued={state.queued} className={className} />;
  }

  if (askedOn) {
    return (
      <div className={cn("print:hidden", className)}>
        <p className="text-base font-semibold text-foreground">
          You asked for emails about this {noun} on {longDate(askedOn) ?? askedOn}.
        </p>{" "}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We email the moment DOL changes its status. If no confirmation email came, look in your spam folder, or{" "}
          <button
            type="button"
            className="link inline-flex min-h-11 items-center font-semibold"
            onClick={() => {
              forgetAsked(browserStore(), caseNumber);
              announceWatchChange();
            }}
          >
            ask again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      ref={observe}
      onFocusCapture={onFocusCapture}
      onSubmit={submit}
      className={cn("print:hidden", className)}
    >
      <label htmlFor={inputId} className="block font-heading text-lg font-bold leading-snug text-foreground">
        Email me when DOL changes this {noun}&apos;s status
      </label>{" "}
      <p className="mt-1 text-sm leading-relaxed text-foreground">
        {daysChecked >= RETURNING_FROM_DAYS ? `You've checked this ${noun} on ${daysChecked} days. ` : ""}
        We ask DOL about it every 5 minutes on weekdays, so you can stop checking.
      </p>{" "}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <EmailField
          id={inputId}
          value={email}
          onChange={setEmail}
          describedBy={noteId}
          invalid={state.kind === "refused"}
          className="sm:flex-1"
        />{" "}
        <Button
          type="submit"
          size="lg"
          loading={state.kind === "sending"}
          data-ph-capture-attribute-cta="case-alert"
          className="sm:w-auto"
        >
          Email me changes
        </Button>
      </div>{" "}
      {state.kind === "refused" ? (
        <p id={noteId} role="alert" className="mt-2 text-sm font-semibold text-data-warn-ink">
          {state.message}
        </p>
      ) : (
        <AlertNote id={noteId} className="mt-2" />
      )}{" "}
      <OptInFold
        id={newsId}
        news={news}
        newsletter={newsletter}
        onNews={setNews}
        onNewsletter={setNewsletter}
        className="mt-1"
      />
    </form>
  );
}
