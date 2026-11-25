"use client";

/**
 * The dashboard's deadlines: one sentence naming the next one (or the late
 * ones), then every deadline in four groups by when it falls. Convex keeps
 * the query live, so the list is always current.
 *
 * @see perm_flow.md (Deadlines/Windows section)
 */

import { type ReactNode } from "react";
import { useQuery } from "convex/react";
import { CurrencyDollarIcon, FileTextIcon, MegaphoneIcon, StampIcon } from "@phosphor-icons/react";

import { api } from "@convex/_generated/api";
import type { DeadlineGroups, DeadlineItem } from "@convex/lib/dashboardTypes";
import { useAuthContext } from "@/lib/contexts/AuthContext";
import { countdownWords, formatDeadlineDate } from "@/components/cases/case-card.utils";
import { Skeleton } from "@/components/ui/skeleton";
import AddCaseButton from "./AddCaseButton";
import UrgencyGroup from "./UrgencyGroup";
import { WidgetHeader, WidgetLink } from "./widget-primitives";
import { caseTitle } from "@convex/lib/caseLabel";

const GROUPS = [
  { key: "overdue", title: "Overdue" },
  { key: "thisWeek", title: "This week" },
  { key: "thisMonth", title: "This month" },
  { key: "later", title: "Later" },
] as const;

/**
 * Open cases are the ones still on their way to a green card: every stage
 * from the PWD to the I-485 or the consulate. A complete case (the card
 * arrived) and a closed one are done. The two counts past the I-140 read as
 * zero from a server that doesn't send them yet, so the page never breaks
 * while the site and the server are on different releases.
 */
export function openCaseCount(
  summary:
    | (Record<"pwd" | "recruitment" | "eta9089" | "i140", { count: number }> &
        Partial<Record<"i485" | "consular", { count: number }>>)
    | undefined,
): number | undefined {
  if (summary === undefined) return undefined;
  return (
    summary.pwd.count +
    summary.recruitment.count +
    summary.eta9089.count +
    summary.i140.count +
    (summary.i485?.count || 0) +
    (summary.consular?.count || 0)
  );
}

function soonest(items: readonly DeadlineItem[]): DeadlineItem | undefined {
  return items.reduce<DeadlineItem | undefined>((a, b) => (a === undefined || b.daysUntil < a.daysUntil ? b : a), undefined);
}

/** A deadline's case as the lead sentence names it: the employer, else the person, else "your case". */
const whose = (d: DeadlineItem) => caseTitle({ employerName: d.employerName, beneficiaryIdentifier: d.beneficiaryName }, "your case");

/** The one sentence the dashboard leads with. */
export function deadlineAnswer(data: Pick<DeadlineGroups, "overdue" | "thisWeek" | "thisMonth" | "later">, openCases: number | undefined): string {
  const late = data.overdue.length;
  const next = soonest([...data.thisWeek, ...data.thisMonth, ...data.later]);
  const nextLine = next
    ? `Next: ${next.label} for ${whose(next)}, ${formatDeadlineDate(next.dueDate)} (${countdownWords(next.daysUntil).toLowerCase()}).`
    : "";
  if (late > 0) {
    const first = soonest(data.overdue)!;
    const lead = `${late} ${late === 1 ? "deadline is" : "deadlines are"} late, the earliest ${first.label} for ${whose(first)}.`;
    return next ? `${lead} ${nextLine}` : lead;
  }
  if (next) return nextLine;
  if (openCases !== undefined && openCases > 0) {
    return `Nothing is due on your ${openCases.toLocaleString("en-US")} open ${openCases === 1 ? "case" : "cases"}. Deadlines appear as you add dates.`;
  }
  return "Add a case and its deadlines appear here, worked out from its dates.";
}

/** The four deadlines the app works out from a case's dates, shown to an account with no case yet. */
const DEADLINE_KINDS = [
  { Icon: CurrencyDollarIcon, name: "Wage determination", what: "The day it expires, so the filing still falls inside it." },
  { Icon: MegaphoneIcon, name: "Recruitment", what: "When the ads must run, and when the 30-day wait after the last one ends." },
  {
    Icon: FileTextIcon,
    name: "ETA-9089 filing window",
    what: "Opens 30 days after the last ad. Closes 180 days after the first, or sooner when the wage determination expires first.",
  },
  { Icon: StampIcon, name: "I-140", what: "The last day to file before the certified ETA-9089 expires." },
] as const;

/** An account with no case: what the board will hold, and the way to start it. */
function NoCasesPanel(): ReactNode {
  return (
    <div className="mt-5 grid grid-cols-1 gap-5 border-2 border-border bg-tint p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
      <div className="min-w-0">
        <p className="font-heading text-xl font-bold">Your first case fills this board</p>{" "}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Type in the dates you have. Every deadline that follows from them lands here, sorted by how soon it falls, and
          moves when a date changes.
        </p>{" "}
        <div className="mt-4">
          <AddCaseButton />
        </div>
      </div>{" "}
      <ul aria-label="Deadlines worked out for each case" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {DEADLINE_KINDS.map(({ Icon, name, what }) => (
          <li key={name} className="flex min-w-0 gap-3 border-2 border-border bg-card p-3">
            <Icon aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-primary-text" weight="duotone" />{" "}
            <span className="min-w-0">
              <span className="block font-semibold">{name}</span>{" "}
              <span className="block text-sm text-muted-foreground">{what}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DeadlineHeroLoadingSkeleton(): ReactNode {
  return (
    <section className="object" aria-busy={true} aria-label="Deadlines">
      <WidgetHeader title="Deadlines" />
      <div className="p-5">
        <Skeleton variant="line" className="h-7 w-full max-w-xl" />
        <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-4">
          {GROUPS.map((g) => (
            <div key={g.key}>
              <Skeleton variant="line" className="h-6 w-28" />
              <Skeleton variant="block" className="mt-3 h-14" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function DeadlineHeroWidget(): ReactNode {
  const { isSigningOut } = useAuthContext();
  const data = useQuery(api.dashboard.getDeadlines, isSigningOut ? "skip" : undefined);
  // The dashboard reads the summary with these arguments too, so this shares
  // its subscription.
  const summary = useQuery(api.dashboard.getSummary, isSigningOut ? "skip" : undefined);

  if (data === undefined) return <DeadlineHeroLoadingSkeleton />;

  const total = data.overdue.length + data.thisWeek.length + data.thisMonth.length + data.later.length;
  const openCases = openCaseCount(summary);
  const noCases = total === 0 && openCases === 0;

  return (
    <section
      id="deadlines"
      data-tour="deadline-hero"
      aria-labelledby="deadlines-title"
      className="object"
    >
      {data.overdue.length > 0 ? (
        <div data-testid="deadlines-late-strip" aria-hidden="true" className="h-1.5 bg-destructive" />
      ) : null}
      <WidgetHeader id="deadlines-title" title="Deadlines" count={total} action={<WidgetLink href="/calendar">Calendar</WidgetLink>} />
      <div className="p-5">
        <p className="text-base font-semibold sm:text-lg">{deadlineAnswer(data, openCases)}</p>
        {noCases ? (
          <NoCasesPanel />
        ) : (
          // Each group as tall as its own deadlines: stretched to its neighbour's
          // height, a short group read as a tall empty wash. With nothing due
          // anywhere, the four zeros stay on the board, two by two on a phone.
          <div
            className={
              total > 0
                ? "mt-5 grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-4"
                : "mt-5 grid grid-cols-2 items-start gap-3 xl:grid-cols-4"
            }
          >
            {GROUPS.map((g) => (
              <UrgencyGroup key={g.key} title={g.title} urgency={g.key} items={data[g.key]} keepWhenEmpty={total === 0} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
