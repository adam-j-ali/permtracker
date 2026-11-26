"use client";

/**
 * Follow a USCIS receipt block by email (convex/blockAlerts.ts): one field, or two where no block is given.
 *
 * On a block's page it follows the form chosen on the card above (the chooser's BLOCK_FORM_EVENT and the address's
 * #form=), so someone reading the I-765 cases hears about the I-765 cases. Same posture as the other alert forms: a
 * plain fetch to the `.convex.site` twin, double opt-in, the server's own reply shown as it came.
 */

import { useEffect, useId, useState } from "react";
import { AlertDone, AlertNote, EmailField } from "@/components/alerts/AlertParts";
import { Button } from "@/components/ui/button";
import { BLOCK_FORM_EVENT } from "@/components/uscis/BlockStatusChooser";
import { formText } from "@/lib/forms/formText";
import { trackAlertSignup } from "@/lib/alertSignupEvent";
import { useAlertFormTelemetry } from "@/lib/funnelEvents";
import { convexSiteUrl } from "@/lib/convexSite";

/** "9366", "09366", "IOE09366" or a whole receipt number, read as its block; null when it isn't one. */
export function blockFromInput(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  const m = /^(?:IOE)?(\d{4,5})(\d{5})?$/.exec(s);
  if (!m?.[1]) return null;
  const head = m[1].padStart(5, "0");
  return /^09\d{3}$/.test(head) ? `IOE${head}` : null;
}

export function BlockFollowForm({ block, source }: { block?: string; source: string }) {
  const { observe, onFocusCapture } = useAlertFormTelemetry("block", source);
  const emailId = useId();
  const blockId = useId();
  const noteId = useId();
  const [email, setEmail] = useState("");
  const [typed, setTyped] = useState("");
  const [form, setForm] = useState("all");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!block) return;
    const m = /(?:^|[#&])form=([A-Za-z0-9-]+)/.exec(window.location.hash);
    if (m?.[1]) setForm(m[1].toUpperCase());
    const on = (e: Event) => setForm(String((e as CustomEvent<string>).detail || "all"));
    window.addEventListener(BLOCK_FORM_EVENT, on);
    return () => window.removeEventListener(BLOCK_FORM_EVENT, on);
  }, [block]);

  const endpoint = convexSiteUrl("/block-alert/subscribe");
  if (!endpoint) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    const address = formText(e.currentTarget, "email", email).trim();
    setEmail(address);
    const target = block ?? blockFromInput(formText(e.currentTarget, "block", typed));
    if (!target) {
      setMessage("Type a receipt block, like 09366, or a whole receipt number.");
      setStatus("error");
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, block: target, form: block && form !== "all" ? form : undefined, source }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage(String(body?.message ?? "Something went wrong. Try again in a moment."));
      setStatus(res.ok ? "done" : "error");
      trackAlertSignup("block", res.ok ? "accepted" : "refused", { source, status: res.status });
    } catch {
      trackAlertSignup("block", "error", { source });
      setMessage("Couldn't reach the server. Try again in a moment.");
      setStatus("error");
    }
  }

  if (status === "done") return <AlertDone message={message} />;

  const what = block ? (form === "all" ? `every form's cases in ${block}` : `the ${form} cases in ${block}`) : "the block you type";
  return (
    <form ref={observe} onFocusCapture={onFocusCapture} onSubmit={handleSubmit} aria-describedby={noteId} className="print:hidden">
      <p className="text-base leading-relaxed">
        {`We'll email you when every number is checked, when the share approved passes a quarter, a half and three quarters, and each Monday with what moved. It follows ${what}.`}
      </p>{" "}
      {block ? null : (
        <>
          <label htmlFor={blockId} className="mt-3 block text-base font-semibold">
            Receipt block or receipt number
          </label>{" "}
          <input
            id={blockId}
            name="block"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="09366"
            className="mt-2 h-11 w-full min-w-0 max-w-xs border-2 border-border bg-background px-3 font-mono text-base"
          />
        </>
      )}{" "}
      <label htmlFor={emailId} className="mt-3 block text-base font-semibold">
        Your email address
      </label>{" "}
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <EmailField id={emailId} value={email} onChange={setEmail} invalid={status === "error"} className="sm:flex-1" />{" "}
        <Button type="submit" variant="outline" size="lg" loading={status === "sending"} data-ph-capture-attribute-cta="block-follow">
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
