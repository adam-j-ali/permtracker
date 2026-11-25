"use client";

import { EXAMPLE_RECEIPT } from "@/lib/uscis/exampleReceipts";
import { useId, useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";

import { AlertDone, AlertNote, EmailField, OptInFold } from "@/components/alerts/AlertParts";
import { Button } from "@/components/ui/button";
import { isQueued } from "@/lib/alertReply";
import { trackAlertSignup } from "@/lib/alertSignupEvent";
import { convexSiteUrl } from "@/lib/convexSite";
import { formText } from "@/lib/forms/formText";
import { useAlertFormTelemetry } from "@/lib/funnelEvents";
import { cn } from "@/lib/utils";

/**
 * Sign up a USCIS receipt for the tracking beta (convex/uscisAlerts.ts): an email when USCIS changes its status.
 *
 * Two places use it. Under a lookup on /uscis-case-status the receipt is the one just typed, so the form asks for
 * the email only; on /perm-case-alerts it asks for the receipt too. The DOL case number is optional and folded away.
 *
 * The rules are the case alert form's (CaseAlertForm): the server's `message` is shown word for word, because it's
 * the same for every address and a friendlier line per answer would tell a stranger what an address watches; and
 * it's double opt-in, so the line after sending says nothing is sent until the email is confirmed.
 */

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; message: string; queued: boolean }
  | { kind: "refused"; message: string };

const INPUT =
  "h-12 w-full min-w-0 border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function UscisWatchForm({
  receipt,
  source,
  className,
}: {
  /** The receipt the page already read. Without it the form asks for one. */
  receipt?: string;
  /** Which page, for the sign-up's `source`. */
  source: string;
  className?: string;
}) {
  const { observe, onFocusCapture } = useAlertFormTelemetry("uscis", source);
  const emailId = useId();
  const receiptId = useId();
  const dolId = useId();
  const noteId = useId();
  const newsId = useId();
  const [email, setEmail] = useState("");
  const [typedReceipt, setTypedReceipt] = useState("");
  const [dol, setDol] = useState("");
  const [news, setNews] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  const endpoint = convexSiteUrl("/uscis-alert/subscribe");
  if (!endpoint) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    // The boxes themselves, not only React's copy: an autofilled value can skip the event React listens for.
    const address = formText(e.currentTarget, "email", email).trim();
    const number = receipt ?? formText(e.currentTarget, "receipt", typedReceipt).trim();
    const dolNumber = formText(e.currentTarget, "dolCaseNumber", dol).trim();
    setEmail(address);
    setState({ kind: "sending" });
    try {
      const res = await fetch(endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: address,
          receipt: number,
          dolCaseNumber: dolNumber || undefined,
          source,
          news: news || undefined,
          newsletter: newsletter || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      const message = body?.message ?? "That didn't go through. Try again in a moment.";
      setState(res.ok ? { kind: "done", message, queued: isQueued(body) } : { kind: "refused", message });
      trackAlertSignup("uscis", res.ok ? "accepted" : "refused", { source, status: res.status, withDol: dolNumber.length > 0 });
    } catch {
      trackAlertSignup("uscis", "error", { source });
      setState({
        kind: "refused",
        message: "That didn't go through, which usually means the connection dropped. Try again in a moment.",
      });
    }
  }

  if (state.kind === "done") {
    return <AlertDone message={state.message} queued={state.queued} className={className} />;
  }

  const refused = state.kind === "refused";
  return (
    <form ref={observe} onFocusCapture={onFocusCapture} onSubmit={submit} className={cn("print:hidden", className)}>
      <p className="font-heading text-lg font-bold leading-snug text-foreground">
        Email me when USCIS changes {receipt ? "this case's" : "my case's"} status{" "}
        <span className="ml-1 inline-block border-2 border-border px-1.5 align-middle font-mono text-sm font-bold">
          Beta
        </span>
      </p>{" "}
      <p className="mt-1 text-sm leading-relaxed text-foreground">
        We check {receipt ? <span className="font-mono font-semibold">{receipt}</span> : "it"} with USCIS every 4
        hours and after its overnight updates, so you can stop checking.
      </p>{" "}
      {receipt ? null : (
        <div className="mt-3">
          <label htmlFor={receiptId} className="block text-sm font-semibold text-foreground">
            Receipt number
          </label>{" "}
          <input
            id={receiptId}
            name="receipt"
            required
            value={typedReceipt}
            onChange={(e) => setTypedReceipt(e.target.value)}
            placeholder={EXAMPLE_RECEIPT}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={refused ? true : undefined}
            aria-describedby={noteId}
            className={cn(INPUT, "mt-1 font-mono")}
          />
        </div>
      )}{" "}
      <label htmlFor={emailId} className="mt-3 block text-sm font-semibold text-foreground">
        Email
      </label>{" "}
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <EmailField
          id={emailId}
          value={email}
          onChange={setEmail}
          describedBy={noteId}
          invalid={refused}
          className="sm:flex-1"
        />{" "}
        <Button
          type="submit"
          size="lg"
          loading={state.kind === "sending"}
          data-ph-capture-attribute-cta="uscis-alert"
          className="sm:w-auto"
        >
          Email me changes
        </Button>
      </div>{" "}
      {refused ? (
        <p id={noteId} role="alert" className="mt-2 text-sm font-semibold text-data-warn-ink">
          {state.message}
        </p>
      ) : (
        <AlertNote id={noteId} className="mt-2" />
      )}{" "}
      <details className="group mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <CaretRightIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-90" weight="bold" aria-hidden="true" />{" "}
          Add your PERM case number{dol.trim() ? " (added)" : ""}
        </summary>{" "}
        <div className="pb-2 pl-5">
          <label htmlFor={dolId} className="block text-sm text-soft">
            Optional. Each email then links your PERM case at DOL too.
          </label>{" "}
          <input
            id={dolId}
            name="dolCaseNumber"
            value={dol}
            onChange={(e) => setDol(e.target.value)}
            placeholder="G-100-00000-000000"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={cn(INPUT, "mt-1 font-mono")}
          />
        </div>
      </details>{" "}
      <OptInFold id={newsId} news={news} newsletter={newsletter} onNews={setNews} onNewsletter={setNewsletter} />
    </form>
  );
}
