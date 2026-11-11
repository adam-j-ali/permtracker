
"use client";

import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowSquareOutIcon, CalendarIcon as CalendarIcon, InfoIcon, PlusIcon } from "@phosphor-icons/react";

import { api } from "@convex/_generated/api";
import { currentPage, loginHrefFor } from "@/lib/auth/returnTo";
import { caseToCalendarEvents } from "@/lib/calendar/event-mapper";
import { RECORDED_EVENT_TYPES, type DeadlineType } from "@/lib/calendar/types";
import { toCalendarCaseData } from "@/lib/calendar/fromQuery";
import { Skeleton } from "@/components/ui/skeleton";
import { useKeptWhileLoading } from "@/hooks/useKeptWhileLoading";
import { Button } from "@/components/ui/button";
import { CalendarView, type CaseDataMap, CalendarFilters } from "@/components/calendar";
import type { CaseForSelection } from "@/components/timeline";
import { PageHeading } from "../components/PageHeading";
import { CaseCapNotice } from "@/components/cases/CaseCapNotice";
import { handleOperationError } from "@/lib/errors";

// The event pill and the react-big-calendar theming
import "@/app/calendar.css";

// ============================================================================
// Loading Skeleton
// ============================================================================

/**
 * The calendar while its events load, in the page's own order: heading, the
 * filter row, then the calendar (a grid from md, the list below it, as the
 * real view switches). Shared with calendar/loading.tsx, which used to draw
 * its own version, so a click showed two skeletons before the page.
 */
export function CalendarSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy={true}>
      {/* Header: the real title; only the count under it waits. */}
      <div className="mb-4">
        <PageHeading
          meta={<Skeleton as="span" variant="line" className="inline-block h-4 w-56 align-middle" />}
          title="Calendar"
        />
      </div>

      {/* Filter row: the real one is a bordered box around a row of 44px
          controls, 80px in all (measured on production, Sep 30 2026). */}
      <div className="mb-4 bg-tint p-4 border-2 border-border">
        <Skeleton variant="block" className="h-11" />
      </div>

      {/* Phones get the list view, as the real calendar does. */}
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} variant="block" className="h-16" />
        ))}
      </div>

      <div className="hidden min-h-[870px] flex-col md:flex">

      {/* Toolbar skeleton */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Skeleton variant="block" className="w-20 h-10" />
          <Skeleton variant="block" className="w-24 h-10" />
          <Skeleton variant="block" className="w-20 h-10" />
        </div>
        <Skeleton variant="line" className="w-40 h-8" />
        <div className="flex items-center gap-2">
          <Skeleton variant="block" className="w-20 h-10" />
          <Skeleton variant="block" className="w-20 h-10" />
          <Skeleton variant="block" className="w-20 h-10" />
        </div>
      </div>

      {/* Calendar grid skeleton, the real calendar's 700px minimum */}
      <div className="min-h-[700px] flex-1 border-border bg-card border">
        {/* Month header row */}
        <div className="grid grid-cols-7 border-b-2 border-border bg-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div
              key={day}
              className="p-3 text-center border-r border-border last:border-r-0"
            >
              <Skeleton variant="line" className="w-8 h-5 mx-auto" />
            </div>
          ))}
        </div>

        {/* Calendar weeks */}
        {Array.from({ length: 5 }).map((_, weekIndex) => (
          <div
            key={weekIndex}
            className="grid grid-cols-7 border-b border-border last:border-b-0"
          >
            {Array.from({ length: 7 }).map((_, dayIndex) => (
              <div
                key={dayIndex}
                className="min-h-24 p-2 border-r border-border last:border-r-0"
              >
                <Skeleton variant="line" className="w-6 h-5 mb-2" />
                {/* Random event placeholders */}
                {(weekIndex + dayIndex) % 3 === 0 && (
                  <Skeleton variant="block" className="w-full h-6 mb-1" />
                )}
                {(weekIndex + dayIndex) % 5 === 0 && (
                  <Skeleton variant="block" className="w-full h-6" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

// ============================================================================
// Nothing to draw
// ============================================================================

/**
 * What takes the calendar's place when there's nothing to draw. The heading and
 * the filter row stay above it, because the way back from "everything hidden"
 * or "every case closed" is a control in that row.
 */
function NothingToShow({
  title,
  line,
  children,
}: {
  title: string;
  line: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-tint px-4 py-16 border-2 shadow-hard border-border">
      <div className="max-w-md text-center">
        <div className="mb-4 inline-block bg-background p-4 border-2 shadow-hard border-border">
          <CalendarIcon className="size-12 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="mb-2 font-heading text-xl font-semibold">{title}</h2>{" "}
        <p className="mb-6 text-muted-foreground">{line}</p>{" "}
        <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CalendarPageClient() {
  const router = useRouter();

  // State for visibility toggles (control query params)
  const [showCompleted, setShowCompleted] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  // Query calendar events (cases with deadline fields)
  // Ticking "show completed" or "show closed" asks again; the calendar keeps its events, dimmed, until the
  // new answer lands, where it had gone back to the whole loading screen.
  const { value: calendarCases, refreshing } = useKeptWhileLoading(
    useQuery(api.calendar.getCalendarEvents, {
      showCompleted,
      showClosed,
    }),
  );

  // Query user's calendar preferences (hidden cases/deadline types)
  const preferences = useQuery(api.calendar.getCalendarPreferences);
  const showEverything = useMutation(api.calendar.updateCalendarPreferences);

  // Query user profile to check Google Calendar connection status
  const userProfile = useQuery(api.users.currentUserProfile);
  const isGoogleConnected = userProfile?.googleCalendarConnected ?? false;

  // Transform cases for case selection modal (all cases, not filtered)
  const allCasesForSelection: CaseForSelection[] = useMemo(() => {
    if (!calendarCases) return [];
    return calendarCases.map((c, index) => ({
      _id: String(c.id),
      employerName: c.employerName,
      positionTitle: c.positionTitle,
      caseStatus: c.caseStatus,
      progressStatus: c.progressStatus,
      createdAt: index, // Not available in calendar query, use index as stable fallback for sorting
    }));
  }, [calendarCases]);

  // Transform cases to calendar events and apply filters
  const { events, caseDataMap } = useMemo(() => {
    if (!calendarCases || !preferences)
      return { events: [], caseDataMap: new Map() };

    // Filter out hidden cases
    const hiddenCaseIds = new Set(preferences.hiddenCases.map(String));
    const hiddenTypes = new Set(preferences.hiddenDeadlineTypes);

    // Build case data map for popover display
    const dataMap: CaseDataMap = new Map();

    // Transform each case to calendar events
    const allEvents = calendarCases.flatMap((caseData) => {
      // Skip hidden cases
      if (hiddenCaseIds.has(String(caseData.id))) {
        return [];
      }

      // Add to case data map for popover
      dataMap.set(caseData.id, {
        employerName: caseData.employerName,
        beneficiaryIdentifier: caseData.beneficiaryIdentifier,
        positionTitle: caseData.positionTitle,
        caseStatus: caseData.caseStatus,
      });

      // Every field the row carries, as the event mapper reads it
      const calendarCaseData = toCalendarCaseData(caseData);

      return caseToCalendarEvents(calendarCaseData);
    });

    // Filter out hidden deadline types
    const filteredEvents = allEvents.filter(
      (event) => !hiddenTypes.has(event.deadlineType)
    );

    return { events: filteredEvents, caseDataMap: dataMap };
  }, [calendarCases, preferences]);

  // The header counts deadlines only; recorded dates (a filed PWD, a placed
  // ad) sit on the calendar too but are not something still to meet.
  const openDeadlines = events.filter((e) => !RECORDED_EVENT_TYPES.has(e.deadlineType)).length;

  // Redirect to login if not authenticated (in useEffect to avoid setState during render)
  // useQuery returns null when auth fails, undefined while loading
  useEffect(() => {
    if (calendarCases === null || preferences === null) {
      router.push(loginHrefFor(currentPage()));
    }
  }, [calendarCases, preferences, router]);

  // Don’t render while redirecting or checking auth
  if (calendarCases === null || preferences === null) {
    return null;
  }

  // Loading state
  if (calendarCases === undefined || preferences === undefined) {
    return <CalendarSkeleton />;
  }

  // What's hidden by the person's own choices, which "Show everything" clears.
  const somethingHidden = preferences.hiddenCases.length > 0 || preferences.hiddenDeadlineTypes.length > 0;
  const showingAll = showCompleted && showClosed;

  return (
    <div
      data-tour="calendar-view"
      className="flex flex-col h-full"
    >
      <CaseCapNotice className="mb-4" />

      {/* Google Calendar Connection Banner - shown when not connected, and only once the profile has loaded:
          a connected account had briefly been asked to connect (owner, Nov 2 2026). */}
      {userProfile !== undefined && !isGoogleConnected && (
        <div className="mb-4 flex items-center justify-between gap-4 bg-tint px-4 py-3">
          <div className="flex items-center gap-3">
            <InfoIcon className="size-5 shrink-0 text-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Sync deadlines to Google Calendar
              </p>{" "}
              <p className="text-sm text-muted-foreground">
                Connect your Google Calendar to automatically sync case deadlines
              </p>
            </div>
          </div>
          <Link
            href="/settings?tab=calendar-sync"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 bg-primary px-3 text-sm font-semibold text-primary-foreground transition-[color,background-color,border-color,box-shadow,transform] hover:bg-primary/90 border-2 motion-safe:hover:-translate-x-0.5 motion-safe:hover:-translate-y-0.5 border-border"
          >
            Connect
            <ArrowSquareOutIcon className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="mb-4">
        <PageHeading
          meta={`${openDeadlines} deadline${openDeadlines !== 1 ? "s" : ""} across ${calendarCases.length} case${calendarCases.length !== 1 ? "s" : ""}`}
          title="Calendar"
        />
      </div>

      {/* Filters */}
      <div className="mb-4">
        <CalendarFilters
          allCases={allCasesForSelection}
          hiddenCases={preferences.hiddenCases}
          hiddenDeadlineTypes={preferences.hiddenDeadlineTypes as DeadlineType[]}
          showCompleted={showCompleted}
          onShowCompletedChange={setShowCompleted}
          showClosed={showClosed}
          onShowClosedChange={setShowClosed}
        />
      </div>

      {/* Calendar, or what to do when there's nothing on it */}
      {calendarCases.length === 0 ? (
        showingAll ? (
          <NothingToShow title="No cases yet" line="Add a case with its dates and each deadline appears here, coloured by stage.">
            <Button onClick={() => router.push("/cases/new")}>
              <PlusIcon className="mr-2 size-4" aria-hidden="true" />
              Add your first case
            </Button>
          </NothingToShow>
        ) : (
          <NothingToShow
            title="No open deadlines"
            line="No open case has a deadline to show. Closed and completed cases are left out until you ask for them."
          >
            <Button
              onClick={() => {
                setShowCompleted(true);
                setShowClosed(true);
              }}
            >
              Show closed and completed cases
            </Button>{" "}
            <Button variant="outline" onClick={() => router.push("/cases/new")}>
              <PlusIcon className="mr-2 size-4" aria-hidden="true" />
              Add a case
            </Button>
          </NothingToShow>
        )
      ) : events.length === 0 ? (
        somethingHidden ? (
          <NothingToShow title="Everything is hidden" line="Every case or deadline type on this calendar is switched off in the filters above.">
            <Button
              onClick={() => {
                void showEverything({ hiddenCases: [], hiddenDeadlineTypes: [] }).catch((error: unknown) =>
                  handleOperationError(error, { userMessage: "Couldn’t change the filters. Try again." }),
                );
              }}
            >
              Show everything
            </Button>
          </NothingToShow>
        ) : (
          <NothingToShow title="No dates yet" line="These cases have no milestone dates. Add dates to a case and its deadlines appear here.">
            <Button onClick={() => router.push("/cases")}>Open your cases</Button>
          </NothingToShow>
        )
      ) : (
        <div className={refreshing ? "flex-1 opacity-60 transition-opacity" : "flex-1"} aria-busy={refreshing}>
          <CalendarView
            events={events}
            defaultView="month"
            caseDataMap={caseDataMap}
            hiddenCases={preferences.hiddenCases}
          />
        </div>
      )}
    </div>
  );
}
