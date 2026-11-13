"use client";

/**
 * Alert email on the admin page: the daily budgets, the outbox, what went
 * out, and who follows which employer. Data from `adminDelivery.getDelivery`.
 *
 * The budget pools lead because they answer the operational question: is it
 * time to move off Resend's free plan. A pool that turned anyone away in the
 * last week says yes, loudly, at the top.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  BellIcon,
  EnvelopeSimpleIcon,
  HandPalmIcon,
  HourglassMediumIcon,
  ProhibitIcon,
  QuestionIcon,
  StackIcon,
  UsersIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { FunctionReturnType } from "convex/server";
import { formatInt } from "@/lib/format";
import { EASTERN_TIMEZONE, MS_PER_HOUR } from "@/lib/time";
import type { api } from "@convex/_generated/api";
import { between } from "./elapsed";
import { entityHref } from "@/lib/entityPayload";
import { cn } from "@/lib/utils";

export type Delivery = FunctionReturnType<typeof api.adminDelivery.getDelivery>;

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: EASTERN_TIMEZONE, timeZoneName: "short" });

function ago(ms: number): string {
  const h = Math.floor((Date.now() - ms) / MS_PER_HOUR);
  if (h < 1) return "under an hour";
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.floor(h / 24)} days`;
}

const KIND_LABEL = {
  case: "Case status",
  queue: "Queue month",
  bulletin: "Visa bulletin",
  employer: "Employer",
  match: "Possible PERM",
} as const;

const STATUS_CLASS: Record<string, string> = {
  sent: "bg-primary text-primary-foreground",
  queued: "bg-data-warn-ink text-background",
  failed: "bg-destructive text-destructive-foreground",
  dropped: "bg-muted text-foreground",
};

/**
 * The latest alerts' columns from 1024px: sent, signed up, to, what, state. Below that each alert is a short card. A
 * list and a grid, never a <table>: a table cell that may break anywhere shrinks to a letter a line beside cells that
 * can't wrap, which is how an address read on a phone.
 */
const ALERT_COLS = "lg:grid-cols-[10rem_minmax(10rem,1fr)_minmax(11rem,1.1fr)_minmax(14rem,1.5fr)_8.5rem]";

/** Every pool as a row: label, a usage bar against the ceiling, the numbers. */
export function BudgetPools({
  pools,
  queue,
  day,
}: {
  pools: Delivery["pools"];
  queue?: Delivery["confirmationQueue"];
  day?: Delivery["emailDay"];
}) {
  const refused = pools.reduce((a, p) => a + p.refusedLast7d, 0);
  const waited = pools.reduce((a, p) => a + p.queuedLast7d, 0);
  return (
    <section aria-labelledby="pools-h" className="border-2 border-border bg-card p-5 sm:p-6 shadow-hard">
      <h2 id="pools-h" className="font-heading text-xl font-bold">
        Daily email budgets
      </h2>{" "}
      {refused > 0 ? (
        <p className="mt-3 border-2 border-border bg-data-warn-ink px-4 py-3 text-base font-bold text-background">
          {`${formatInt(refused)} ${refused === 1 ? "person was" : "people were"} turned away in the last 7 days: the queue was full or a request waited more than seven days.`}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No one has been turned away in the last 7 days.</p>
      )}{" "}
      {waited > 0 ? (
        <p className="mt-2 text-sm font-bold">
          {`${formatInt(waited)} confirmation${waited === 1 ? "" : "s"} waited in the queue this week because a pool was full. The queue sends them as soon as Resend's count for the day leaves room.`}
        </p>
      ) : null}{" "}
      {day ? (
        <p className="mt-3 text-sm">
          <span className="font-bold">{`Today: ${formatInt(day.used)} of ${formatInt(day.cap)} sent.`}</span>{" "}
          {day.publicCeiling
            ? `Sign-ups and other mail anyone can set off stop at ${formatInt(day.publicCeiling)}, alerts at ${formatInt(day.listCeiling)}. The rest is kept for sign-in codes. Resend's day resets at 8 PM Eastern in summer.`
            : `List mail stops at ${formatInt(day.listCeiling)}, and the rest is kept for sign-in codes. Resend's day resets at 8 PM Eastern in summer.`}
          {day.retrying > 0
            ? ` ${formatInt(day.retrying)} failed ${day.retrying === 1 ? "email is" : "emails are"} waiting to retry${day.oldestRetryAt ? `, the oldest since ${new Date(day.oldestRetryAt).toLocaleString("en-US", { timeZone: EASTERN_TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} Eastern` : ""}.`
            : ""}
          {day.lostToday > 0 ? ` ${formatInt(day.lostToday)} given up on today.` : ""}
        </p>
      ) : null}{" "}
      {queue && queue.waiting > 0 ? (
        <p className="mt-2 border-2 border-border bg-background px-4 py-3 text-sm font-bold">
          {`${formatInt(queue.waiting)} waiting now${queue.oldestQueuedAt ? `, the oldest since ${new Date(queue.oldestQueuedAt).toLocaleString("en-US", { timeZone: EASTERN_TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} Eastern` : ""}.`}
        </p>
      ) : null}
      <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        {pools.map((p) => {
          const share = Math.min(1, p.usedLast24h / p.limit);
          const full = p.usedLast24h >= p.limit;
          return (
            <li key={p.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold">{p.label}</span>{" "}
                <span className="text-sm tabular-nums">
                  <span className="font-heading text-base font-bold">{formatInt(p.usedLast24h)}</span>
                  {` of ${formatInt(p.limit)}`}
                </span>
              </div>{" "}
              <div className="mt-1.5 h-3 w-full border-border bg-background border" role="img" aria-label={`${p.usedLast24h} of ${p.limit} used in the last 24 hours`}>
                <div className={`h-full ${full ? "bg-destructive" : "bg-foreground"}`} style={{ width: `${share * 100}%` }} />
              </div>{" "}
              {p.refusedLast7d > 0 ? (
                <p className="mt-1 text-sm font-bold text-destructive">{`${formatInt(p.refusedLast7d)} turned away this week`}</p>
              ) : null}{" "}
              {p.queuedLast7d > 0 ? (
                <p className="mt-1 text-sm">{`${formatInt(p.queuedLast7d)} queued this week`}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-muted-foreground">
        Each pool is a rolling 24-hour bound on one kind of email, counted from the same limits the senders enforce. The day&apos;s total is guarded by Resend&apos;s own count, shown above. A request either one holds back waits in a queue.
      </p>
    </section>
  );
}

/**
 * One figure in a box: the number, then what it counts.
 *
 * `inline` is for a row of three. Three boxes across a phone leave about 45px for a label, so "not confirmed" ran
 * out of its box (Nov 13 2026). With it, the boxes stack on a phone and each holds its number and label on one
 * line; from `sm` up they sit three across as before.
 */
function Figure({ icon, value, label, tone, inline }: { icon: ReactNode; value: string; label: string; tone?: "warn"; inline?: boolean }) {
  return (
    <div
      className={`border-2 border-border p-3 ${inline ? "flex items-baseline gap-3 sm:block" : ""} ${
        tone === "warn" ? "bg-data-warn-ink text-background" : "bg-background"
      }`}
    >
      <p className="font-heading text-2xl font-bold tabular-nums">{value}</p>{" "}
      <p className={`flex min-w-0 items-start gap-1.5 text-sm font-semibold ${tone === "warn" ? "" : "text-muted-foreground"}`}>
        <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 [&_svg]:size-4">
          {icon}
        </span>
        {label}
      </p>
    </div>
  );
}

export function DeliveryPanel({ data }: { data: Delivery }) {
  const w = data.outbox.last7d;
  // Read the clock once at mount; a render must not call it (react-hooks/purity).
  const [now] = useState(() => Date.now());
  const stale = data.outbox.oldestQueuedAt !== null && now - data.outbox.oldestQueuedAt > 26 * MS_PER_HOUR;
  return (
    <div className="space-y-8">
      <section aria-labelledby="outbox-h" className="border-2 border-border bg-card p-5 sm:p-6 shadow-hard">
        <h2 id="outbox-h" className="font-heading text-xl font-bold">
          Alert delivery, last 7 days
        </h2>{" "}
        <p className="mt-1 text-sm text-muted-foreground">
          {"A case's status change goes out the moment it's seen. Queue, bulletin and employer news reach a person " +
            "at most once a day: several wait in the outbox and go out together."}
        </p>{" "}
        {data.outbox.queued > 0 ? (
          <p className="mt-2 text-sm">
            {`${formatInt(data.outbox.queued)} ${data.outbox.queued === 1 ? "alert is" : "alerts are"} waiting to send. ` +
              "Each goes with the next run (7:30 AM, 1:00 PM or 6:30 PM Eastern). One whose address was already " +
              "emailed today waits for tomorrow's first run: that's the once-a-day rule, and nothing is stuck."}
          </p>
        ) : null}{" "}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Figure icon={<EnvelopeSimpleIcon weight="bold" />} value={formatInt(w.emails)} label="emails sent" />
          <Figure icon={<BellIcon weight="bold" />} value={formatInt(w.items)} label="alerts inside them" />
          <Figure icon={<StackIcon weight="bold" />} value={formatInt(w.bundles)} label="bundled emails" />
          <Figure icon={<HourglassMediumIcon weight="bold" />} value={formatInt(data.outbox.queued)} label={data.outbox.oldestQueuedAt ? `waiting, oldest ${ago(data.outbox.oldestQueuedAt)}` : "waiting"} tone={stale ? "warn" : undefined} />
          <Figure icon={<WarningIcon weight="bold" />} value={formatInt(w.failed)} label="gave up after 6 tries" tone={w.failed > 0 ? "warn" : undefined} />
          <Figure icon={<ProhibitIcon weight="bold" />} value={formatInt(w.dropped)} label="dropped by an opt-out" />
        </div>{" "}
        <p className="mt-3 text-sm">
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[])
            .map((k) => `${KIND_LABEL[k]} ${formatInt(w.byKind[k])}`)
            .join(", ")}
        </p>
      </section>{" "}

      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="font-heading text-xl font-bold">
          Latest alerts
        </h2>{" "}
        {data.recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No alert email recorded in the last 7 days. The outbox has recorded
            sends since 26 September 2026, so anything sent before that isn&apos;t
            listed here.
          </p>
        ) : (
          <>
          {(data.recentTotal ?? 0) > data.recent.length ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {`The newest ${formatInt(data.recent.length)} of ${formatInt(data.recentTotal ?? 0)} in the last 7 days.`}
            </p>
          ) : null}
          <div className="mt-3 border-2 border-border bg-card">
            <div aria-hidden="true" className={cn("hidden gap-x-4 bg-muted px-3 py-2 text-sm font-bold lg:grid", ALERT_COLS)}>
              <span>Sent</span> <span>Signed up</span> <span>To</span> <span>What</span> <span>State</span>
            </div>{" "}
            <ul className="divide-y-2 divide-border">
              {data.recent.map((r, i) => (
                <li
                  key={`${r.email}-${r.createdAt}-${i}`}
                  className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-3 py-3 text-sm lg:py-2", ALERT_COLS)}
                >
                  {/* A phone reads what was sent and its state first, then who and when. From 1024px the order is
                      the columns': sent, signed up, to, what, state. Each label is read out at every width. */}
                  <div className="order-1 min-w-0 lg:order-4">
                    <span className="font-bold [overflow-wrap:anywhere]">{`${KIND_LABEL[r.kind]}: ${r.title}`}</span>{" "}
                    <span className="block text-muted-foreground">{`${r.line} `}</span>
                    {r.lastError ? <span className="block text-destructive [overflow-wrap:anywhere]">{`${r.lastError} `}</span> : null}
                  </div>{" "}
                  <div className="order-2 justify-self-end text-right lg:order-5 lg:justify-self-start lg:text-left">
                    <span className="sr-only">State:</span>{" "}
                    <span className={`inline-block px-1.5 py-0.5 font-bold ${STATUS_CLASS[r.status] ?? ""}`}>{r.status}</span>{" "}
                    <span className="block text-muted-foreground">
                      {r.direct ? "straight out" : r.bundleSize && r.bundleSize > 1 ? `in a bundle of ${r.bundleSize}` : ""}
                    </span>
                  </div>{" "}
                  <div className="order-3 col-span-2 min-w-0 [overflow-wrap:anywhere] lg:col-span-1">
                    <span className="text-muted-foreground lg:sr-only">{"To "}</span>
                    {`${r.email} `}
                  </div>{" "}
                  <div className="order-4 col-span-2 tabular-nums lg:order-1 lg:col-span-1">
                    <span className="text-muted-foreground lg:sr-only">{"Sent "}</span>
                    {`${when(r.sentAt ?? r.createdAt)} `}
                  </div>{" "}
                  <div className="order-5 col-span-2 lg:order-2 lg:col-span-1">
                    <span className="text-muted-foreground lg:sr-only">{"Signed up "}</span>
                    {r.signedUpAt ? (
                      <>
                        <span className="tabular-nums">{when(r.signedUpAt)}</span>{" "}
                        <span className="block text-muted-foreground">
                          {`${between(r.signedUpAt, r.sentAt ?? r.createdAt)} before${r.confirmedAt ? `, confirmed after ${between(r.signedUpAt, r.confirmedAt)}` : ", never confirmed"}`}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">subscription removed</span>
                    )}{" "}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          </>
        )}
      </section>{" "}

      <section aria-labelledby="follows-h" className="border-2 border-border bg-card p-5 sm:p-6 shadow-hard">
        <h2 id="follows-h" className="font-heading text-xl font-bold">
          Employer follows
        </h2>{" "}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:max-w-md sm:grid-cols-3">
          <Figure inline icon={<UsersIcon weight="bold" />} value={formatInt(data.follows.confirmed)} label="following" />
          <Figure inline icon={<QuestionIcon weight="bold" />} value={formatInt(data.follows.pending)} label="not confirmed" />
          <Figure inline icon={<HandPalmIcon weight="bold" />} value={formatInt(data.follows.unsubscribed)} label="stopped" />
        </div>{" "}
        {(data.follows.employers ?? 0) > data.follows.top.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {`The ${formatInt(data.follows.top.length)} most-followed of ${formatInt(data.follows.employers ?? 0)} employers.`}
          </p>
        ) : null}{" "}
        {data.follows.top.length > 0 ? (
          <ol className="mt-4 divide-y divide-border border-y-2 border-border">
            {data.follows.top.map((f) => (
              <li key={f.slug} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <Link href={entityHref("employer", f.slug)} className="link min-w-0 [overflow-wrap:anywhere]">
                  {f.name}
                </Link>{" "}
                {/* The count keeps its line; a long employer name is what wraps. */}
                <span className="shrink-0 whitespace-nowrap tabular-nums">{`${formatInt(f.followers)} following`}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No one follows an employer yet. The form is on every employer page.</p>
        )}
      </section>
    </div>
  );
}
