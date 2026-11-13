"use client";

/**
 * Timelines people shared, waiting for the owner, and the decided ones (convex/communityTimelines.ts). Approve
 * puts a timeline into the medians, and into the lists if its author asked; decline keeps it off every page. A
 * timeline holds only dates and picks from fixed lists, so the check is whether the dates can be right, and the
 * panel prints what sits oddly (`flags`) beside each one.
 *
 * Three lists: waiting (oldest first), approved timelines their authors changed since (still showing; "Looks
 * fine" clears the mark), and the newest decided.
 *
 * SECURITY: rows carry PERM case numbers; admin page only.
 */

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DECLINE_REASONS, type DeclineReasonId } from "@convex/lib/communityTimeline";
import { Skeleton } from "@/components/ui/skeleton";
import { shortDate } from "@convex/lib/months";

export type TimelinesData = FunctionReturnType<typeof api.communityTimelines.listForAdmin>;
type Row = TimelinesData["waiting"][number];

const BTN =
  "inline-flex min-h-[44px] items-center border-2 border-border px-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:text-muted-foreground";

function when(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

const day = (iso: string) => shortDate(iso) ?? iso;

function standing(r: Row): string {
  if (r.hidden) return "Hidden";
  if (r.status === "pending") return "Waiting";
  if (r.status === "declined") return "Declined";
  return r.shared ? "Showing, in the lists too" : "Counted in the medians only";
}

function TimelineCard({ r }: { r: Row }) {
  const approve = useMutation(api.communityTimelines.approve);
  const decline = useMutation(api.communityTimelines.decline);
  const keepEdit = useMutation(api.communityTimelines.keepEdit);
  const hide = useMutation(api.communityTimelines.hideByAdmin);
  const remove = useMutation(api.communityTimelines.removeByAdmin);
  const [choosing, setChoosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setChoosing(false);
      setDeleting(false);
    } catch (e) {
      setError(e instanceof ConvexError ? String(e.data) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const id = r._id as Id<"communityTimelines">;
  const about = [r.office ?? "No office given", r.category, r.country, r.route === "consular" ? "consular" : null, r.premium ? "premium I-140" : null]
    .filter(Boolean)
    .join(", ");
  return (
    <li className="border-2 border-border bg-card p-4 shadow-hard-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-heading text-lg font-bold">{about}</span>{" "}
        <span className="text-sm font-bold">{`${standing(r)}${r.edited ? ", changed since you approved it" : ""}`}</span>
      </div>{" "}
      {r.flags.length > 0 ? (
        <ul className="mt-2 border-2 border-dashed border-border p-3 text-sm font-bold">
          {r.flags.map((f) => (
            <li key={f}>{`Check: ${f} `}</li>
          ))}
        </ul>
      ) : null}{" "}
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr] [&>*]:min-w-0">
        {r.dates.map((d) => (
          <div key={d.label} className="contents">
            <dt className="font-bold">{`${d.label}${d.verified ? " (DOL's record)" : ""}`}</dt> <dd className="tabular-nums">{day(d.on)}</dd>{" "}
          </div>
        ))}
        {r.rfe ? (
          <>
            <dt className="font-bold">RFE</dt> <dd>{r.rfe}</dd>{" "}
          </>
        ) : null}
        <dt className="font-bold">PERM case</dt> <dd className="[overflow-wrap:anywhere]">{r.caseNumber ? `${r.caseNumber} (only you see this)` : "None given"}</dd>{" "}
        <dt className="font-bold">Saved</dt>{" "}
        <dd>{`${when(r.createdAt)}${r.updatedAt !== r.createdAt ? `, changed ${when(r.updatedAt)}` : ""}${r.shared ? ", asked to be listed" : ", medians only"}`}</dd>{" "}
        {r.reviewedAt ? (
          <>
            <dt className="font-bold">Decided</dt> <dd>{`${when(r.reviewedAt)}${r.declineReason ? `: ${r.declineReason}` : ""}`}</dd>{" "}
          </>
        ) : null}
      </dl>{" "}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status !== "approved" ? (
          <button type="button" disabled={busy} onClick={() => run(() => approve({ id }))} className={`${BTN} bg-primary text-primary-foreground`}>
            Approve and show
          </button>
        ) : null}{" "}
        {r.edited ? (
          <button type="button" disabled={busy} onClick={() => run(() => keepEdit({ id }))} className={`${BTN} bg-primary text-primary-foreground`}>
            Looks fine
          </button>
        ) : null}{" "}
        {r.status !== "declined" && !choosing ? (
          <button type="button" disabled={busy} onClick={() => setChoosing(true)} className={`${BTN} bg-background`}>
            {r.status === "approved" ? "Take it down" : "Decline"}
          </button>
        ) : null}{" "}
        {r.status === "approved" ? (
          <button type="button" disabled={busy} onClick={() => run(() => hide({ id, hidden: !r.hidden }))} className={`${BTN} bg-background`}>
            {r.hidden ? "Show it again" : "Hide it for now"}
          </button>
        ) : null}{" "}
        {!deleting ? (
          <button type="button" disabled={busy} onClick={() => setDeleting(true)} className={`${BTN} bg-background`}>
            Delete for good
          </button>
        ) : null}
      </div>{" "}
      {choosing ? (
        <div className="mt-3">
          <p className="text-sm font-bold">Why? The author still sees their timeline, with a note that its dates didn&apos;t look right.</p>{" "}
          <div className="mt-2 flex flex-wrap gap-2">
            {DECLINE_REASONS.map((x) => (
              <button key={x.id} type="button" disabled={busy} onClick={() => run(() => decline({ id, reason: x.id as DeclineReasonId }))} className={`${BTN} bg-background`}>
                {x.label}
              </button>
            ))}{" "}
            <button type="button" disabled={busy} onClick={() => setChoosing(false)} className={`${BTN} bg-background`}>
              Never mind
            </button>
          </div>
        </div>
      ) : null}{" "}
      {deleting ? (
        <div className="mt-3">
          <p className="text-sm font-bold">Delete this timeline for good? Use it when its author asks, or for a test. Declining keeps it for them to fix.</p>{" "}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => run(() => remove({ id }))} className={`${BTN} bg-background`}>
              Yes, delete it
            </button>{" "}
            <button type="button" disabled={busy} onClick={() => setDeleting(false)} className={`${BTN} bg-background`}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}{" "}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-bold">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function Group({ title, note, rows, empty }: { title: string; note: string; rows: Row[]; empty: string }) {
  return (
    <section>
      <h3 className="font-heading text-xl font-bold">{`${title} (${rows.length})`}</h3>{" "}
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{note}</p>{" "}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm">{empty}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3">
          {rows.map((r) => (
            <TimelineCard key={r._id} r={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function TimelinesPanel({ data }: { data: TimelinesData | undefined }) {
  if (!data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-10">
      <Group
        title="Waiting for you"
        note="Nothing here shows on the site until you approve it. A timeline is only dates and picks from fixed lists, so check that the dates can be right."
        rows={data.waiting}
        empty="Nothing is waiting."
      />
      <Group
        title="Changed since you approved"
        note="These still show. Their authors edited them after your yes, so each gets a second look."
        rows={data.edited}
        empty="No approved timeline has changed."
      />
      <Group title="Decided" note="The newest hundred, approved and declined." rows={data.decided} empty="None yet." />
    </div>
  );
}

/** How many timelines need the owner: the tab's badge. */
export const timelinesWaiting = (data: TimelinesData | undefined): number => (data ? data.waiting.length + data.edited.length : 0);
