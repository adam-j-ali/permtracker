"use client";

// `convex/react` is a CLIENT-ONLY module: its hooks reach `React.createContext`,
// which exists only in React's client build. Declared here rather
// than inherited from whichever importer happened to cross a boundary first.
// Without it this module works until the chunk graph shifts, then fails with
// `TypeError: (0 , d.createContext) is not a function` naming webpack bootstrap
// and no source file. See components/layout/Footer.tsx.

/**
 * AutoClosureAlertBanner Component
 *
 * Displays a persistent alert banner at the top of the dashboard when
 * cases have been automatically closed due to expired deadlines.
 *
 * Features:
 * - Warning/amber color scheme for urgency
 * - Expandable list for multiple alerts
 * - Individual dismiss and "Dismiss All" buttons
 * - Link to view each closed case
 *
 * @see /convex/deadlineEnforcement.ts - Backend queries/mutations
 * @see /perm_flow.md - Business rules for deadline enforcement
 */

"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowSquareOutIcon, CaretDownIcon, CaretUpIcon, WarningIcon as AlertTriangle, XIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { handleOperationError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { useAuthContext } from "@/lib/contexts/AuthContext";
import { caseTitle } from "@convex/lib/caseLabel";

/**
 * Format closure reason for display.
 */
function formatClosureReason(reason: string): string {
  switch (reason) {
    case "pwd_expired":
      return "PWD expired";
    case "recruitment_window_missed":
      return "Recruitment window missed";
    case "filing_window_missed":
      return "Filing window missed";
    case "eta9089_expired":
      return "ETA 9089 expired";
    default:
      return "Deadline missed";
  }
}

/**
 * Format relative time for display.
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AutoClosureAlertBanner() {
  const { isSigningOut } = useAuthContext();
  const [isExpanded, setIsExpanded] = useState(false);
  // The dismiss under way ("all" or one alert's id), so a click shows it's working and can't be sent twice.
  const [busy, setBusy] = useState<string | null>(null);

  // Fetch auto-closure alerts
  const alerts = useQuery(
    api.deadlineEnforcement.getAutoClosureAlerts,
    isSigningOut ? "skip" : undefined
  );

  // Mutations for dismissing alerts
  const dismissOne = useMutation(api.deadlineEnforcement.dismissAutoClosureAlert);
  const dismissAll = useMutation(api.deadlineEnforcement.dismissAllAutoClosureAlerts);
  const reopen = useMutation(api.cases.reopenCase);

  // Don’t render if no alerts or still loading
  if (!alerts || alerts.length === 0) {
    return null;
  }

  // Reopen the case, then clear its alert: the closure it reports is undone.
  const handleReopen = async (caseId: Id<"cases">, notificationId: Id<"notifications">) => {
    if (busy) return;
    setBusy(notificationId);
    try {
      await reopen({ id: caseId });
      await dismissOne({ notificationId });
      toast.success("Case reopened");
    } catch (error) {
      handleOperationError(error, {
        userMessage: "Couldn’t reopen the case. Try again.",
        context: { operation: "reopenFromClosureAlert" },
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDismissOne = async (notificationId: Id<"notifications">) => {
    if (busy) return;
    setBusy(notificationId);
    try {
      await dismissOne({ notificationId });
    } catch (error) {
      handleOperationError(error, {
        userMessage: "Couldn’t dismiss the alert. Try again.",
        context: { operation: "dismissAutoClosureAlert" },
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDismissAll = async () => {
    if (busy) return;
    setBusy("all");
    try {
      await dismissAll({});
    } catch (error) {
      handleOperationError(error, {
        userMessage: "Couldn’t dismiss the alerts. Try again.",
        context: { operation: "dismissAllAutoClosureAlerts" },
      });
    } finally {
      setBusy(null);
    }
  };

  const showExpander = alerts.length > 1;
  const visibleAlerts = isExpanded ? alerts : alerts.slice(0, 1);

  return (
    <div
      className="mb-6 bg-data-warn/15 border-2 border-data-warn p-4 relative"
      role="alert"
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-data-warn-ink" />
          <h3 className="font-heading font-bold text-data-warn-ink">
            {alerts.length === 1
              ? "1 case closed automatically"
              : `${alerts.length} cases closed automatically`}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {alerts.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismissAll}
              disabled={busy !== null}
              aria-busy={busy === "all"}
              className="text-data-warn-ink hover:text-data-warn-ink text-sm"
            >
              {busy === "all" ? "Dismissing…" : "Dismiss all"}
            </Button>
          )}

          {showExpander && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-data-warn-ink p-1"
              aria-label={isExpanded ? "Collapse alerts" : "Expand alerts"}
            >
              {isExpanded ? (
                <CaretUpIcon className="w-4 h-4" />
              ) : (
                <CaretDownIcon className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Alert list */}
      <ul className="space-y-2">
        {visibleAlerts.map((alert) => {
          // A person's own case may carry no employer or job title (convex/lib/caseLabel.ts).
          const name = caseTitle(alert);
          const label = alert.positionTitle ? `${name} - ${alert.positionTitle}` : name;
          return (
          <li
            key={alert.notificationId}
            className="flex items-center justify-between bg-background border-2 border-data-warn p-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-data-warn-ink truncate" title={name}>
                  {name}
                </span>{" "}
                {alert.positionTitle ? (
                  <span className="text-data-warn-ink text-sm truncate" title={alert.positionTitle}>
                    - {alert.positionTitle}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm text-data-warn-ink">
                <span className="inline-flex items-center px-2 py-0.5 bg-data-warn/15 text-data-warn-ink text-sm font-medium">
                  {formatClosureReason(alert.closureReason)}
                </span>{" "}
                <span className="text-sm text-data-warn-ink">
                  {formatTimeAgo(alert.createdAt)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 ml-2">
              {alert.caseId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={busy !== null}
                  onClick={() => handleReopen(alert.caseId!, alert.notificationId)}
                  aria-label={`Reopen ${label}`}
                >
                  Reopen
                </Button>
              )}{" "}
              {alert.caseId && (
                <Link
                  href={`/cases/${alert.caseId}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-data-warn-ink transition-colors"
                  title="View case"
                  aria-label={`View ${label}`}
                >
                  <ArrowSquareOutIcon className="w-4 h-4" aria-hidden="true" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => handleDismissOne(alert.notificationId)}
                disabled={busy !== null}
                aria-busy={busy === alert.notificationId}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-data-warn-ink transition-colors disabled:opacity-50"
                title="Dismiss alert"
                aria-label={`Dismiss alert for ${label}`}
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
          </li>
          );
        })}
      </ul>

      {/* Collapsed indicator */}
      {!isExpanded && alerts.length > 1 && (
        <button
          onClick={() => setIsExpanded(true)}
          className="mt-2 text-sm text-data-warn-ink hover:text-data-warn-ink underline"
        >
          +{alerts.length - 1} more {alerts.length === 2 ? "case" : "cases"}
        </button>
      )}
    </div>
  );
}
