"use client";

/**
 * "Ask us to check this block" (convex/blockRequests.ts): on a block's page while its numbers aren't all checked. One
 * click is one vote; the checker walks the most asked blocks first and finishes the one it started. The box then says
 * where the block stands: its place in line and about how long, being checked now and how far, joining the line, or
 * done. It reads the checker's line every minute while the page is in front, and says plainly when it can't.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { convexSiteUrl } from "@/lib/convexSite";
import { formatInt } from "@/lib/format";
import { ordinal } from "@/lib/firmRanks";

type Standing = {
  ok: boolean;
  votes: number;
  doneAt: number | null;
  joining: boolean;
  position: number | null;
  status: "walking" | "waiting" | null;
  handed: number;
  inLine: number;
  running: boolean;
  etaMinutes: number | null;
};

const ASKED_KEY = (block: string) => `ptBlockAsked:${block}`;
const WEEK_MS = 7 * 86_400_000;
const etDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });

/** "about 40 minutes", "about 3 hours", "about 2 days". */
export function aboutTime(minutes: number): string {
  if (minutes < 60) return `about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(minutes / 1440);
  return `about ${days} ${days === 1 ? "day" : "days"}`;
}

/** What the box says for a standing: pure, so each state is tested on its own. */
export function standingWords(s: Standing): string {
  const asked = s.votes > 0 ? ` ${formatInt(s.votes)} ${s.votes === 1 ? "person has" : "people have"} asked for it.` : "";
  if (s.doneAt) return "Every number in this block has been checked. This page shows them after its next update, usually within the hour.";
  if (s.status === "walking") {
    const pct = Math.round(s.handed * 100);
    const left = s.running && s.etaMinutes ? ` Done in ${aboutTime(s.etaMinutes)}.` : s.running ? "" : " Checking is paused right now and picks up where it stopped.";
    return `Being checked now: ${pct}% of its numbers so far.${left}${asked}`;
  }
  if (s.position) {
    const when = s.running && s.etaMinutes ? ` Done in ${aboutTime(s.etaMinutes)}.` : s.running ? "" : " Checking is paused right now. Its place in line is kept.";
    return `${ordinal(s.position)} in line.${when}${asked}`;
  }
  if (s.joining) return `Asked. It joins the line within 10 minutes.${asked}`;
  return "";
}

/** `again`: every number is already checked; the box offers a new pass once the last is a week old. */
export function BlockCheckRequest({ block, again = false }: { block: string; again?: boolean }) {
  const noteId = useId();
  const [standing, setStanding] = useState<Standing | null>(null);
  // When the line was read: "a week since the last check" is judged against it, never the clock during render.
  const [readAt, setReadAt] = useState<number | null>(null);
  const [asked, setAsked] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");
  const queueUrl = convexSiteUrl(`/block-queue?block=${encodeURIComponent(block)}`);
  const askUrl = convexSiteUrl("/block-request");

  const load = useCallback(async () => {
    if (!queueUrl) return;
    try {
      const res = await fetch(queueUrl, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as Standing | null;
      if (res.ok && body?.ok) {
        setStanding(body);
        setReadAt(Date.now());
      }
    } catch {
      /* the box keeps what it last showed; the button still works */
    }
  }, [queueUrl]);

  useEffect(() => {
    try {
      setAsked(window.localStorage.getItem(ASKED_KEY(block)) === new Date().toDateString());
    } catch {
      /* storage blocked: the server still counts one vote per connection a day */
    }
    void load();
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(tick);
  }, [block, load]);

  if (!queueUrl || !askUrl) return null;

  async function ask() {
    if (status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch(askUrl!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      setMessage(String(body?.message ?? "Something went wrong. Try again in a moment."));
      if (res.ok && body?.ok) {
        setAsked(true);
        setStatus("idle");
        try {
          window.localStorage.setItem(ASKED_KEY(block), new Date().toDateString());
        } catch {
          /* storage blocked */
        }
        void load();
      } else {
        setStatus("error");
      }
    } catch {
      setMessage("Couldn't reach the server. Try again in a moment.");
      setStatus("error");
    }
  }

  const doneAt = standing?.doneAt ?? null;
  const recent = doneAt !== null && readAt !== null && readAt - doneAt < WEEK_MS;
  const words =
    again && doneAt && !standing?.position && !standing?.joining
      ? `Checked in full on ${etDay(doneAt)}.${recent ? ` You can ask for a new check from ${etDay(doneAt + WEEK_MS)}.` : ""}`
      : standing
        ? standingWords(standing)
        : "";
  const done = recent;
  return (
    <div className="mt-6 max-w-2xl border-2 border-border bg-card p-5 print:hidden">
      <h2 className="font-heading text-xl font-bold">{again ? `Check ${block} again` : `Check every number in ${block}`}</h2>{" "}
      <p className="mt-2 text-base leading-relaxed">
        {again
          ? "Every number here has been checked. Ask for a new check to see what has moved since, a week or more after the last one."
          : "We check whole blocks people ask for, the most asked first. A block takes about an hour once its turn comes."}
      </p>{" "}
      <p id={noteId} className="mt-3 text-base font-semibold leading-relaxed" aria-live="polite">
        {status === "error" ? message : words || (asked ? message || "You asked for this block today." : "")}
      </p>{" "}
      {done ? null : (
        <Button
          type="button"
          size="lg"
          className="mt-3"
          onClick={ask}
          disabled={asked}
          loading={status === "sending"}
          aria-describedby={noteId}
          data-ph-capture-attribute-cta="block-check-request"
        >
          {asked ? "Asked" : again ? "Ask for a new check" : "Ask us to check this block"}
        </Button>
      )}
    </div>
  );
}
