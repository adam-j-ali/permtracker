/**
 * Notification Helper Functions
 *
 * Pure helper functions for generating notification content, calculating priority,
 * and determining when notifications should be sent.
 *
 * All functions are testable without database dependencies.
 *
 * @see /perm_flow.md - Source of truth for PERM workflow
 * @see ./deadlineEnforcementHelpers.ts - Related deadline enforcement logic
 * @see ../schema.ts - Notification schema definition
 * @module
 */

import {
  generateClosureTitle,
  type DeadlineViolation,
} from "./deadlineEnforcementHelpers";
import { DEFAULT_NOTIFICATION_PREFS, DEFAULT_URGENT_DAYS } from "./userDefaults";
import { DEADLINE_LABELS } from "./perm/deadlines/types";

/** The most unread notifications counted for one user; a badge past it shows the cap. */
export const UNREAD_COUNT_CAP = 1000;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Notification types supported by the system.
 * Matches schema.notifications.type union.
 */
export type NotificationType =
  | "deadline_reminder"
  | "status_change"
  | "rfe_alert"
  | "rfi_alert"
  | "system"
  | "auto_closure";

/**
 * Priority levels for notifications.
 * Matches schema.notifications.priority union.
 */
export type PriorityLevel = "low" | "normal" | "high" | "urgent";

/**
 * Deadline types that can trigger notifications.
 * Matches schema.notifications.deadlineType values.
 */
export type DeadlineNotificationType =
  | "pwd_expiration"
  | "rfi_due"
  | "rfe_due"
  | "filing_window_opens"
  | "filing_window_closes"
  | "recruitment_window"
  | "recruitment_window_closes"
  | "eta9089_expiration"
  | "i140_filing_deadline"
  | "job_order_start_deadline"
  | "notice_of_filing_start_deadline"
  | "first_sunday_ad_deadline"
  | "second_sunday_ad_deadline"
  | "denial_review_due"
  | "balca_request_due";

/**
 * Context for generating notification titles and messages.
 */
export interface NotificationContext {
  /** Type of deadline (for deadline_reminder and related types) */
  deadlineType?: DeadlineNotificationType;
  /** Days until deadline (negative = overdue) */
  daysUntilDeadline?: number;
  /** New case status (for status_change) */
  newStatus?: string;
  /** Employer name for case identification */
  employerName?: string;
  /** Beneficiary identifier for case identification */
  beneficiaryIdentifier?: string;
  /** Full case label (e.g., "John D. at Acme Corp") */
  caseLabel?: string;
  /** Deadline violation info (for auto_closure) */
  violation?: DeadlineViolation;
  /** Deadline date in ISO format */
  deadlineDate?: string;
}

/**
 * User notification preferences subset for email/push decision logic.
 * Matches relevant fields from schema.userProfiles.
 */
export interface UserNotificationPrefs {
  /** Master switch for email notifications */
  emailNotificationsEnabled: boolean;
  /** Whether to send deadline reminder emails */
  emailDeadlineReminders: boolean;
  /** Whether to send status update emails */
  emailStatusUpdates: boolean;
  /** Whether to send RFE alert emails */
  emailRfeAlerts: boolean;
  /** Whether to send RFI alert emails (same pref as RFE) */
  // Note: Schema uses emailRfeAlerts for both RFI and RFE
  /** Master switch for push notifications */
  pushNotificationsEnabled: boolean;
  /** Whether quiet hours are enabled */
  quietHoursEnabled: boolean;
  /** Quiet hours start time (HH:MM format) */
  quietHoursStart?: string;
  /** Quiet hours end time (HH:MM format) */
  quietHoursEnd?: string;
  /** User's timezone (IANA format) */
  timezone: string;
  /** Settings' "Which deadlines to remind you about": each off only when switched off (DEADLINE_REMINDER_SWITCH). */
  emailDeadlineReminderPwd?: boolean;
  emailDeadlineReminderRecruitment?: boolean;
  emailDeadlineReminderEta9089?: boolean;
  emailDeadlineReminderI140?: boolean;
  emailDeadlineReminderRfi?: boolean;
  emailDeadlineReminderRfe?: boolean;
  /** Settings' "Urgent deadline threshold": days before a deadline it's urgent, 1 to 30, 7 when unset. */
  urgentDeadlineDays?: number;
}

export type DeadlineReminderSwitch =
  | "emailDeadlineReminderPwd"
  | "emailDeadlineReminderRecruitment"
  | "emailDeadlineReminderEta9089"
  | "emailDeadlineReminderI140"
  | "emailDeadlineReminderRfi"
  | "emailDeadlineReminderRfe";

/**
 * Which of Settings' six deadline switches covers each reminder, by the name the reminder is shown under
 * (formatDeadlineType): the certification's expiry reads "ETA 9089 expiration", so it's the ETA 9089 switch's.
 */
export const DEADLINE_REMINDER_SWITCH: Record<DeadlineNotificationType, DeadlineReminderSwitch> = {
  pwd_expiration: "emailDeadlineReminderPwd",
  recruitment_window: "emailDeadlineReminderRecruitment",
  recruitment_window_closes: "emailDeadlineReminderRecruitment",
  job_order_start_deadline: "emailDeadlineReminderRecruitment",
  notice_of_filing_start_deadline: "emailDeadlineReminderRecruitment",
  first_sunday_ad_deadline: "emailDeadlineReminderRecruitment",
  second_sunday_ad_deadline: "emailDeadlineReminderRecruitment",
  filing_window_opens: "emailDeadlineReminderEta9089",
  filing_window_closes: "emailDeadlineReminderEta9089",
  eta9089_expiration: "emailDeadlineReminderEta9089",
  denial_review_due: "emailDeadlineReminderEta9089",
  balca_request_due: "emailDeadlineReminderEta9089",
  i140_filing_deadline: "emailDeadlineReminderI140",
  rfi_due: "emailDeadlineReminderRfi",
  rfe_due: "emailDeadlineReminderRfe",
};

/** False only when the person switched off the deadline switch that covers this reminder. */
export function remindsAbout(deadlineType: string, prefs: UserNotificationPrefs): boolean {
  const covering = DEADLINE_REMINDER_SWITCH[deadlineType as DeadlineNotificationType];
  return covering === undefined || prefs[covering] !== false;
}

/** The person's urgent threshold, kept to Settings' 1 to 30 days; 7 when unset or out of range. */
export function urgentDays(prefs: Pick<UserNotificationPrefs, "urgentDeadlineDays"> | undefined): number {
  const n = Number(prefs?.urgentDeadlineDays);
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : DEFAULT_URGENT_DAYS;
}

/**
 * Icon names for notification UI display.
 */
export type NotificationIcon =
  | "clock"
  | "arrow-right"
  | "alert-circle"
  | "alert-triangle"
  | "x-circle"
  | "info";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a case status for display in notifications.
 *
 * @param status - Case status string (pwd, recruitment, etc.)
 * @returns Human-readable status name
 *
 * @example
 * formatCaseStatus("pwd"); // "PWD"
 * formatCaseStatus("eta9089"); // "ETA 9089"
 */
/** A case's progress in words, the labels the case list and its badges use. */
export function formatProgressStatus(status: string): string {
  const labels: Record<string, string> = {
    working: "Working on it",
    waiting_intake: "Waiting for intake",
    filed: "Filed",
    approved: "Approved",
    under_review: "Under review",
    rfi_rfe: "RFI/RFE",
  };
  return labels[status] || status;
}

export function formatCaseStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pwd: "PWD",
    recruitment: "Recruitment",
    eta9089: "ETA 9089",
    i140: "I-140",
    closed: "Closed",
  };
  return statusMap[status] || status;
}

/**
 * Build UserNotificationPrefs object from a user profile.
 * Centralizes the default value logic to avoid duplication across mutations.
 *
 * @param userProfile - Partial user profile or null/undefined
 * @returns UserNotificationPrefs with defaults applied
 *
 * @example
 * const prefs = buildUserNotificationPrefs(userProfile);
 * if (shouldSendEmail("status_change", "normal", prefs)) { ... }
 */
export function buildUserNotificationPrefs(
  userProfile: Partial<UserNotificationPrefs> | null | undefined
): UserNotificationPrefs {
  return {
    emailNotificationsEnabled: userProfile?.emailNotificationsEnabled ?? DEFAULT_NOTIFICATION_PREFS.emailNotificationsEnabled,
    emailDeadlineReminders: userProfile?.emailDeadlineReminders ?? DEFAULT_NOTIFICATION_PREFS.emailDeadlineReminders,
    emailStatusUpdates: userProfile?.emailStatusUpdates ?? DEFAULT_NOTIFICATION_PREFS.emailStatusUpdates,
    emailRfeAlerts: userProfile?.emailRfeAlerts ?? DEFAULT_NOTIFICATION_PREFS.emailRfeAlerts,
    pushNotificationsEnabled: userProfile?.pushNotificationsEnabled ?? DEFAULT_NOTIFICATION_PREFS.pushNotificationsEnabled,
    quietHoursEnabled: userProfile?.quietHoursEnabled ?? DEFAULT_NOTIFICATION_PREFS.quietHoursEnabled,
    quietHoursStart: userProfile?.quietHoursStart,
    quietHoursEnd: userProfile?.quietHoursEnd,
    timezone: userProfile?.timezone ?? DEFAULT_NOTIFICATION_PREFS.timezone,
    // Plain copies, no fallbacks: absent means on, and an unset threshold reads 7 in urgentDays.
    emailDeadlineReminderPwd: userProfile?.emailDeadlineReminderPwd,
    emailDeadlineReminderRecruitment: userProfile?.emailDeadlineReminderRecruitment,
    emailDeadlineReminderEta9089: userProfile?.emailDeadlineReminderEta9089,
    emailDeadlineReminderI140: userProfile?.emailDeadlineReminderI140,
    emailDeadlineReminderRfi: userProfile?.emailDeadlineReminderRfi,
    emailDeadlineReminderRfe: userProfile?.emailDeadlineReminderRfe,
    urgentDeadlineDays: userProfile?.urgentDeadlineDays,
  };
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Generate a notification title based on type and context.
 *
 * @param type - Notification type
 * @param context - Context for title generation
 * @returns Human-readable notification title
 *
 * @example
 * generateNotificationTitle("deadline_reminder", {
 *   deadlineType: "pwd_expiration",
 *   daysUntilDeadline: 7
 * });
 * // "PWD expires in 7 days"
 */
export function generateNotificationTitle(
  type: NotificationType,
  context: NotificationContext
): string {
  switch (type) {
    case "deadline_reminder": {
      if (context.daysUntilDeadline === undefined) {
        return context.deadlineType ? `${formatDeadlineType(context.deadlineType)} reminder` : "Deadline reminder";
      }
      return deadlineTitle(context.deadlineType, context.daysUntilDeadline);
    }

    case "status_change": {
      const statusLabel = context.newStatus
        ? formatCaseStatus(context.newStatus)
        : "a new status";
      return `Case moved to ${statusLabel}`;
    }

    case "rfi_alert":
      return context.daysUntilDeadline === undefined
        ? "RFI response due soon"
        : deadlineTitle("rfi_due", context.daysUntilDeadline);

    case "rfe_alert":
      return context.daysUntilDeadline === undefined
        ? "RFE response due soon"
        : deadlineTitle("rfe_due", context.daysUntilDeadline);

    case "auto_closure": {
      if (context.violation) {
        return generateClosureTitle(context.violation);
      }
      return "Case closed automatically";
    }

    case "system":
      return "System notification";

    default:
      return "Notification";
  }
}

/**
 * Generate a notification message body based on type and context.
 *
 * @param type - Notification type
 * @param context - Context for message generation
 * @returns Human-readable notification message
 *
 * @example
 * generateNotificationMessage("deadline_reminder", {
 *   deadlineType: "pwd_expiration",
 *   daysUntilDeadline: 7,
 *   caseLabel: "John D. at Acme Corp",
 *   deadlineDate: "2024-12-31"
 * });
 * // "PWD for John D. at Acme Corp expires on December 31, 2024. Take action to avoid case closure."
 */
export function generateNotificationMessage(
  type: NotificationType,
  context: NotificationContext
): string {
  const caseLabel =
    context.caseLabel ||
    (context.employerName && context.beneficiaryIdentifier
      ? `${context.beneficiaryIdentifier} at ${context.employerName}`
      : "this case");

  const formattedDate = context.deadlineDate
    ? new Date(context.deadlineDate + "T00:00:00Z").toLocaleDateString(
        "en-US",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }
      )
    : undefined;

  switch (type) {
    case "deadline_reminder": {
      const phrase = context.deadlineType ? DEADLINE_PHRASES[context.deadlineType] : undefined;
      const noun = phrase?.noun ?? "The deadline";
      const verb = VERBS[phrase?.verb ?? "due"];
      const days = context.daysUntilDeadline;

      if (days !== undefined && days < 0) {
        const n = Math.abs(days);
        return `${noun} for ${caseLabel} ${verb.past} ${n} day${n === 1 ? "" : "s"} ago. Review the case now.`;
      }
      if (formattedDate) {
        if (days === 0) return `${noun} for ${caseLabel} ${verb.now} today (${formattedDate}).`;
        if (days === 1) return `${noun} for ${caseLabel} ${verb.now} tomorrow (${formattedDate}).`;
        return `${noun} for ${caseLabel} ${verb.now} on ${formattedDate}.`;
      }
      return `${noun} for ${caseLabel} is coming up. Review the case for details.`;
    }

    case "status_change": {
      const statusLabel = context.newStatus
        ? formatCaseStatus(context.newStatus)
        : "a new status";
      return `Case for ${caseLabel} has moved to ${statusLabel}. Review the case for updated deadlines and required actions.`;
    }

    case "rfi_alert": {
      if (context.daysUntilDeadline !== undefined) {
        if (context.daysUntilDeadline < 0) {
          return `RFI response for ${caseLabel} is overdue. DOL's response deadline has passed. Submit your response immediately.`;
        }
        if (context.daysUntilDeadline === 0) {
          return `RFI response for ${caseLabel} is due today. Submit your response to DOL immediately.`;
        }
        if (context.daysUntilDeadline === 1) {
          return `RFI response for ${caseLabel} is due tomorrow. Prepare and submit your response soon.`;
        }
      }
      if (formattedDate) {
        return `RFI response for ${caseLabel} is due on ${formattedDate}. Prepare your response to DOL.`;
      }
      return `RFI response for ${caseLabel} is due soon. Review the case for the response deadline.`;
    }

    case "rfe_alert": {
      if (context.daysUntilDeadline !== undefined) {
        if (context.daysUntilDeadline < 0) {
          return `RFE response for ${caseLabel} is overdue. USCIS's response deadline has passed. Submit your response immediately.`;
        }
        if (context.daysUntilDeadline === 0) {
          return `RFE response for ${caseLabel} is due today. Submit your response to USCIS immediately.`;
        }
        if (context.daysUntilDeadline === 1) {
          return `RFE response for ${caseLabel} is due tomorrow. Prepare and submit your response soon.`;
        }
      }
      if (formattedDate) {
        return `RFE response for ${caseLabel} is due on ${formattedDate}. Prepare your response to USCIS.`;
      }
      return `RFE response for ${caseLabel} is due soon. Review the case for the response deadline.`;
    }

    case "auto_closure": {
      if (context.violation) {
        return `Case for ${caseLabel} has been automatically closed: ${context.violation.reason}`;
      }
      return `Case for ${caseLabel} has been automatically closed due to a missed deadline.`;
    }

    case "system":
      return "You have a new system notification. Check the notification center for details.";

    default:
      return "You have a new notification.";
  }
}

/**
 * Calculate the priority level based on days until deadline and notification type.
 *
 * Priority rules:
 * - urgent: overdue (< 0 days) or <= 7 days
 * - high: 8-14 days
 * - normal: 15-30 days
 * - low: 30+ days
 * - RFI/RFE alerts are always at least "high" priority
 *
 * "Urgent" reaches as far as the person's own threshold (Settings, 1 to 30 days, 7 when unset): the push for an urgent
 * deadline goes through quiet hours, as Settings says.
 *
 * @param daysUntil - Days until deadline (negative = overdue)
 * @param type - Notification type
 * @param urgentWithin - The person's urgent threshold in days (urgentDays(prefs))
 * @returns Priority level
 *
 * @example
 * calculatePriority(5, "deadline_reminder"); // "urgent"
 * calculatePriority(20, "deadline_reminder"); // "normal"
 * calculatePriority(45, "rfi_alert"); // "high" (RFI is always at least high)
 */
export function calculatePriority(
  daysUntil: number,
  type: NotificationType,
  urgentWithin: number = DEFAULT_URGENT_DAYS,
): PriorityLevel {
  // RFI/RFE alerts are always at least high priority
  const isRfiRfe = type === "rfi_alert" || type === "rfe_alert";
  const minPriority: PriorityLevel = isRfiRfe ? "high" : "low";

  // Calculate base priority from days until deadline
  let basePriority: PriorityLevel;

  if (daysUntil < 0) {
    // Overdue
    basePriority = "urgent";
  } else if (daysUntil <= urgentWithin) {
    basePriority = "urgent";
  } else if (daysUntil <= 14) {
    basePriority = "high";
  } else if (daysUntil <= 30) {
    basePriority = "normal";
  } else {
    basePriority = "low";
  }

  // Priority order for comparison
  const priorityOrder: PriorityLevel[] = ["low", "normal", "high", "urgent"];
  const basePriorityIndex = priorityOrder.indexOf(basePriority);
  const minPriorityIndex = priorityOrder.indexOf(minPriority);

  // Return the higher of basePriority and minPriority
  return basePriorityIndex >= minPriorityIndex ? basePriority : minPriority;
}

/**
 * Get the icon name for a notification type.
 *
 * Icon meanings:
 * - clock: Time-based reminder (deadline)
 * - arrow-right: Status transition
 * - alert-circle: RFI alert (DOL request)
 * - alert-triangle: RFE alert (USCIS request)
 * - x-circle: Case closure
 * - info: General system info
 *
 * @param type - Notification type
 * @returns Icon name for UI display
 *
 * @example
 * getNotificationIcon("deadline_reminder"); // "clock"
 * getNotificationIcon("rfe_alert"); // "alert-triangle"
 */
export function getNotificationIcon(type: NotificationType): NotificationIcon {
  switch (type) {
    case "deadline_reminder":
      return "clock";
    case "status_change":
      return "arrow-right";
    case "rfi_alert":
      return "alert-circle";
    case "rfe_alert":
      return "alert-triangle";
    case "auto_closure":
      return "x-circle";
    case "system":
      return "info";
    default:
      return "info";
  }
}

/**
 * How each deadline reads in a sentence: what it is, and what happens on its
 * date. Titles and messages are built from this one table, so an email, a
 * push and the notification list word a deadline the same way, in sentence
 * case.
 */
const DEADLINE_PHRASES: Record<DeadlineNotificationType, { noun: string; verb: keyof typeof VERBS }> = {
  pwd_expiration: { noun: "PWD", verb: "expires" },
  eta9089_expiration: { noun: "ETA 9089 certification", verb: "expires" },
  filing_window_opens: { noun: "ETA 9089 filing window", verb: "opens" },
  filing_window_closes: { noun: "ETA 9089 filing window", verb: "closes" },
  recruitment_window: { noun: "Recruitment window", verb: "closes" },
  recruitment_window_closes: { noun: "Recruitment window", verb: "closes" },
  i140_filing_deadline: { noun: "I-140 filing", verb: "due" },
  job_order_start_deadline: { noun: "Job order start", verb: "due" },
  notice_of_filing_start_deadline: { noun: "Notice of filing start", verb: "due" },
  first_sunday_ad_deadline: { noun: "First Sunday ad", verb: "due" },
  second_sunday_ad_deadline: { noun: "Second Sunday ad", verb: "due" },
  rfi_due: { noun: "RFI response", verb: "due" },
  rfe_due: { noun: "RFE response", verb: "due" },
  denial_review_due: { noun: "Reconsideration or BALCA request", verb: "due" },
  balca_request_due: { noun: "BALCA request", verb: "due" },
};

/** Each verb in a title ("due", "expires"), a sentence ("is due") and the past. */
const VERBS = {
  due: { title: "due", now: "is due", past: "was due", missed: "overdue" },
  expires: { title: "expires", now: "expires", past: "expired", missed: "expired" },
  opens: { title: "opens", now: "opens", past: "opened", missed: "is open" },
  closes: { title: "closes", now: "closes", past: "closed", missed: "closed" },
} as const;

/**
 * A deadline's notification title: "PWD expires in 7 days", "RFI response
 * due tomorrow", "ETA 9089 filing window closed".
 */
export function deadlineTitle(
  deadlineType: DeadlineNotificationType | undefined,
  daysUntil: number
): string {
  const phrase = deadlineType ? DEADLINE_PHRASES[deadlineType] : undefined;
  const noun = phrase?.noun ?? "Deadline";
  const verb = VERBS[phrase?.verb ?? "due"];
  if (daysUntil < 0) return `${noun} ${verb.missed}`;
  if (daysUntil === 0) return `${noun} ${verb.title} today`;
  if (daysUntil === 1) return `${noun} ${verb.title} tomorrow`;
  return `${noun} ${verb.title} in ${daysUntil} days`;
}

/**
 * A deadline type's name in sentence case, for lists and email rows.
 *
 * @example
 * formatDeadlineType("pwd_expiration"); // "PWD expiration"
 * formatDeadlineType("rfi_due"); // "RFI response due"
 */
export function formatDeadlineType(
  deadlineType: DeadlineNotificationType
): string {
  switch (deadlineType) {
    case "pwd_expiration":
      return "PWD expiration";
    case "eta9089_expiration":
      return "ETA 9089 expiration";
    case "recruitment_window":
    case "recruitment_window_closes":
      return "Recruitment window closes";
    default:
      return DEADLINE_LABELS[deadlineType] ?? deadlineType;
  }
}

/**
 * Parse a time string (HH:MM) to minutes since midnight.
 */
function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Check if current time is within quiet hours.
 *
 * Handles overnight quiet hours (e.g., 22:00 to 08:00).
 *
 * @param currentTime - Current time in HH:MM format
 * @param quietStart - Quiet hours start in HH:MM format
 * @param quietEnd - Quiet hours end in HH:MM format
 * @returns true if within quiet hours
 */
function isWithinQuietHours(
  currentTime: string,
  quietStart: string,
  quietEnd: string
): boolean {
  const current = parseTimeToMinutes(currentTime);
  const start = parseTimeToMinutes(quietStart);
  const end = parseTimeToMinutes(quietEnd);

  if (current === null || start === null || end === null) {
    return false;
  }

  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (start > end) {
    // Quiet hours span midnight
    return current >= start || current < end;
  }

  // Normal case (e.g., 09:00 to 17:00)
  return current >= start && current < end;
}

/**
 * Whether an email goes for a notification: the master email switch, then the
 * switch for its kind. A deadline reminder, RFI and RFE ones included, also
 * needs "Deadline reminders" and the switch that covers its deadline
 * (DEADLINE_REMINDER_SWITCH), when the caller passes the deadline's type.
 *
 * Quiet hours never hold an email. The reminder email goes once a day at a
 * fixed hour and each reminder fires on one day only, so an email held was an
 * email never sent. Quiet hours hold the push: see shouldSendPush.
 */
export function shouldSendEmail(
  notificationType: NotificationType,
  _priority: PriorityLevel,
  userPrefs: UserNotificationPrefs,
  deadlineType?: string,
): boolean {
  // Check master switch
  if (!userPrefs.emailNotificationsEnabled) {
    return false;
  }

  // Check type-specific preferences
  switch (notificationType) {
    case "deadline_reminder":
      if (!userPrefs.emailDeadlineReminders) return false;
      if (deadlineType !== undefined && !remindsAbout(deadlineType, userPrefs)) return false;
      break;

    case "status_change":
      if (!userPrefs.emailStatusUpdates) return false;
      break;

    case "rfi_alert":
    case "rfe_alert":
      // The due-date reminders Settings lists under "Deadline reminders" ("RFI response", "RFE response").
      // emailRfeAlerts has no control in Settings and stays read for anyone who set it another way.
      if (!userPrefs.emailRfeAlerts || !userPrefs.emailDeadlineReminders) return false;
      if (!remindsAbout(deadlineType ?? (notificationType === "rfi_alert" ? "rfi_due" : "rfe_due"), userPrefs)) return false;
      break;

    case "auto_closure":
      // Auto-closure always sends email if master switch is on
      // (critical notification)
      break;

    case "system":
      // System notifications follow general preferences
      // Use status updates preference as fallback
      if (!userPrefs.emailStatusUpdates) return false;
      break;
  }

  return true;
}

/** The notification a deadline reminder is filed as: an RFI's or an RFE's due date has its own kind. */
export function reminderNotificationType(deadlineType: string): NotificationType {
  if (deadlineType === "rfi_due") return "rfi_alert";
  if (deadlineType === "rfe_due") return "rfe_alert";
  return "deadline_reminder";
}

/**
 * Whether the day's reminder for this deadline is emailed, by the person's switches alone: the master email switch,
 * "Deadline reminders" and the switch for its kind of deadline (shouldSendEmail, which no priority changes). A case's
 * second reminder recipient gets exactly what this allows for the case's owner.
 */
export function emailsDeadlineReminder(deadlineType: string, prefs: UserNotificationPrefs): boolean {
  return shouldSendEmail(reminderNotificationType(deadlineType), "normal", prefs, deadlineType);
}

/**
 * Whether a push goes for a notification: the push switch, and quiet hours.
 * The email switches have no say, so email off with push on still pushes.
 * An urgent one goes inside quiet hours; so does any when the time isn't known.
 *
 * @param currentTimeInTimezone - the account's local time, HH:MM
 */
export function shouldSendPush(
  priority: PriorityLevel,
  userPrefs: UserNotificationPrefs,
  currentTimeInTimezone?: string,
): boolean {
  if (!userPrefs.pushNotificationsEnabled) return false;
  if (priority === "urgent") return true;
  if (!userPrefs.quietHoursEnabled || !userPrefs.quietHoursStart || !userPrefs.quietHoursEnd) return true;
  if (!currentTimeInTimezone) return true;
  return !isWithinQuietHours(currentTimeInTimezone, userPrefs.quietHoursStart, userPrefs.quietHoursEnd);
}
