"use client";

/**
 * CalendarEvent
 *
 * A deadline on the calendar as a quiet pill: the stage's colour on its left
 * edge and in a faint wash, a red mark when it's urgent, and a case summary on
 * hover (the app's own Radix tooltip). A click opens the case.
 */

import { forwardRef } from "react";
import type { EventProps } from "react-big-calendar";
import Link from "next/link";

import { type CalendarEvent as CalendarEventType, STAGE_COLORS } from "@/lib/calendar/types";
import { formatCaseStatus } from "@convex/lib/notificationHelpers";
import { countdownWords } from "@/components/cases/case-card.utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CalendarEventProps extends EventProps<CalendarEventType> {
  event: CalendarEventType;
}

const isUrgent = (e: CalendarEventType) => e.urgency === "urgent" || e.urgency === "overdue";

/** The hover summary: the case, its progress and stage, the deadline. */
function CaseSummary({ event }: { event: CalendarEventType }) {
  return (
    <div className="w-72">
      <div className="border-b border-border px-3 py-2">
        <p className="truncate font-heading text-sm font-bold" title={event.employerName || undefined}>
          {event.employerName || "Unknown employer"}
        </p>{" "}
        {event.positionTitle ? (
          <p className="truncate text-sm text-muted-foreground" title={event.positionTitle}>
            {event.positionTitle}
          </p>
        ) : null}
      </div>
      <dl className="space-y-1 px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Stage</dt>{" "}
          <dd className="font-semibold">{formatCaseStatus(event.stage)}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted px-3 py-2">
        <span className="text-sm font-semibold">{event.title.split(":")[0]}</span>{" "}
        <span
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            isUrgent(event) ? "text-destructive" : event.urgency === "soon" ? "text-data-warn-ink" : "text-foreground",
          )}
        >
          {countdownWords(event.daysUntil)}
        </span>
      </div>
    </div>
  );
}

interface EventPillProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  /** The stage's colour, drawn on the pill's left edge and in its wash. */
  color: string;
  urgent: boolean;
  title: string;
}

/** A link to the case, so a keyboard reaches it (the grid's own event box takes no focus) and it opens in a new tab. */
const EventPill = forwardRef<HTMLAnchorElement, EventPillProps>(({ href, color, urgent, title, style, className, ...rest }, ref) => (
  <Link
    ref={ref}
    href={href}
    className={cn("calendar-event focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary", className)}
    style={{ ...style, ["--event-color" as string]: color }}
    {...rest}
  >
    {urgent ? <span aria-hidden="true" className="size-2 shrink-0 bg-destructive" /> : null}
    <span className="event-title">{title}</span>
  </Link>
));
EventPill.displayName = "EventPill";

export function CalendarEvent({ event }: CalendarEventProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <EventPill
            href={`/cases/${event.caseId}`}
            color={STAGE_COLORS[event.stage] ?? "var(--muted-foreground)"}
            urgent={isUrgent(event)}
            title={event.title}
            aria-label={`${event.title}, ${countdownWords(event.daysUntil)}`}
            // The grid's own handlers would also select the event; the link alone opens the case.
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} collisionPadding={10} className="overflow-hidden p-0 shadow-hard">
          <CaseSummary event={event} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
