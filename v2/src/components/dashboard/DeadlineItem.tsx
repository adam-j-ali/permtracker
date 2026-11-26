"use client";

import type { DeadlineItem as DeadlineItemType } from "@convex/lib/dashboardTypes";
import { countdownWords, formatDeadlineDate } from "@/components/cases/case-card.utils";
import { WidgetRow } from "./widget-primitives";
import { caseTitle } from "@convex/lib/caseLabel";

/**
 * One deadline: the employer, what's due and the role, then how long until
 * it and the date. The whole row opens the case.
 */
export default function DeadlineItem({ deadline }: { deadline: DeadlineItemType }) {
  const overdue = deadline.urgency === "overdue";
  // A person's own case may carry no employer: the person names it then (convex/lib/caseLabel.ts).
  const named = Boolean(deadline.employerName.trim());
  const role = named ? deadline.positionTitle || deadline.beneficiaryName : deadline.positionTitle;
  return (
    <WidgetRow
      href={`/cases/${deadline.caseId}`}
      title={caseTitle({ employerName: deadline.employerName, beneficiaryIdentifier: deadline.beneficiaryName })}
      detail={role ? `${deadline.label}, ${role}` : deadline.label}
      aside={countdownWords(deadline.daysUntil)}
      asideClassName={overdue ? "text-destructive" : undefined}
      asideDetail={formatDeadlineDate(deadline.dueDate)}
      testId="deadline-item"
    />
  );
}
