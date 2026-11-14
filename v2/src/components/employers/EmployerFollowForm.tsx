"use client";

/**
 * Follow an employer by email: one tick box and one field.
 *
 * The box above this form says what a follow sends (the days DOL moves the
 * employer's cases as a group). The tick box adds every case's status change,
 * for someone who manages the cases; the confirmation email says in full what
 * was picked. A link may open the form ticked or unticked with `?follow=each`
 * or `?follow=group`, read in the browser so the page stays static.
 *
 * Same posture as the other alert forms: a plain fetch to the `.convex.site`
 * twin, double opt-in, the server's own reply rendered verbatim. It sends the
 * SLUG only; the route looks the employer's name up in our records, so the
 * name in the confirmation email is never the form's.
 */

import { useEffect, useId, useState } from "react";
import { AlertDone, AlertNote, EmailField, TickRow } from "@/components/alerts/AlertParts";
import { Button } from "@/components/ui/button";
import { EVERY_CASE_LABEL, type FollowScope } from "@/lib/employerCaseMoves";
import { formText } from "@/lib/forms/formText";
import { trackAlertSignup } from "@/lib/alertSignupEvent";
import { useAlertFormTelemetry } from "@/lib/funnelEvents";
import { convexSiteUrl } from "@/lib/convexSite";

export function EmployerFollowForm({
  slug,
  source,
  defaultScope = "group",
}: {
  slug: string;
  source: string;
  /** Whether the form opens with "every case" ticked (`defaultFollowScope`). */
  defaultScope?: FollowScope;
}) {
  const { observe, onFocusCapture } = useAlertFormTelemetry("employer", source);
  const emailId = useId();
  const noteId = useId();
  const everyId = useId();
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<FollowScope>(defaultScope);
  // Read after the page has drawn, never on the server: a query string in the render would make every employer
  // page dynamic.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("follow");
    if (asked === "each" || asked === "group") setScope(asked);
  }, []);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const endpoint = convexSiteUrl("/employer-alert/subscribe");
  if (!endpoint) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    // The box itself, not only React's copy: an autofilled address can skip the
    // event React listens for (formText).
    const address = formText(e.currentTarget, "email", email).trim();
    setEmail(address);
    setStatus("sending");
    try {
      const res = await fetch(endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, slug, source, scope }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage(String(body?.message ?? "Something went wrong. Try again in a moment."));
      setStatus(res.ok ? "done" : "error");
      trackAlertSignup("employer", res.ok ? "accepted" : "refused", { source, status: res.status, scope });
    } catch {
      trackAlertSignup("employer", "error", { source });
      setMessage("Couldn't reach the server. Try again in a moment.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return <AlertDone message={message} />;
  }

  return (
    <form ref={observe} onFocusCapture={onFocusCapture} onSubmit={handleSubmit} aria-describedby={noteId} className="print:hidden">
      <TickRow id={everyId} checked={scope === "each"} onChange={(on) => setScope(on ? "each" : "group")} className="mb-1">
        {EVERY_CASE_LABEL}
      </TickRow>{" "}
      <label htmlFor={emailId} className="block text-base font-semibold">
        Your email address
      </label>{" "}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <EmailField id={emailId} value={email} onChange={setEmail} invalid={status === "error"} className="sm:flex-1" />{" "}
        <Button
          type="submit"
          variant="outline"
          size="lg"
          loading={status === "sending"}
          data-ph-capture-attribute-cta="employer-follow"
        >
          Follow
        </Button>
      </div>{" "}
      {status === "error" && message ? (
        <p id={noteId} className="mt-2 text-sm font-semibold text-data-warn-ink" role="alert">
          {message}
        </p>
      ) : (
        <AlertNote id={noteId} className="mt-2" />
      )}
    </form>
  );
}
