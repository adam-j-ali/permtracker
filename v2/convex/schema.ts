/**
 * PERM Tracker Database Schema
 * =============================
 *
 * Convex schema definition for the PERM case tracking application.
 * This file is the single source of truth for all database table structures.
 *
 * ## Table of Contents
 *
 * ### User Management
 * - `users` - Core auth fields (extended from @convex-dev/auth)
 * - `userProfiles` - App-specific user data (settings, preferences)
 *
 * ### Case Management
 * - `cases` - PERM case tracking (PWD, recruitment, ETA 9089, I-140, then the I-485 or consulate and the card)
 *
 * ### Communications
 * - `notifications` - Deadline alerts and system messages
 * - `conversations` - Chatbot conversation tracking
 * - `conversationMessages` - Message history with tool calls
 *
 * ### Infrastructure
 * - `auditLogs` - Append-only change tracking
 * - `userCaseOrder` - Custom drag-drop case ordering
 * - `timelinePreferences` - Timeline display settings
 * - `rateLimits` - Request throttling for auth endpoints
 * - `apiUsage` - Daily usage tracking for external search APIs
 *
 * ## Naming Conventions
 * - Tables: camelCase (cases, userProfiles, auditLogs)
 * - Fields: camelCase (employerName, pwdFilingDate, rfiEntries)
 * - Indexes: snake_case with "by_" prefix (by_user_id, by_user_and_status)
 *
 * ## Design Patterns
 * - All tables use soft deletes via `deletedAt` timestamp
 * - User data isolation via Row-Level Security pattern (userId foreign keys)
 * - Audit logging for compliance and debugging
 * - Branded types in TypeScript for compile-time safety
 *
 * @see /docs/SCHEMA_MIGRATION.md for deprecation and migration guides
 * @see /convex/lib/perm/statusTypes.ts for CaseStatus/ProgressStatus types
 */

import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { errorSourceValidator } from "./lib/errorRecording";
import { alertKindValidator } from "./lib/alertKinds";
import { contactEventTypeValidator } from "./marketingWebhook";
import { CASE_STATUSES, PROGRESS_STATUSES } from "./lib/perm/statusTypes";
import { EB_CATEGORIES, GREEN_CARD_PATHS, I140_CATEGORIES } from "./lib/perm/greenCard";

// Reusable literal-union validators built from the single-source status arrays
// in `lib/perm/statusTypes.ts`, so schema + app code never drift. `caseStatus`
// and `progressStatus` are used by both the `cases` table and the
// `userCaseOrder.filters` snapshot.
const caseStatusValidator = v.union(
  ...CASE_STATUSES.map((s) => v.literal(s)),
);
const progressStatusValidator = v.union(
  ...PROGRESS_STATUSES.map((s) => v.literal(s)),
);
// Past the I-140, single-sourced from lib/perm/greenCard.ts.
const greenCardPathValidator = v.union(...GREEN_CARD_PATHS.map((s) => v.literal(s)));
const ebCategoryValidator = v.union(...EB_CATEGORIES.map((s) => v.literal(s)));

export default defineSchema({
  // Spread authTables (includes users, authSessions, authAccounts, etc.)
  ...authTables,

  // Extend users table with minimal auth-related fields
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    phone: v.optional(v.string()),
    // DEPRECATED: Unreliable — custom createOrUpdateUser bypasses the library's
    // default setter. Use authAccounts table via isEmailVerified() instead.
    // Kept as optional for backwards compat with existing documents.
    emailVerificationTime: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    /**
     * The policy version this account last accepted (convex/lib/policyConsent.ts). Absent means the baseline,
     * which every account holds, so nothing is migrated and nobody is asked until a change needs it.
     */
    policyAcceptedVersion: v.optional(v.string()),
    policyAcceptedAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("by_deleted_at", ["deletedAt"]),

  /**
   * Active consent from alert subscribers without an account (convex/policyConsent.ts): one row per address and
   * policy version, keyed by the address's SHA-256 (`raterKeyFor`), never the address. `noticeSentAt` stamps the
   * change email so the hand-run sweep mails each address once per version; `acceptedAt` is the click.
   */
  policyConsents: defineTable({
    key: v.string(),
    version: v.string(),
    noticeSentAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
  }).index("by_key_version", ["key", "version"]),

  // Separate table for app-specific user data (survives Clerk migration)
  userProfiles: defineTable({
    // 1:1 relationship with users table
    userId: v.id("users"),

    // Profile section
    fullName: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    company: v.optional(v.string()),
    profilePhotoUrl: v.optional(v.string()),

    // Organization section
    // The firm hierarchy (firm_admin/firm_member, firmId, firmName, the
    // by_firm_id index and three auth helpers) was declared in 2025 and never
    // called from anywhere. Removed 2026-08-24 with zero rows carrying any of
    // its fields; if firms become real, build the invite flow first and the
    // schema after it.
    userType: v.literal("individual"),

    // Notification settings
    emailNotificationsEnabled: v.boolean(),
    smsNotificationsEnabled: v.boolean(),
    pushNotificationsEnabled: v.boolean(),
    pushSubscription: v.optional(v.string()), // JSON stringified PushSubscription
    urgentDeadlineDays: v.number(), // Days before deadline to mark urgent
    reminderDaysBefore: v.array(v.number()), // e.g., [1, 3, 7, 14, 30]

    // Email preferences
    emailDeadlineReminders: v.boolean(), // Master toggle for all deadline reminders
    // Individual deadline type reminders (granular control)
    emailDeadlineReminderPwd: v.optional(v.boolean()),
    emailDeadlineReminderRecruitment: v.optional(v.boolean()),
    emailDeadlineReminderEta9089: v.optional(v.boolean()),
    emailDeadlineReminderI140: v.optional(v.boolean()),
    emailDeadlineReminderRfi: v.optional(v.boolean()),
    emailDeadlineReminderRfe: v.optional(v.boolean()),
    emailStatusUpdates: v.boolean(),
    emailRfeAlerts: v.boolean(),
    emailWeeklyDigest: v.optional(v.boolean()), // Weekly case summary email (Mondays at 15:00 UTC: 10 AM EST, 11 AM EDT): absent means on
    // Global switch for the DOL live-status watch on saved cases
    // (convex/appCaseWatch.ts). Absent means on; false turns every saved
    // case's automatic watch off for this account.
    watchSavedCases: v.optional(v.boolean()),
    // DEPRECATED: No longer used — emails always go to signup email.
    // Kept as optional for backwards compat with existing documents.
    preferredNotificationEmail: v.optional(v.union(
      v.literal("signup"),
      v.literal("google"),
      v.literal("both")
    )),

    // Quiet hours
    quietHoursEnabled: v.boolean(),
    quietHoursStart: v.optional(v.string()), // HH:MM format
    quietHoursEnd: v.optional(v.string()),
    timezone: v.string(), // IANA timezone

    // Calendar sync
    calendarSyncEnabled: v.boolean(),
    calendarSyncPwd: v.boolean(),
    calendarSyncEta9089: v.boolean(),
    calendarSyncI140: v.boolean(),
    calendarSyncRfe: v.boolean(),
    calendarSyncRfi: v.boolean(),
    calendarSyncRecruitment: v.boolean(),
    calendarSyncFilingWindow: v.boolean(),

    // Google OAuth
    googleEmail: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    googleAccessToken: v.optional(v.string()),
    googleTokenExpiry: v.optional(v.number()),
    googleScopes: v.optional(v.array(v.string())),
    googleCalendarConnected: v.boolean(),
    gmailConnected: v.boolean(),

    // UI preferences
    casesSortBy: v.string(), // e.g., "updatedAt", "nextDeadline"
    casesSortOrder: v.union(v.literal("asc"), v.literal("desc")),
    casesPerPage: v.number(),
    dismissedDeadlines: v.array(
      v.object({
        caseId: v.id("cases"),
        deadlineType: v.string(),
        dismissedAt: v.number(),
      })
    ),
    darkModeEnabled: v.boolean(),
    privacyModeEnabled: v.optional(v.boolean()),
    // Usage analytics switched off in Settings: the account's browsers send
    // PostHog nothing (users.isPostHogExcluded, src/lib/analytics.ts).
    analyticsOff: v.optional(v.boolean()),
    // Counted in the public figures (Settings, off unless switched on): each hour the dates on this account's cases
    // count toward the waits the public pages show, never listed or shown (convex/caseFigures.ts). When it was set.
    countCaseDates: v.optional(v.boolean()),
    countCaseDatesAt: v.optional(v.number()),

    // Chatbot action mode
    /**
     * Controls how the chatbot handles actions that modify case data.
     * - "off": Chatbot cannot execute actions, only provides information
     * - "confirm": Chatbot proposes actions and waits for user confirmation (safest, default)
     * - "auto": Chatbot executes actions automatically without confirmation
     */
    actionMode: v.optional(v.union(v.literal("off"), v.literal("confirm"), v.literal("auto"))),

    // Calendar UI preferences
    calendarHiddenCases: v.optional(v.array(v.id("cases"))),
    calendarHiddenDeadlineTypes: v.optional(v.array(v.string())),
    calendarShowCompleted: v.optional(v.boolean()), // Show I-140 approved cases
    calendarShowClosed: v.optional(v.boolean()), // Show closed/archived cases

    // Admin UI preferences
    adminSortBy: v.optional(v.union(
      v.literal("lastActivity"), v.literal("email"), v.literal("name"),
      v.literal("accountStatus"), v.literal("totalCases"), v.literal("activeCases"),
      v.literal("totalLogins"), v.literal("accountCreated"), v.literal("lastLoginTime"),
      v.literal("userType"), v.literal("emailVerified"), v.literal("verificationMethod"),
      v.literal("deletedCases"), v.literal("termsVersion"),
      v.literal("termsAccepted"), v.literal("lastCaseUpdate"), v.literal("deletedAt"),
      v.literal("userId"), v.literal("authProviders"), v.literal("audience"), v.literal("role")
    )),
    adminSortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),

    // DEPRECATED (2026-06-08): admin self-notification emails ("New User Signup",
    // "First Case Created", "New Case Created") were removed entirely for cost control.
    // These optional fields are retained ONLY because one legacy admin profile still
    // carries them; dropping them from the schema would fail deploy validation against
    // that doc without a data migration. Nothing reads or writes them anymore. Safe to
    // delete after clearing the values from that one profile.
    adminNotifyNewUser: v.optional(v.boolean()),
    adminNotifyFirstCase: v.optional(v.boolean()),
    adminNotifyAnyCase: v.optional(v.boolean()),

    // Deadline Enforcement
    autoDeadlineEnforcementEnabled: v.boolean(),

    // Legal & Compliance
    /**
     * Timestamp when user accepted Terms of Service and Privacy Policy.
     * Required for all users to use the service.
     * Stored as Unix timestamp (milliseconds since epoch).
     */
    termsAcceptedAt: v.optional(v.number()),
    /**
     * Version of Terms of Service accepted (for re-consent when terms change).
     * Format: "YYYY-MM-DD" matching the effective date in the Terms page.
     */
    termsVersion: v.optional(v.string()),

    // Onboarding
    /**
     * Current onboarding step for the wizard/tour flow.
     * undefined = not started, "done" = fully complete.
     * Wizard steps: "welcome" | "role" | "create_case" | "value_preview" | "completion"
     * Post-wizard: "tour_pending" | "tour_completed" | "done"
     */
    onboardingStep: v.optional(v.string()),
    /** Timestamp when onboarding wizard was completed. */
    onboardingCompletedAt: v.optional(v.number()),
    /** Completed checklist item IDs. */
    onboardingChecklist: v.optional(v.array(v.string())),
    /** Whether the user dismissed the getting-started checklist. */
    onboardingChecklistDismissed: v.optional(v.boolean()),

    // Login tracking (persistent — authSessions get cleaned up by Convex Auth)
    loginCount: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),

    // Server-side inactivity tracking (heartbeat writes this every 5 min)
    lastActiveAt: v.optional(v.number()),

    // Re-engagement nudge state. reengagementNudgeSentAt: when the "you've been
    // away" email was sent (one nudge per inactivity spell; cleared on next
    // login). weeklyDigestSuppressedAt: when the weekly digest was auto-paused
    // after the nudge went unanswered — distinguishes an auto-pause from a manual
    // unsubscribe and drives the in-app reactivation banner.
    reengagementNudgeSentAt: v.optional(v.number()),
    weeklyDigestSuppressedAt: v.optional(v.number()),

    // One-shot flag: welcome email + admin notification are fired on first
    // successful authenticated login (NOT on signup). This prevents signup-spam
    // from delivering emails via our verified sender reputation — unverified
    // attackers never reach this point. Set to true once the post-signup emails
    // have been sent successfully. See convex/users.ts:recordMyLogin.
    postSignupEmailsSent: v.optional(v.boolean()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),

    /**
     * Scheduled deletion job ID (for cancellation).
     * References `_scheduled_functions` - a Convex system table that tracks scheduled jobs.
     * This allows us to cancel the permanent deletion if the user changes their mind.
     * @see scheduledJobs.ts permanentlyDeleteAccount for the scheduled job handler
     */
    scheduledDeletionJobId: v.optional(v.id("_scheduled_functions")),

    // Abuse suspension (admin-controlled). When `suspendedAt` is set, login
    // is blocked until `suspendedUntil` passes or an admin unsuspends.
    suspendedAt: v.optional(v.number()),
    suspendedReason: v.optional(v.string()),
    suspendedUntil: v.optional(v.number()),
  })
    .index("by_user_id", ["userId"])
    .index("by_deleted_at", ["deletedAt"])
    .index("by_count_case_dates", ["countCaseDates"]),

  // PERM case tracking
  cases: defineTable({
    // Core identity
    userId: v.id("users"),
    caseNumber: v.optional(v.string()), // DOL case number
    internalCaseNumber: v.optional(v.string()), // Attorney's reference

    // Employer info
    employerName: v.string(),
    employerFein: v.optional(v.string()),

    // Beneficiary info
    beneficiaryIdentifier: v.optional(v.string()), // Privacy-safe identifier (optional)

    // Position info
    positionTitle: v.string(),
    socCode: v.optional(v.string()),
    socTitle: v.optional(v.string()),
    jobOrderState: v.optional(v.string()), // 2-letter state code

    // Case status (two-tier system) — single-sourced from lib/perm/statusTypes
    caseStatus: caseStatusValidator,
    progressStatus: progressStatusValidator,
    progressStatusOverride: v.optional(v.boolean()),

    // Sample case flag (for onboarding demo data)
    isSample: v.optional(v.boolean()),

    // DOL's live status, watched automatically for a saved case that has a DOL
    // number (convex/appCaseWatch.ts). This is NEVER the attorney's own stage:
    // the 5-minute sweep writes liveStatus and never touches caseStatus or
    // progressStatus, so DOL's record sits BESIDE the firm's bookkeeping and a
    // mismatch between the two is itself a useful signal.
    liveStatus: v.optional(v.string()),
    liveStatusSeenAt: v.optional(v.number()), // ms; when the sweep first saw this status
    liveStatusIsFinal: v.optional(v.boolean()),
    // The per-case watch toggle. Absent means on: a case with a DOL number
    // watches itself unless this is false or the account's global switch
    // (userProfiles.watchSavedCases) is off.
    watchEnabled: v.optional(v.boolean()),

    // PWD phase
    pwdFilingDate: v.optional(v.string()), // ISO date YYYY-MM-DD
    pwdDeterminationDate: v.optional(v.string()),
    pwdExpirationDate: v.optional(v.string()), // Auto-calculated
    pwdCaseNumber: v.optional(v.string()),
    pwdWageAmount: v.optional(v.number()), // Stored as dollars (e.g., 85000 or 85000.50)
    pwdWageLevel: v.optional(v.string()),

    // Recruitment - Job Order
    jobOrderStartDate: v.optional(v.string()),
    jobOrderEndDate: v.optional(v.string()),

    // Recruitment - Sunday Ads
    sundayAdFirstDate: v.optional(v.string()),
    sundayAdSecondDate: v.optional(v.string()),
    sundayAdNewspaper: v.optional(v.string()),

    // Recruitment - Additional Methods
    // DEPRECATED: Legacy top-level date fields (Feature 006 moves dates to method level)
    // Keep for backward compatibility - do NOT remove until data migration is complete
    additionalRecruitmentStartDate: v.optional(v.string()),
    additionalRecruitmentEndDate: v.optional(v.string()),
    additionalRecruitmentMethods: v.array(
      v.object({
        method: v.string(),
        date: v.string(),
        description: v.optional(v.string()),
        // Feature 006: Per-method date fields
        startDate: v.optional(v.string()),   // For date-range methods (job_website_ad, employer_website, private_employment_firm)
        endDate: v.optional(v.string()),     // For date-range methods
        subEntries: v.optional(v.array(      // For radio_ad, tv_ad (multiple spots)
          v.object({
            date: v.string(),
            description: v.optional(v.string()),
          })
        )),
      })
    ),
    recruitmentNotes: v.optional(v.string()),
    recruitmentApplicantsCount: v.number(),
    recruitmentSummaryCustom: v.optional(v.string()),

    // Derived recruitment dates (auto-calculated, stored for queryability)
    // These are computed from recruitment dates and stored in mutations
    recruitmentStartDate: v.optional(v.string()), // MIN of all start dates (first step)
    recruitmentEndDate: v.optional(v.string()),   // MAX of all end dates (last step)
    filingWindowOpens: v.optional(v.string()),    // recruitmentEnd + 30 days
    filingWindowCloses: v.optional(v.string()),   // recruitmentStart + 180 days; MIN with pwdExpiration only while the PWD limits the case (perm/dates/pwdValidity.ts)
    recruitmentWindowCloses: v.optional(v.string()), // recruitmentStart + 150 days; MIN with pwdExpiration - 30 days likewise

    // Professional occupation
    isProfessionalOccupation: v.boolean(),

    // Notice of Filing
    noticeOfFilingStartDate: v.optional(v.string()),
    noticeOfFilingEndDate: v.optional(v.string()),

    // ETA 9089
    eta9089FilingDate: v.optional(v.string()),
    eta9089AuditDate: v.optional(v.string()),
    eta9089CertificationDate: v.optional(v.string()),
    // A denial and what the employer asked for after it (perm/calculators/denialReview.ts):
    // the date on DOL's Final Determination letter, the requests for reconsideration
    // and BALCA review, and the date on the notice upholding the denial on reconsideration.
    eta9089DenialDate: v.optional(v.string()),
    eta9089ReconsiderationDate: v.optional(v.string()),
    eta9089ReconsiderationDeniedDate: v.optional(v.string()),
    eta9089BalcaRequestDate: v.optional(v.string()),
    eta9089ExpirationDate: v.optional(v.string()),
    eta9089CaseNumber: v.optional(v.string()),

    /**
     * RFI entries (Request for Information from DOL).
     * Strict 30-day response deadline, auto-calculated from receivedDate.
     *
     * @optional Backwards compatibility - existing documents may not have this field.
     * New cases always initialize with empty array [].
     */
    rfiEntries: v.optional(v.array(
      v.object({
        id: v.string(),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        notes: v.optional(v.string()),
        receivedDate: v.string(),
        responseDueDate: v.string(), // Auto-calculated: +30 days, NOT editable
        responseSubmittedDate: v.optional(v.string()),
        createdAt: v.number(),
      })
    )),

    /**
     * RFE entries (Request for Evidence from USCIS for I-140).
     * Due date is user-editable (varies by case complexity).
     *
     * @optional Backwards compatibility - existing documents may not have this field.
     * New cases always initialize with empty array [].
     */
    rfeEntries: v.optional(v.array(
      v.object({
        id: v.string(),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        notes: v.optional(v.string()),
        receivedDate: v.string(),
        responseDueDate: v.string(), // USER EDITABLE
        responseSubmittedDate: v.optional(v.string()),
        createdAt: v.number(),
      })
    )),

    // I-140
    i140FilingDate: v.optional(v.string()),
    i140ReceiptDate: v.optional(v.string()),
    i140ReceiptNumber: v.optional(v.string()),
    i140ApprovalDate: v.optional(v.string()),
    i140DenialDate: v.optional(v.string()),
    i140Category: v.optional(v.union(...I140_CATEGORIES.map((s) => v.literal(s)))),
    i140PremiumProcessing: v.optional(v.boolean()),
    i140ServiceCenter: v.optional(v.string()),

    // Past the I-140: the green card (convex/lib/perm/greenCard.ts). Every field is optional, so a case saved
    // before they existed keeps its stage. Dates are ISO YYYY-MM-DD.
    /** Adjustment of status in the US (I-485) or an immigrant visa at a consulate. */
    greenCardPath: v.optional(greenCardPathValidator),
    /** The preference category with its subclass; `i140Category` follows it for what still reads that field. */
    ebCategory: v.optional(ebCategoryValidator),
    /** Two-letter country codes. Chargeability is set only when it differs from the country of birth. */
    countryOfBirth: v.optional(v.string()),
    chargeabilityCountry: v.optional(v.string()),
    // Adjustment of status: the I-485, and the work permit (I-765) and travel document (I-131) filed with it
    i485FilingDate: v.optional(v.string()),
    i485ReceiptDate: v.optional(v.string()),
    i485ReceiptNumber: v.optional(v.string()),
    i485BiometricsDate: v.optional(v.string()),
    i485InterviewDate: v.optional(v.string()),
    i485ApprovalDate: v.optional(v.string()),
    /** The date on USCIS's denial notice. The case stays in the I-485 stage, back to working; an approval wins. */
    i485DenialDate: v.optional(v.string()),
    eadFilingDate: v.optional(v.string()),
    eadReceiptNumber: v.optional(v.string()),
    eadApprovalDate: v.optional(v.string()),
    apFilingDate: v.optional(v.string()),
    apReceiptNumber: v.optional(v.string()),
    apApprovalDate: v.optional(v.string()),
    // Consular processing: the National Visa Center, the DS-260, the interview
    nvcReceivedDate: v.optional(v.string()),
    ds260SubmittedDate: v.optional(v.string()),
    consularInterviewDate: v.optional(v.string()),
    // The card, on either path. A received card makes the case complete.
    cardProducedDate: v.optional(v.string()),
    cardReceivedDate: v.optional(v.string()),

    // Organization & Metadata
    priorityLevel: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent")
    ),
    isFavorite: v.boolean(),
    /**
     * Pinned cases appear at top of case list.
     * @optional Backwards compatibility - existing documents default to false.
     */
    isPinned: v.optional(v.boolean()),
    notes: v.optional(
      v.array(
        v.object({
          id: v.string(),
          content: v.string(),
          createdAt: v.number(),
          status: v.union(
            v.literal("pending"),
            v.literal("done"),
            v.literal("deleted")
          ),
          // Extended fields for full journal functionality (optional for backward compatibility)
          priority: v.optional(
            v.union(v.literal("high"), v.literal("medium"), v.literal("low"))
          ),
          category: v.optional(
            v.union(
              v.literal("follow-up"),
              v.literal("document"),
              v.literal("client"),
              v.literal("internal"),
              v.literal("deadline"),
              v.literal("other")
            )
          ),
          dueDate: v.optional(v.string()), // ISO date string
        })
      )
    ),
    tags: v.array(v.string()),

    // Job Description (for PERM postings)
    /**
     * Position title for the job description.
     * Inherited from positionTitle by default, but can be edited independently.
     * Used for template matching and display.
     * @optional Backwards compatibility - existing documents won't have this.
     */
    jobDescriptionPositionTitle: v.optional(v.string()),
    /**
     * Job description text for PERM postings.
     * Can be loaded from templates or entered manually.
     * @optional Backwards compatibility - existing documents won't have this.
     */
    jobDescription: v.optional(v.string()),
    /**
     * Reference to the template this job description was loaded from.
     * Null if entered manually or if template was deleted.
     * @optional Only set when loaded from a template.
     */
    jobDescriptionTemplateId: v.optional(v.id("jobDescriptionTemplates")),

    // Calendar integration - maps deadline type to Google Calendar event ID
    calendarEventIds: v.optional(
      v.object({
        pwd_expiration: v.optional(v.string()),
        eta9089_filing_window: v.optional(v.string()),
        eta9089_filing: v.optional(v.string()),
        filing_window_closes: v.optional(v.string()),
        eta9089_expiration: v.optional(v.string()),
        i140_filing_deadline: v.optional(v.string()),
        rfi_due: v.optional(v.string()),
        rfe_due: v.optional(v.string()),
        recruitment_end: v.optional(v.string()),
        recruitment_window_closes: v.optional(v.string()),
        job_order_start_deadline: v.optional(v.string()),
        notice_of_filing_start_deadline: v.optional(v.string()),
        first_sunday_ad_deadline: v.optional(v.string()),
        second_sunday_ad_deadline: v.optional(v.string()),
        denial_review_due: v.optional(v.string()),
        balca_request_due: v.optional(v.string()),
      })
    ),
    calendarSyncEnabled: v.boolean(),
    /**
     * Whether to display this case on the timeline view.
     * @optional Backwards compatibility - existing documents default to true.
     */
    showOnTimeline: v.optional(v.boolean()),

    // Document attachments (ISS-007)
    documents: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        url: v.string(), // Convex file storage serving URL
        storageId: v.optional(v.string()), // Convex _storage ID for deletion
        mimeType: v.string(),
        size: v.number(), // File size in bytes
        uploadedAt: v.number(),
        category: v.optional(
          v.union(
            v.literal("pwd"),
            v.literal("recruitment"),
            v.literal("eta9089"),
            v.literal("i140"),
            v.literal("general")
          )
        ),
        /** The recruitment step this file proves: a key of convex/lib/perm/recruitment/steps.ts. */
        step: v.optional(v.string()),
      })
    ),

    // Duplicate tracking
    // When a case is created as a duplicate (user chose "Create Anyway"), this stores the original
    duplicateOf: v.optional(v.id("cases")),
    // Timestamp when this case was marked as a duplicate (for filtering/metrics)
    markedAsDuplicateAt: v.optional(v.number()),

    // Closure tracking (auto-closure and manual)
    closureReason: v.optional(v.union(
      // Auto-closure reasons
      v.literal("pwd_expired"),
      v.literal("recruitment_window_missed"),
      v.literal("filing_window_missed"),
      v.literal("eta9089_expired"),
      // Manual closure reasons
      v.literal("withdrawn"),
      v.literal("denied"),
      v.literal("manual"),
      v.literal("other")
    )),
    closedAt: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_user_id", ["userId"])
    .index("by_user_and_deleted", ["userId", "deletedAt"])
    .index("by_user_and_duplicate", ["userId", "duplicateOf"])
    .index("by_user_and_status", ["userId", "caseStatus"])
    .index("by_user_and_favorite", ["userId", "isFavorite"])
    .index("by_user_and_priority", ["userId", "priorityLevel"])
    .index("by_user_and_updated_at", ["userId", "updatedAt"]) // ISS-009: Sorting index
    .index("by_deleted_at", ["deletedAt"])
    // Collect every watchable saved case across all accounts for the 5-minute
    // DOL sweep (convex/appCaseWatch.ts): eq("deletedAt", undefined) then a
    // range q.gte("caseNumber", "") returns exactly the live cases that carry
    // a DOL number, since undefined sorts before "". Deleted cases and cases
    // without a number are skipped by the range, not read (Nov 4 2026: the
    // sweep had walked `by_case_number` and filtered deleted cases in JS,
    // reading each one whole every 5 minutes; nothing else read that index).
    .index("by_deletedAt_caseNumber", ["deletedAt", "caseNumber"])
    // Chatbot-ready indexes for deadline queries
    .index("by_user_and_filing_deadline", ["userId", "filingWindowCloses"])
    .index("by_user_and_pwd_expiration", ["userId", "pwdExpirationDate"])
    .index("by_user_and_recruitment_end", ["userId", "recruitmentEndDate"])
    .index("by_user_and_recruitment_window", ["userId", "recruitmentWindowCloses"]),

  /**
   * A case's applicant log (20 CFR 656.17(g)): one row per U.S. applicant, with a reference the account chooses (the
   * form asks for no name or contact details), the dates, how the applicant was contacted, and the job-related
   * reason the account wrote. People write every reason; nothing here screens or ranks an applicant. Deleted with its
   * case and with the account (cases.remove, lib/deletion.ts), as the Privacy Policy's Case Data list says.
   */
  recruitmentApplicants: defineTable({
    userId: v.id("users"),
    caseId: v.id("cases"),
    ref: v.string(),
    appliedOn: v.optional(v.string()),
    /** The recruitment step the applicant answered: a key of convex/lib/perm/recruitment/steps.ts. */
    source: v.optional(v.string()),
    contactedOn: v.optional(v.string()),
    contactMethod: v.optional(
      v.union(v.literal("email"), v.literal("phone"), v.literal("letter"), v.literal("in_person"), v.literal("other")),
    ),
    outcome: v.union(
      v.literal("pending"),
      v.literal("not_qualified"),
      v.literal("no_response"),
      v.literal("declined"),
      v.literal("not_available"),
      v.literal("withdrew"),
      v.literal("hired"),
      v.literal("other"),
    ),
    reason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_caseId", ["caseId"])
    .index("by_userId", ["userId"]),

  /**
   * A case's recruitment record shared with the client by link (convex/recruitmentShares.ts). Only the SHA-256 of the
   * link's key is stored (convex/lib/shareToken.ts), so a link can't be shown again. One live link per case: a
   * turned-off link answers nothing and is cleared when the next one is made. `lastViewedOn` is the Eastern day the
   * page was last opened, noted by the page's script, never by the request itself. Deleted with its case and with
   * the account (cases.remove, lib/deletion.ts), as the Privacy Policy says.
   */
  recruitmentShares: defineTable({
    userId: v.id("users"),
    caseId: v.id("cases"),
    tokenHash: v.string(),
    createdAt: v.number(),
    turnedOffAt: v.optional(v.number()),
    lastViewedOn: v.optional(v.string()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_caseId", ["caseId"])
    .index("by_userId", ["userId"]),

  /**
   * A second person who gets a case's deadline reminders too, a paralegal or the employer's HR contact
   * (convex/reminderRecipients.ts). One per case, added by the case's own account. The address gets one invitation
   * and nothing more until it confirms; a waiting invitation is deleted after 30 days. Once confirmed, the daily
   * reminder run sends it that case's due reminders, by the owner's own deadline switches. Stopping them (the link in
   * each email) erases the address and keeps the row as "stopped" so the owner sees it; the owner removing it deletes
   * the row; it goes with its case and with the account (lib/deletion.ts), as the Privacy Policy says.
   */
  reminderRecipients: defineTable({
    userId: v.id("users"),
    caseId: v.id("cases"),
    /** Trimmed and lowercased. Erased when the person stops the reminders. */
    email: v.optional(v.string()),
    status: v.union(v.literal("waiting"), v.literal("confirmed"), v.literal("stopped")),
    invitedAt: v.number(),
    confirmedAt: v.optional(v.number()),
    stoppedAt: v.optional(v.number()),
    /** Set when the invitation couldn't be sent and won't be tried again. */
    inviteFailedAt: v.optional(v.number()),
    /** The Eastern day the last reminder went, so a day's run never sends twice. */
    lastSentDay: v.optional(v.string()),
  })
    .index("by_caseId", ["caseId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_status_and_invitedAt", ["status", "invitedAt"]),

  /**
   * Addresses that asked not to be added to a case's deadline reminders again (convex/reminderRecipients.ts).
   * "Don't invite me again" in an invitation refuses every account: the row has no `userId`, and it's kept
   * indefinitely. The Stop link in a reminder refuses only the account that added the address: the row holds that
   * account's id and goes with the account (lib/deletion.ts). Only a keyed one-way hash of the address is kept
   * (reminderAddressKey), never the address, so the list can be asked about one address but can't say who's on it,
   * as the Privacy Policy says.
   */
  reminderRefusals: defineTable({
    addressKey: v.string(),
    refusedAt: v.number(),
    /** The account a Stop refused; absent for "Don't invite me again", which refuses every account. */
    userId: v.optional(v.id("users")),
  }).index("by_userId_and_addressKey", ["userId", "addressKey"]),

  /**
   * How many invitations to a case's deadline reminders one account has sent one address, in all, for the cap of
   * REMINDER_INVITES_PER_ADDRESS (convex/lib/reminderRecipients.ts). The address as the same keyed one-way hash,
   * never the address. Goes with the account (lib/deletion.ts).
   */
  reminderInviteCounts: defineTable({
    userId: v.id("users"),
    addressKey: v.string(),
    count: v.number(),
    lastInvitedAt: v.number(),
  }).index("by_userId_and_addressKey", ["userId", "addressKey"]),

  // Notifications for deadline alerts and system messages
  notifications: defineTable({
    // Relationships
    userId: v.id("users"),
    caseId: v.optional(v.id("cases")), // Optional - system notifications don't have case

    // Notification content
    type: v.union(
      v.literal("deadline_reminder"),
      v.literal("status_change"),
      v.literal("rfe_alert"),
      v.literal("rfi_alert"),
      v.literal("system"),
      v.literal("auto_closure")
    ),
    title: v.string(),
    message: v.string(),

    // Priority
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent")
    ),

    // Deadline information
    deadlineDate: v.optional(v.string()), // ISO date
    deadlineType: v.optional(v.string()), // e.g., "pwd_expiration", "rfi_due"
    daysUntilDeadline: v.optional(v.number()),

    // Read status
    isRead: v.boolean(),
    readAt: v.optional(v.number()),

    // Email status
    emailSent: v.boolean(),
    emailSentAt: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_id", ["userId"])
    .index("by_user_and_unread", ["userId", "isRead"])
    .index("by_case_id", ["caseId"])
    .index("by_deadline_date", ["deadlineDate"]),

  // Chatbot conversation tracking
  conversations: defineTable({
    userId: v.id("users"),
    title: v.string(),
    isArchived: v.boolean(),
    // Conversation context metadata
    metadata: v.optional(
      v.object({
        // Related case for context
        relatedCaseId: v.optional(v.id("cases")),
        // Conversation type/purpose
        conversationType: v.optional(
          v.union(
            v.literal("general"),
            v.literal("case_inquiry"),
            v.literal("deadline_help"),
            v.literal("document_help")
          )
        ),
        // Last active timestamp for cleanup
        lastActiveAt: v.optional(v.number()),
        // Custom tags for organization
        tags: v.optional(v.array(v.string())),
      })
    ),
    // Conversation summary for context compression
    summary: v.optional(
      v.object({
        content: v.string(), // Compressed history text (prose, bounded at ~1000 tokens)
        facts: v.optional(v.string()), // JSON string of structured entities (cases, people, dates, preferences, openActions) — merged losslessly across compactions
        tokenCount: v.number(), // Approximate tokens in summary
        messageCountAtSummary: v.number(), // Messages when summarized
        lastSummarizedAt: v.number(), // Timestamp of summarization
        summarizingAt: v.optional(v.number()), // Race lock: timestamp when summarization started, cleared on finish. Stale entries (>60s) are treated as unlocked.
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_id", ["userId"])
    .index("by_user_and_archived", ["userId", "isArchived"])
    // Newest first for the history panel and "resume the latest" (bounded reads).
    .index("by_user_and_updated", ["userId", "updatedAt"]),

  // Chatbot message history
  conversationMessages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system")
    ),
    content: v.string(),
    // Tool calls made by the assistant
    toolCalls: v.optional(
      v.array(
        v.object({
          tool: v.string(),
          // Arguments are JSON-serialized to string for consistent storage
          arguments: v.string(),
          // Result is JSON-serialized to string for consistent storage
          result: v.optional(v.string()),
          status: v.optional(
            v.union(
              v.literal("pending"),
              v.literal("success"),
              v.literal("error")
            )
          ),
          executedAt: v.optional(v.number()),
        })
      )
    ),
    // Message metadata
    metadata: v.optional(
      v.object({
        // Citations or references
        citations: v.optional(
          v.array(
            v.object({
              caseId: v.optional(v.id("cases")),
              field: v.optional(v.string()),
              value: v.optional(v.string()),
            })
          )
        ),
        // Processing time in ms
        processingTimeMs: v.optional(v.number()),
        // Model used (for debugging)
        model: v.optional(v.string()),
        // Token usage
        tokenCount: v.optional(v.number()),
        // Why a reply stopped early, so a saved reply still says so
        // (the output cap, or the tool-step cap). Sep 29 2026.
        cutShort: v.optional(v.union(v.literal("length"), v.literal("steps"))),
        // The reply was interrupted (stopped, a dropped connection, a failed
        // model) after some of its actions had run; saved so they're on record.
        incomplete: v.optional(v.boolean()),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_conversation_id", ["conversationId"])
    .index("by_created_at", ["createdAt"]),

  // Audit logging for detailed change tracking (append-only, but for a deleted case's copy: convex/lib/deletedCases.ts)
  auditLogs: defineTable({
    userId: v.id("users"), // Who made the change
    tableName: v.string(), // Which table was affected
    documentId: v.string(), // ID of affected document (stored as string for flexibility)
    action: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete")
    ),
    changes: v.optional(
      v.array(
        v.object({
          field: v.string(),
          // Values are serialized to string for consistency across all field types
          oldValue: v.optional(v.string()),
          newValue: v.optional(v.string()),
        })
      )
    ),
    metadata: v.optional(
      v.object({
        ipAddress: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        source: v.optional(v.string()), // "web", "api", "chatbot"
      })
    ),
    timestamp: v.number(),
    // A case's deletion row holds the whole case (`changes`) for DELETED_CASE_DAYS, so its owner can restore it from
    // Settings (convex/caseRestore.ts). When it was restored, as which new case, and when the retention run erased
    // the copy, keeping the row's who and when.
    restoredAt: v.optional(v.number()),
    restoredCaseId: v.optional(v.id("cases")),
    erasedAt: v.optional(v.number()),
  })
    .index("by_user_id", ["userId"])
    .index("by_table_name", ["tableName"])
    .index("by_document_id", ["documentId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_user_and_table", ["userId", "tableName"])
    .index("by_user_and_timestamp", ["userId", "timestamp"])
    // An account's case deletions not yet restored, newest first: Settings' "Recently deleted".
    .index("by_user_table_action_restored_and_timestamp", ["userId", "tableName", "action", "restoredAt", "timestamp"])
    // Case deletions whose copy is still held, oldest first: the retention run's erasure.
    .index("by_table_action_erased_and_timestamp", ["tableName", "action", "erasedAt", "timestamp"]),

  // Custom case order (drag-drop reordering)
  userCaseOrder: defineTable({
    userId: v.id("users"),
    // Ordered array of case IDs (defines the custom order)
    caseIds: v.array(v.id("cases")),
    // Snapshot of active filters when custom order was saved
    // (status/progressStatus single-sourced from lib/perm/statusTypes)
    filters: v.object({
      status: v.optional(caseStatusValidator),
      progressStatus: v.optional(progressStatusValidator),
      searchQuery: v.optional(v.string()),
      favoritesOnly: v.optional(v.boolean()),
    }),
    // Sort method active when custom order was saved (for handling new cases)
    baseSortMethod: v.union(
      v.literal("deadline"),
      v.literal("updated"),
      v.literal("employer"),
      v.literal("status"),
      v.literal("pwdFiled"),
      v.literal("etaFiled"),
      v.literal("i140Filed")
    ),
    baseSortOrder: v.union(v.literal("asc"), v.literal("desc")),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_id", ["userId"]),

  // Timeline display preferences
  timelinePreferences: defineTable({
    userId: v.id("users"),
    // Selected case IDs (null = all active cases, empty array = none)
    selectedCaseIds: v.optional(v.array(v.id("cases"))),
    // Time range in months (3, 6, 12, or 24)
    timeRange: v.union(
      v.literal(3),
      v.literal(6),
      v.literal(12),
      v.literal(24)
    ),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_id", ["userId"]),

  // Rate limiting table for tracking request attempts
  // Used to protect auth endpoints from brute force attacks
  rateLimits: defineTable({
    key: v.string(), // Composite key: action:identifier
    timestamp: v.number(), // When the attempt occurred
    identifier: v.string(), // Email, IP, or user ID
    action: v.string(), // Action type (e.g., "otp_verify", "password_reset")
  })
    .index("by_key_and_timestamp", ["key", "timestamp"])
    .index("by_timestamp", ["timestamp"]), // For cleanup queries

  // Abuse blocklist — IPs auto-banned after repeat rate-limit offenses.
  // Middleware short-circuits on any entry whose expiresAt > now.
  // Entries auto-expire; cleanup cron removes stale rows to bound table size.
  abuseBlocklist: defineTable({
    ip: v.string(),              // Normalized client IP (lowercased, first-hop only)
    addedAt: v.number(),         // When the block was created
    expiresAt: v.number(),       // Absolute timestamp when block auto-lifts
    reason: v.string(),          // Why blocked (e.g., "ip_auth_limit_tripped_3x")
    strikes: v.number(),         // Accumulated rate-limit strikes that led here
    manualOverride: v.boolean(), // True when an admin set/cleared this manually
  })
    .index("by_ip", ["ip"])
    .index("by_expiresAt", ["expiresAt"]), // For cleanup

  // API usage tracking for external search providers
  // Used to enforce daily rate limits for web search APIs
  apiUsage: defineTable({
    provider: v.string(), // "tavily" | "brave"
    date: v.string(), // YYYY-MM-DD (UTC)
    count: v.number(), // Number of API calls made
  }).index("by_provider_date", ["provider", "date"]),

  // Tool result caching for chat API
  // Caches expensive tool calls (case queries, knowledge search, web search)
  // to avoid redundant API calls within a conversation
  toolCache: defineTable({
    conversationId: v.id("conversations"),
    toolName: v.string(), // "query_cases" | "search_knowledge" | "search_web"
    queryHash: v.string(), // Hash of query params for lookup
    queryParams: v.string(), // JSON of original params (for debugging)
    result: v.string(), // JSON stringified result
    createdAt: v.number(),
    expiresAt: v.number(), // TTL-based expiration
  })
    .index("by_conversation_tool_hash", ["conversationId", "toolName", "queryHash"])
    .index("by_expires", ["expiresAt"]),

  /**
   * Confirmation cards the chat has shown. Approving one runs the action stored
   * here, once: the browser sends only the card's id, so it can't change what
   * runs, replay an approval from another tab, or approve a card nobody issued.
   * A single-case card keeps the case's updatedAt from when it was shown and is
   * refused if the case has changed since. Cards expire after a day; the daily
   * retention run deletes rows after 30 days.
   */
  chatConfirmations: defineTable({
    userId: v.id("users"),
    toolCallId: v.string(),
    toolName: v.string(),
    args: v.string(), // JSON of the arguments that will run
    argsHash: v.string(), // sha256 of toolName + canonical args, for duplicate cards
    description: v.string(),
    caseId: v.optional(v.id("cases")),
    caseUpdatedAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    // An identical card still waiting when this one was shown: approving
    // either runs the action once.
    sameAs: v.optional(v.string()),
    result: v.optional(v.string()), // one-line summary of what happened
    createdAt: v.number(),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_user_tool_call", ["userId", "toolCallId"])
    .index("by_user_hash", ["userId", "argsHash"]),

  /**
   * Job Description Templates
   *
   * Reusable job description templates for PERM cases.
   * Templates are user-scoped and identified by position title (name).
   * No duplicate names allowed per user.
   *
   * Usage: When filling out PERM applications, attorneys often need
   * the same job description text for multiple postings. Templates
   * allow saving and reusing descriptions efficiently.
   */
  jobDescriptionTemplates: defineTable({
    // Owner
    userId: v.id("users"),

    // Template identity - position title serves as the template name
    // Must be unique per user (enforced in mutations)
    name: v.string(),

    // The actual job description text
    description: v.string(),

    // Usage tracking
    usageCount: v.number(), // Incremented when template is loaded
    lastUsedAt: v.optional(v.number()), // Timestamp of last use

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()), // Soft delete
  })
    .index("by_user_id", ["userId"])
    .index("by_user_and_name", ["userId", "name"])
    .index("by_deleted_at", ["deletedAt"]),

  // =========================================================================
  // Support Emails
  // =========================================================================

  /**
   * Inbound support emails received via Resend webhook.
   * Stores full email content for admin review and threaded replies.
   */
  supportEmails: defineTable({
    // Sender info
    fromEmail: v.string(),
    fromName: v.optional(v.string()),

    // Recipient (usually support@permtracker.app)
    toEmail: v.string(),

    // Email content
    subject: v.string(),
    bodyHtml: v.optional(v.string()),
    bodyText: v.optional(v.string()),

    // Threading headers
    messageId: v.string(),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),

    // Resend metadata
    resendEmailId: v.string(),

    // Status tracking. "held": the content check (convex/lib/spamCheck.ts) kept it
    // out of the owner's inbox; listed on the admin page, deleted 30 days after heldAt.
    status: v.union(
      v.literal("received"),
      v.literal("replied"),
      v.literal("forwarded"),
      v.literal("archived"),
      v.literal("held")
    ),

    // The content check's verdict, for held mail and for the admin page's list.
    spamScore: v.optional(v.number()),
    spamReasons: v.optional(v.array(v.string())),
    heldAt: v.optional(v.number()),
    /** "Not spam" pressed on the admin page: sent on to the owner then. */
    releasedAt: v.optional(v.number()),
    /** A service's own notices (Medium's): sent on, kept out of the admin page's list. */
    notice: v.optional(v.boolean()),
    /** The mail Worker's forward to the owner failed twice: the message is stored but never reached the inbox. */
    forwardFailed: v.optional(v.boolean()),
    /** The spam check ran without its AI opinion (the model failed, was retired or ran out of allowance). */
    aiFailed: v.optional(v.boolean()),

    // Admin reply (stored for history)
    replyBody: v.optional(v.string()),
    repliedAt: v.optional(v.number()),
    replyMessageId: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    // A message Cloudflare delivers twice (a retry) is stored once.
    .index("by_message_id", ["messageId"])
    .index("by_created_at", ["createdAt"])
    .index("by_from_email", ["fromEmail"])
    .index("by_held_at", ["heldAt"]),

  /**
   * The owner's word on a sender, from the admin page: "allow" when a held message
   * was let through ("Not spam"), "block" when mail that got through was marked as
   * spam. Keyed by the address for free mail and by "@domain" otherwise
   * (senderKey in convex/lib/spamCheck.ts). The newest word wins.
   */
  mailSenderVerdicts: defineTable({
    key: v.string(),
    verdict: v.union(v.literal("allow"), v.literal("block")),
    at: v.number(),
  }).index("by_key", ["key"]),

  /**
   * System Errors
   *
   * Stores application errors for admin visibility and debugging.
   * Frontend errors are captured by Sentry; this table stores
   * backend (Convex) errors that need admin attention.
   */
  systemErrors: defineTable({
    // Single-sourced from `systemErrors.ts` — see `errorSourceValidator`.
    // `"query"` was removed here (no writer ever produced it; the mutation,
    // the `ErrorSource` TS type, and `sentryReportAction` all omit it).
    source: errorSourceValidator,
    operation: v.string(),
    message: v.string(),
    stack: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    resourceId: v.optional(v.string()),
    extra: v.optional(v.string()),
    resolved: v.boolean(),
    createdAt: v.number(),
    /** Its kind in the routing list (errors.once, errors.repeat or errors.blip); absent on rows before Nov 24 2026. */
    route: v.optional(v.string()),
  })
    .index("by_resolved", ["resolved", "createdAt"])
    .index("by_source", ["source", "createdAt"])
    .index("by_created_at", ["createdAt"]),

  /**
   * Append-only audit log of Resend contact webhook events (subscribe, unsubscribe, delete).
   * Resend remains the source of truth for current subscription status — this table mirrors
   * the event stream for analytics and churn visibility. Deduped by svix message ID.
   */
  marketingEvents: defineTable({
    svixId: v.string(), // Idempotency key from svix-id header
    email: v.string(),
    contactId: v.string(), // Resend contact UUID
    audienceId: v.optional(v.string()),
    // Event types: live Resend webhook deliveries + synthetic backfill rows
    // generated by `marketingEmail.backfillMarketingEvents`. Tightened from
    // v.string() to a literal union — all existing rows match these literals.
    // Single-sourced from `marketingWebhook.ts` (`contactEventTypeValidator`).
    eventType: contactEventTypeValidator,
    unsubscribed: v.boolean(),
    occurredAt: v.number(), // Resend's top-level created_at (epoch ms)
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    rawPayload: v.string(), // Full event JSON for debugging
  })
    .index("by_svix_id", ["svixId"])
    .index("by_email_and_time", ["email", "occurredAt"])
    .index("by_occurred", ["occurredAt"])
    .index("by_event_type_and_time", ["eventType", "occurredAt"]),

  /**
   * DOL processing-times snapshots
   *
   * Captures https://flag.dol.gov/processingtimes, which is the official
   * ground truth for where the PERM and prevailing-wage queues actually are.
   *
   * DOL publishes a SNAPSHOT and overwrites it each month. The page carries no
   * history and no archive, so the moment a new one goes up the previous
   * figures are gone. Keeping every snapshot is the entire point of this
   * table: it turns a single number into a measured series, which is what
   * lets the site state how far the queue moved between two real dates
   * instead of predicting where it will go next.
   *
   * Rows are immutable. A run only inserts when `contentHash` matches NO row we
   * already hold, so re-fetching an unchanged page is a no-op and the series
   * contains one row per genuine publication. Note that is any row, not merely
   * the newest: if DOL published A, then B, then reverted to exactly A, the
   * revert is treated as already-seen and not stored. That is deliberate (it
   * keeps a flapping page from filling the table) and narrow in practice,
   * because `permAsOf` is part of the hash, so a true revert would have to
   * restore the old as-of date too.
   */
  dolProcessingTimes: defineTable({
    // DOL's own as-of stamp for the PERM section (YYYY-MM-DD). The PERM and
    // prevailing-wage sections update on different cadences and carry
    // different dates, so they are stored separately rather than collapsed
    // into one misleading "last updated".
    permAsOf: v.string(),
    pwdAsOf: v.optional(v.string()),

    // Which filing month each PERM queue is currently working.
    // `priorityDate` is null where DOL prints "--".
    permQueues: v.array(
      v.object({
        queue: v.string(),
        priorityDate: v.union(v.string(), v.null()),
        raw: v.string(),
      }),
    ),

    // Average calendar days to a determination, as published by DOL.
    permAverageDays: v.array(
      v.object({
        determination: v.string(),
        month: v.union(v.string(), v.null()),
        calendarDays: v.union(v.number(), v.null()),
        raw: v.string(),
        /** The window the average covers ("Last 30 Days"); DOL averages by window from Oct 31 2026, with no month. */
        period: v.optional(v.string()),
      }),
    ),

    // Prevailing-wage queue across all programs (PERM, H-1B, H-2B, CW-1).
    pwdQueues: v.array(
      v.object({
        program: v.string(),
        oewsReceiptDate: v.union(v.string(), v.null()),
        nonOewsReceiptDate: v.union(v.string(), v.null()),
      }),
    ),

    // Prevailing-wage requests still pending for PERM, by month of receipt.
    pwdPermBacklog: v.array(
      v.object({
        receiptMonth: v.string(),
        remainingRequests: v.number(),
      }),
    ),

    // Canonical source recorded per row, so a stored snapshot is
    // self-describing if it is ever exported or cited.
    sourceUrl: v.string(),
    // When we fetched, as distinct from DOL's as-of date.
    fetchedAt: v.number(),
    // Stable hash of the parsed content. Drives insert-only-on-change, and
    // catches a silent DOL correction that reuses the same as-of date.
    contentHash: v.string(),
  })
    // by_perm_as_of was declared here and never queried. Dropped: an unused
    // index is a write cost on every insert and a false signal about how the
    // table is read.
    .index("by_fetched", ["fetchedAt"])
    .index("by_content_hash", ["contentHash"]),

  /**
   * USCIS I-140 counts, per petition subtype, for the newest published quarter.
   *
   * Separate from `i140ProcessingTimes` in the frontend, and the two answer
   * different questions on purpose. That table holds what USCIS says a case
   * takes, measured over petitions already decided. This one holds how many are
   * stacked up and how fast they are clearing, which on real figures disagrees:
   * the national interest waiver shows 89,215 pending against 6,325 completed
   * in a quarter, while USCIS says 80% finish within 30 months (Sep 2026).
   * Both are true, because NIW intake is outrunning its output.
   *
   * Ingested by `scripts/ingest_uscis_i140.py` from www.uscis.gov, which serves
   * scripts. The processing-time figures live on egov.uscis.gov behind a bot
   * challenge and are deliberately not fetched by anything.
   */
  uscisI140Stats: defineTable({
    /** The workbook this came from, e.g. `i140_fy2026_q2_v1.xlsx`. */
    sourceFile: v.string(),
    /** USCIS's own quarter label, e.g. `FY2026 Q2`. */
    asOfQuarter: v.string(),
    subtypes: v.array(
      v.object({
        /** USCIS subtype code, e.g. `NIW`. */
        code: v.string(),
        label: v.string(),
        received: v.number(),
        approved: v.number(),
        denied: v.number(),
        /** Awaiting a decision at quarter end. Never by receipt month: USCIS
         *  does not publish that, so "how many are ahead of me" is unanswerable. */
        pending: v.number(),
      }),
    ),
    computedAt: v.number(),
    /** Insert-only-on-change, matching the other ingested tables. */
    contentHash: v.string(),
  })
    .index("by_computed", ["computedAt"])
    .index("by_content_hash", ["contentHash"]),

  /**
   * Queue-reached alerts
   *
   * A visitor tells us the month their case was filed and we email them once,
   * when DOL's analyst-review queue actually reaches it. That is the single
   * question every PERM applicant has, and DOL's own page cannot answer it
   * because it only shows today's frontier and keeps no history.
   *
   * Deliberately minimal: an email address and a month. We ask an optional
   * role because it is the one field that changes what we build next, and
   * nothing else, because nothing else would be used.
   *
   * Double opt-in. A row is inert until `confirmedAt` is set, so a typo'd or
   * malicious address never receives mail. Confirm and unsubscribe both run on
   * the existing HMAC token scheme rather than a guessable id.
   */
  dolQueueAlerts: defineTable({
    email: v.string(),
    /**
     * Retired Oct 31 2026 (the site is English only): kept so the rows a translated page
     * wrote Oct 29 to 31 still validate. Nothing reads or writes it.
     */
    lang: v.optional(v.string()),
    /** Month the case was filed with DOL, "YYYY-MM". */
    filingMonth: v.string(),
    /**
     * WHICH DOL queue the month is measured against. Absent means "perm"
     * (the analyst-review frontier) - every row that existed before the PWD
     * queues were added has no value here, and rewriting history to add one
     * would churn rows for nothing. The PWD variants compare the same
     * "YYYY-MM" month against the OEWS / non-OEWS receipt-date frontiers
     * from the same DOL snapshot.
     */
    queue: v.optional(
      v.union(
        v.literal("perm"),
        v.literal("pwd-oews"),
        v.literal("pwd-nonoews"),
      ),
    ),
    /** Optional, and the only segmentation we collect. */
    role: v.optional(
      v.union(v.literal("attorney"), v.literal("applicant"), v.literal("employer")),
    ),

    /** Null until the address is confirmed; nothing is ever sent before then. */
    confirmedAt: v.optional(v.number()),
    /**
     * A month change requested by an unauthenticated POST, held here until the
     * inbox owner clicks a fresh confirm link.
     *
     * Applying a change straight to `filingMonth` would let anyone who knows an
     * address rewrite that person's subscription, resurrect an opt-out, or reset
     * `notifiedAt` to trigger another send. Staging it means a hostile POST costs
     * one confirmation email and changes nothing.
     */
    pendingFilingMonth: v.optional(v.string()),
    /**
     * Throttles repeat confirmation sends to THIS address. It cannot stop an
     * attacker cycling fresh addresses, which is what the per-IP limit on the
     * HTTP route is for. Written before the send, so it records intent; a
     * failed send clears it (see queueAlerts.clearConfirmationCooldown).
     */
    lastConfirmationSentAt: v.optional(v.number()),
    /** Set once the queue reached their month and we sent the one alert. */
    notifiedAt: v.optional(v.number()),
    /**
     * A sweep is sending this row's alert (`queueAlerts.claimQueueSend`), set before the send and cleared when
     * the alert is recorded or the send fails, so a run that dies between the two can't hand the same subscriber
     * to the next run. A claim older than SEND_CLAIM_MS (convex/lib/alertDelivery.ts) is a run that died: marked
     * told when its alert reached the outbox (`deliveredSince`), taken over when it didn't.
     */
    sendingAt: v.optional(v.number()),
    /** Set when they opt out. Rows are kept so a later re-subscribe is honest. */
    unsubscribedAt: v.optional(v.number()),

    createdAt: v.number(),
    /** Where the signup happened, so we can see which page actually converts. */
    source: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    /**
     * Drives the notify sweep.
     *
     * Field order matters and is not cosmetic. Leading with the two "is this
     * row still live" flags means the range scan starts inside the un-notified,
     * un-unsubscribed rows and never walks the ones already dealt with. An
     * earlier version indexed `filingMonth` alone, so the sweep selected every
     * row at or before the frontier and filtered in JS: as the frontier
     * advanced that became a full-table read on every run, re-reading rows it
     * had already notified, forever.
     *
     * `confirmedAt` is deliberately NOT in the index. Convex allows a range
     * comparison only on the final indexed field, and `filingMonth` has to hold
     * that position, so adding it would force `filingMonth` to equality.
     */
    .index("by_alert_sweep", ["notifiedAt", "unsubscribedAt", "filingMonth"])
    .index("by_created", ["createdAt"])
    /** Retention's read of unconfirmed sign-ups past the horizon, so confirmed rows never stand in front. */
    .index("by_confirmed_created", ["confirmedAt", "createdAt"]),

  /**
   * How useful a subscriber found their case alerts, sent from the 1-to-5 row
   * in the last alert (the one that says the case is decided). One row per
   * address and case: a second rating replaces the first. Written by
   * `alertRatings.recordClick` (a box opened from the email, saved on open) and
   * `alertRatings.record` (a tap or a note on the page), behind a signed link,
   * and only for an address that really watched that case.
   */
  alertRatings: defineTable({
    /**
     * SHA-256 of "<address>|<case number>": what keeps one row per person and
     * case, and the only trace of who rated once they ask to be anonymous.
     */
    key: v.string(),
    /** Absent once the rater asked to leave their address off. */
    email: v.optional(v.string()),
    caseNumber: v.optional(v.string()),
    /** They ticked "leave my email off this note"; never undone by a later tap. */
    anonymous: v.optional(v.boolean()),
    /**
     * 1 (not useful) to 5 (very useful): the newest pick a person made. Absent while every open of the links
     * looks like a mail scanner (a burst of different scores within a minute), which is no one's rating.
     */
    score: v.optional(v.number()),
    /** Their own words, plain text, at most NOTE_MAX characters. */
    note: v.optional(v.string()),
    /**
     * Every open of a rating link and every tap on the page, newest last, the newest CLICKS_KEPT kept: when, which
     * score, where (the email's box or the page), the browser it came from, and whether it looked like a scanner.
     */
    clicks: v.optional(
      v.array(
        v.object({
          score: v.number(),
          at: v.number(),
          via: v.union(v.literal("email"), v.literal("page")),
          browser: v.optional(v.string()),
          scanner: v.optional(v.boolean()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_updatedAt", ["updatedAt"]),

  /**
   * Someone waiting on ONE specific PERM case, by case number.
   *
   * Sibling of `dolQueueAlerts` and deliberately a separate table rather than a
   * variant of it. That one answers a COHORT question ("has DOL reached my
   * filing month") and fires exactly once, ever. This one answers a PER-CASE
   * question ("did anything happen to mine") and fires every time the status
   * moves, until the case reaches a final status and the subscription retires
   * itself. Same shape of consent, completely different lifecycle, and merging
   * them would mean one row carrying two `notifiedAt` semantics.
   *
   * One row per (email, caseNumber): a person routinely waits on their own case
   * and a spouse's.
   */
  caseStatusAlerts: defineTable({
    email: v.string(),
    /**
     * Retired Oct 31 2026 (the site is English only): kept so the rows a translated page
     * wrote Oct 29 to 31 still validate. Nothing reads or writes it.
     */
    lang: v.optional(v.string()),
    /** Normalised DOL case number, e.g. "P-100-26125-868956". */
    caseNumber: v.string(),

    /**
     * The status as of the last time we told this subscriber, or as of the
     * moment they confirmed.
     *
     * THIS is the change detector, and it lives here rather than being read
     * back out of the mirror because the question is not "has the case moved"
     * but "has it moved since THIS subscriber last heard from us". A subscriber
     * who signs up the day after a transition must not be mailed about it.
     *
     * Compared with an explicit inequality between two defined values. A
     * truthiness check here would fire on every sweep for every row.
     */
    lastSeenStatus: v.optional(v.string()),

    /** Null until the address is confirmed; nothing is ever sent before then. */
    confirmedAt: v.optional(v.number()),
    /**
     * A sweep is sending the email for this status (`claimAlertSend`), so a
     * second sweep running at the same moment skips the row instead of
     * sending it twice. Cleared when the alert is recorded or the send fails;
     * a claim older than ALERT_SEND_CLAIM_MS is recorded as told when its
     * alert reached the outbox, and taken over when it didn't.
     */
    sendingStatus: v.optional(v.string()),
    sendingAt: v.optional(v.number()),
    /**
     * A case number requested by an unauthenticated POST, held until the inbox
     * owner clicks a fresh confirm link. Same reasoning as
     * `dolQueueAlerts.pendingFilingMonth`: writing straight to `caseNumber`
     * would let anyone who knows an address repoint that person's alerts.
     */
    pendingCaseNumber: v.optional(v.string()),
    /** Throttles repeat confirmations to THIS address. Records intent, not delivery. */
    lastConfirmationSentAt: v.optional(v.number()),
    /**
     * Staged inside another confirmation's ten-minute cooldown, so no email has named it yet. When the cooldown
     * ends, one follow-up confirmation names every row of the address that carries this (and clears it). A
     * click on the first email in the meantime confirms the row and clears it too.
     */
    confirmationOwed: v.optional(v.boolean()),

    /**
     * When the sweep retired the row: a year after DOL decided the case, with
     * nothing moved since (`decidedAt`). Retired rows leave the sweep.
     *
     * Until Oct 7 2026 it was set on the decision itself. But a decision is not
     * always the end: in the month to Sep 25 2026, 2,541 denied PERM cases went
     * to reconsideration appeals and 105 withdrawn ones came back certified,
     * and the person watching heard none of it.
     */
    caseClosedAt: v.optional(v.number()),
    /**
     * When the case reached its current final status. The row keeps being
     * watched for WATCH_AFTER_DECISION_MS from here, in case it is appealed or
     * reopened; a move back out of a final status clears it.
     */
    decidedAt: v.optional(v.number()),
    /**
     * When the sweep last LOOKED at this row, whether or not anything moved.
     *
     * This is the sweep's cursor and it has to be distinct from
     * `lastAlertSentAt`. Using the send stamp as the cursor starves the tail of
     * the table: a subscription whose case has not moved never gets a send, so
     * its stamp stays undefined, so it sorts first on every single run and the
     * rows behind it are never reached. Bumping this on every read makes the
     * sweep round-robin over the whole table by construction.
     */
    lastCheckedAt: v.optional(v.number()),
    /** When we last mailed this subscriber. Drives the per-subscription cooldown only. */
    lastAlertSentAt: v.optional(v.number()),
    /** How many alerts this subscription has produced. Honest volume reporting. */
    alertCount: v.optional(v.number()),

    unsubscribedAt: v.optional(v.number()),
    createdAt: v.number(),
    /** Which page the signup came from. */
    source: v.optional(v.string()),
  })
    /** Token lookup and one-click unsubscribe, which act on every row for an address. */
    .index("by_email", ["email"])
    /** The upsert path on subscribe, and the only unique key. */
    .index("by_email_case", ["email", "caseNumber"])
    /**
     * Drives the sweep. Field order is load-bearing, exactly as it is on
     * `dolQueueAlerts.by_alert_sweep`.
     *
     * The two equality fields mean "is this subscription still live", so the
     * scan starts inside the rows that can still produce an email and never
     * walks a retired or opted-out one. `lastCheckedAt` holds the final
     * position because Convex allows a range comparison only there, and
     * because ascending order on it IS the round-robin: the least recently
     * checked rows come first, and rows never checked sort before every number
     * so a new subscription is looked at on the next sweep.
     *
     * `confirmedAt` is deliberately NOT indexed. It would have to take the
     * range position, and a "not undefined" test is a worse use of that slot
     * than the cursor. It is filtered in JS after the index has already cut
     * the read down to live rows.
     */
    .index("by_alert_sweep", ["unsubscribedAt", "caseClosedAt", "lastCheckedAt"])
    .index("by_created", ["createdAt"]),

  /**
   * Receipt numbers typed into the USCIS lookup, for the sample to check with the numbers around them
   * (convex/uscisTyped.ts; the Privacy Policy, "Our sample of USCIS cases"). The number alone: no email, no address.
   */
  uscisTypedReceipts: defineTable({
    /** Upper-cased, three letters and ten digits (`watchableReceipt`). */
    receipt: v.string(),
    firstAt: v.number(),
    lastAt: v.number(),
    times: v.number(),
  })
    .index("by_receipt", ["receipt"])
    .index("by_firstAt", ["firstAt"])
    .index("by_lastAt", ["lastAt"]),

  /** How many new typed numbers each Eastern day took, against TYPED_DAILY_MAX. */
  uscisTypedDays: defineTable({
    day: v.string(),
    n: v.number(),
  }).index("by_day", ["day"]),

  /**
   * Someone watching one USCIS receipt by email: the receipt tracking beta (convex/uscisAlerts.ts).
   *
   * The sibling of `caseStatusAlerts`, with the same consent grammar: an unauthenticated sign-up writes an
   * unconfirmed row, a click on the emailed link (a POST, never a GET) confirms it, and nothing is ever sent before
   * that. Two differences, both for privacy. A stop DELETES the row instead of tombstoning it, so a receipt number is
   * held only while someone wants it watched; a replayed confirm link then finds nothing to confirm. And the row
   * keeps only what it last alerted (`lastAlertedStatus`): USCIS's newest status lives once, per receipt, in
   * `uscisReceipts`. Every field here is one the Privacy Policy's receipt-alerts section names
   * (src/app/__tests__/uscis-alerts-policy.test.ts holds the two together).
   */
  uscisWatches: defineTable({
    /** Lower-cased. */
    email: v.string(),
    /** Upper-cased, three letters and ten digits (`watchableReceipt` in convex/lib/uscisWatch.ts). */
    receipt: v.string(),
    /** The person's DOL case number, when they gave one on sign-up: the PERM the receipt follows. */
    dolCaseNumber: v.optional(v.string()),
    createdAt: v.number(),
    /** Which page the sign-up came from. */
    source: v.optional(v.string()),
    /** When the inbox's owner confirmed, which is also when they agreed to the policy. Unset means never sent to. */
    confirmedAt: v.optional(v.number()),
    /** Throttles repeat confirmations to this address. Records intent, not delivery. */
    lastConfirmationSentAt: v.optional(v.number()),
    /** Staged inside another confirmation's ten minutes; one follow-up email names every such row. */
    confirmationOwed: v.optional(v.boolean()),
    /**
     * The status this person was last told about, or the first status seen after they confirmed (which is told
     * nothing). The change detector: an email goes when USCIS's newest status for the receipt differs from it.
     */
    lastAlertedStatus: v.optional(v.string()),
    lastAlertedAt: v.optional(v.number()),
    /** True while USCIS's newest status differs from `lastAlertedStatus`: an email is owed. Indexed for the retry run. */
    alertDue: v.optional(v.boolean()),
    /** A send in progress (`claimDue`): its start, the status it carries and the outbox ref it goes under. */
    sendingAt: v.optional(v.number()),
    sendingStatus: v.optional(v.string()),
    sendingRef: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_email_receipt", ["email", "receipt"])
    .index("by_receipt", ["receipt"])
    .index("by_due", ["alertDue"])
    .index("by_confirmed_created", ["confirmedAt", "createdAt"]),

  /**
   * The one home of each watched receipt's newest USCIS status (convex/uscisAlerts.ts), written by the private
   * checker through POST /uscis-watched/results. A row exists only while at least one confirmed watch holds the
   * receipt (`watchers`), and goes with the last one, so a receipt nobody watches is never kept.
   */
  uscisReceipts: defineTable({
    receipt: v.string(),
    /** Confirmed watches holding this receipt. */
    watchers: v.number(),
    /** USCIS's status title, as the checker read it. Unset until the first check that found the case. */
    status: v.optional(v.string()),
    group: v.optional(v.string()),
    form: v.optional(v.string()),
    /** When the checker last asked USCIS about it, whatever the answer. */
    checkedAt: v.optional(v.number()),
    /** When the checker first saw the current status. */
    changedAt: v.optional(v.number()),
    /** When the current status, a final one, was first seen: a year after it with nothing new, the watches end. */
    finalSince: v.optional(v.number()),
    /** True when the newest check found no case under the receipt. The last status found is kept. */
    notFound: v.optional(v.boolean()),
  }).index("by_receipt", ["receipt"]),

  /** The tracking beta's one counter: how many receipts are watched, against the beta's cap. */
  uscisWatchMeta: defineTable({
    key: v.literal("main"),
    receipts: v.number(),
    /** When the checker last posted results. */
    lastResultsAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  /**
   * Someone watching ONE visa-bulletin series: a category x country cutoff.
   *
   * Third sibling of `dolQueueAlerts` / `caseStatusAlerts`, same consent
   * grammar on purpose: double opt-in, staged changes, tombstoned opt-outs,
   * purpose-scoped tokens (`bulletin-confirm` / `bulletin-unsubscribe`).
   * Recurring like case alerts (a cutoff can move every month), not one-shot
   * like queue alerts, so it carries `lastSeenCutoff` as its change detector
   * rather than `notifiedAt`.
   */
  /**
   * The PERM applications we've told a wage request's subscriber may be theirs
   * (convex/pipelineMatches.ts). One row per PERM told, so nothing is told
   * twice to one address, and a wage request is told about three at most.
   */
  permMatchNotices: defineTable({
    subscriptionId: v.id("caseStatusAlerts"),
    email: v.string(),
    /** The watched wage request, "P-100-...". */
    pwdCaseNumber: v.string(),
    /** The PERM told about. */
    permCaseNumber: v.string(),
    /** Its filing day, "YYYY-MM-DD". */
    filingDate: v.string(),
    toldAt: v.number(),
    /**
     * Set while a sweep is sending the email that tells it (`pipelineMatches.reserveTold`), cleared once the
     * email went (`recordTold`); the row is deleted if the send fails (`releaseTold`). A reservation counts as
     * told for SEND_CLAIM_MS (convex/lib/alertDelivery.ts); after that a run that died between the send and the
     * record is recorded as told when its email reached the outbox, and taken over when it didn't.
     */
    sendingAt: v.optional(v.number()),
  })
    .index("by_subscription", ["subscriptionId"])
    .index("by_email_perm", ["email", "permCaseNumber"])
    .index("by_told", ["toldAt"]),

  /**
   * The founder's congratulations note, one row per watched case that earned one (convex/congratsNotes.ts,
   * words in convex/lib/congratsNote.ts). Nothing here sends: a person reads each note and sends it from the
   * press mailbox, then records it. `state`: due (waiting for its day and a read), scheduled (in Zoho's
   * Outbox), sent, or skipped with a reason.
   */
  congratsNotes: defineTable({
    alertId: v.id("caseStatusAlerts"),
    email: v.string(),
    caseNumber: v.string(),
    program: v.union(v.literal("perm"), v.literal("lca"), v.literal("pwd")),
    /** The status the note congratulates, as our alert reported it. */
    status: v.string(),
    decidedAt: v.number(),
    /** The Eastern day it's due, "YYYY-MM-DD". */
    dueOn: v.string(),
    state: v.union(v.literal("due"), v.literal("scheduled"), v.literal("sent"), v.literal("skipped")),
    reason: v.optional(v.string()),
    zohoMessageId: v.optional(v.string()),
    /** When Zoho is to send it ("MM/DD/YYYY HH:MM:SS" Eastern, Zoho's own form). */
    scheduledFor: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_alert", ["alertId"])
    .index("by_email", ["email"])
    .index("by_state_due", ["state", "dueOn"]),

  /** Addresses that asked not to get another note ("if you'd rather I didn't write again"). */
  congratsNoteOptOuts: defineTable({
    email: v.string(),
    at: v.number(),
    note: v.optional(v.string()),
  }).index("by_email", ["email"]),

  bulletinAlerts: defineTable({
    email: v.string(),
    /**
     * Retired Oct 31 2026 (the site is English only): kept so the rows a translated page
     * wrote Oct 29 to 31 still validate. Nothing reads or writes it.
     */
    lang: v.optional(v.string()),
    /** Employment category as the bulletin prints it: EB1..EB5, EW3. */
    category: v.string(),
    /** Country column: ALL, CHINA, INDIA, MEXICO, PHILIPPINES. */
    country: v.string(),
    /**
     * The final-action cutoff we last told them about, as the bulletin
     * prints it ("C", "U", or "01JAN23"-style). Absent until the first
     * confirmed sweep baselines it, so the first alert is a real movement
     * rather than "here is the current value you already saw when you
     * subscribed".
     */
    lastSeenCutoff: v.optional(v.string()),
    /** Which bulletin month lastSeenCutoff came from, "YYYY-MM". */
    lastSeenBulletin: v.optional(v.string()),

    /** Null until the address is confirmed; nothing is ever sent before then. */
    confirmedAt: v.optional(v.number()),
    /**
     * A series change requested by an unauthenticated POST, staged exactly
     * like `pendingFilingMonth`: "category|country", applied only when the
     * inbox owner clicks a fresh confirm link.
     */
    pendingSeries: v.optional(v.string()),
    lastConfirmationSentAt: v.optional(v.number()),
    lastAlertSentAt: v.optional(v.number()),
    alertCount: v.optional(v.number()),
    unsubscribedAt: v.optional(v.number()),
    createdAt: v.number(),
    source: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    /** The upsert key: one row per (address, series). */
    .index("by_email_series", ["email", "category", "country"])
    /**
     * Drives the monthly sweep. The table is small (hundreds, not hundreds of
     * thousands), so live rows are the only cut that matters; `confirmedAt`
     * is filtered in JS as on the sibling tables.
     */
    .index("by_alert_sweep", ["unsubscribedAt", "createdAt"])
    /** Retention's read of unconfirmed sign-ups past the horizon, so confirmed rows never stand in front. */
    .index("by_confirmed_created", ["confirmedAt", "createdAt"]),

  /**
   * Occasional product-news consent for addresses WITHOUT an account.
   *
   * Signed-in users' marketing consent lives in Resend (source of truth,
   * audited via marketingEvents). Anonymous alert subscribers could not join
   * that list because `marketingEmail.syncContacts` deletes any Resend
   * contact not in the `users` table - so this table extends the roster:
   * a confirmed, un-unsubscribed row here both creates the contact and
   * protects it from orphan removal.
   *
   * Rows are created UNCONFIRMED by the news checkbox on an alert form and
   * confirmed by the same double-opt-in click that confirms the alert. The
   * confirmation email states both, and that is what makes one click consent
   * for two things: the three confirm templates each render a line naming the
   * news opt-in whenever it was requested, driven by an `includesNews` flag
   * THREADED from the subscribe request rather than read back from this table
   * (a read at send time can beat the staging write, since the same
   * transaction stages the row and schedules the email). See
   * convex/emailPrefs.ts and convex/lib/newsConsent.ts.
   *
   * No sending path reads this table directly - broadcasts go out via Resend,
   * which is where the unsubscribe footer lives too.
   */
  newsSubscribers: defineTable({
    email: v.string(),
    confirmedAt: v.optional(v.number()),
    unsubscribedAt: v.optional(v.number()),
    createdAt: v.number(),
    source: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    // The 30-day clean-up of sign-ups nobody confirmed (convex/retention.ts).
    .index("by_confirmed_created", ["confirmedAt", "createdAt"]),

  /**
   * The weekly digest list. Same shape and the same double opt-in
   * as `newsSubscribers` (staged by a checkbox, confirmed by the alert's own
   * confirm click, which names it). Built out on 2026-09-08 and switched OFF
   * by the NEWSLETTER_ENABLED environment variable: issues are composed every
   * Tuesday and kept in `newsletterIssues` for the admin preview, and nothing
   * is sent until the flag is set, because Resend's free plan caps the whole
   * account at 100 mails a day and this list is the one that would blow it.
   */
  newsletterSubscribers: defineTable({
    email: v.string(),
    /**
     * Retired Oct 31 2026 (the site is English only): kept so the rows a translated page
     * wrote Oct 29 to 31 still validate. Nothing reads or writes it.
     */
    lang: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    unsubscribedAt: v.optional(v.number()),
    createdAt: v.number(),
    source: v.optional(v.string()),
    /** When the digest's own sign-up (convex/digestSignup.ts) last sent a confirmation: its 10-minute cooldown. */
    lastConfirmationSentAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    // The 30-day clean-up of sign-ups nobody confirmed (convex/retention.ts).
    .index("by_confirmed_created", ["confirmedAt", "createdAt"]),

  /** One row per composed issue, newest first by weekOf. */
  newsletterIssues: defineTable({
    /** The Tuesday it was composed for, YYYY-MM-DD. */
    weekOf: v.string(),
    /** The DigestData the parts are rendered from, as JSON. */
    data: v.string(),
    subject: v.string(),
    text: v.string(),
    html: v.string(),
    builtAt: v.number(),
    /** preview: composed, flag off. sending: in progress. sent: done. skipped: nothing new since the last issue, never sent. */
    status: v.union(v.literal("preview"), v.literal("sending"), v.literal("sent"), v.literal("skipped")),
    sentCount: v.number(),
    /** The last address sent to, so a daily batch resumes where it stopped. */
    cursor: v.optional(v.string()),
  }).index("by_weekOf", ["weekOf"]),

  /**
   * Milestones people report for a case after DOL: the I-140 and I-485
   * stages, which have no federal per-case record. Unverified user reports,
   * labelled as such wherever they render and never blended into an estimate.
   * One row per (case, reporter, kind): a repeat from the same address updates
   * its own row, so a count cannot be inflated by clicking.
   */
  caseMilestones: defineTable({
    /** Normalised PERM case number, "G-100-25324-425560" or the older "A-" form. */
    caseNumber: v.string(),
    kind: v.union(
      v.literal("i140-filed"),
      v.literal("i140-approved"),
      v.literal("i485-filed"),
      v.literal("i485-approved"),
    ),
    /** ISO date the reporter gave. */
    eventDate: v.string(),
    submittedAt: v.number(),
    /** SHA-256 of the forwarded address, computed by the HTTP layer; dedupe only. */
    ipHash: v.string(),
  })
    .index("by_case", ["caseNumber"])
    .index("by_case_ip_kind", ["caseNumber", "ipHash", "kind"]),

  /**
   * A person's whole timeline after PERM, the successor to `caseMilestones`
   * (which keeps its 14 rows and its per-case counts). Rules and field lists:
   * `convex/lib/communityTimeline.ts`.
   *
   * The PERM half (`perm*`) is written ONLY by `communityTimelines.setPermHalf`,
   * read from DOL's record in the public-data database by case number; the reporter never types
   * it. Everything else is self-reported, has no free text, and is labelled as
   * self-reported wherever it renders.
   *
   * No account. Whoever holds the edit key (32 random bytes the browser keeps)
   * can change or remove the row; only its SHA-256 is stored. `public` is the
   * opt-in to the public board, off by default; the anonymous medians use every
   * approved row that is not hidden, and the form says so before saving.
   *
   * A timeline waits for the owner before it reaches any page (`status`). A row
   * saved before Nov 11 2026 has no status and reads as approved, because it
   * was public then; `communityTimelines.backfillStatus` writes it.
   */
  communityTimelines: defineTable({
    /** The PERM case, when the case has one. EB-1 and waiver cases have none. */
    caseNumber: v.optional(v.string()),
    editKeyHash: v.string(),
    ipHash: v.string(),
    public: v.boolean(),
    category: v.optional(
      v.union(v.literal("eb1"), v.literal("eb2"), v.literal("eb2-niw"), v.literal("eb3"), v.literal("eb3-other")),
    ),
    country: v.optional(
      v.union(v.literal("row"), v.literal("india"), v.literal("china"), v.literal("mexico"), v.literal("philippines")),
    ),
    route: v.optional(v.union(v.literal("adjustment"), v.literal("consular"))),
    /** Whose case: the main applicant or a spouse or child filing with them (lib APPLICANTS). */
    applicant: v.optional(v.union(v.literal("principal"), v.literal("dependent"))),
    premium: v.optional(v.boolean()),
    i140Center: v.optional(v.union(v.literal("nebraska"), v.literal("texas"), v.literal("other"))),
    /** The USCIS office holding the I-485: USCIS's three-letter code, one of src/lib/uscisOffices.json. */
    fieldOffice: v.optional(v.string()),
    /** The service center that took the I-485 in: one of the six centers' codes (lib I485_CENTERS). */
    i485Center: v.optional(v.string()),
    i140FiledOn: v.optional(v.string()),
    i140ApprovedOn: v.optional(v.string()),
    i485FiledOn: v.optional(v.string()),
    biometricsOn: v.optional(v.string()),
    eadOn: v.optional(v.string()),
    apOn: v.optional(v.string()),
    i485jApprovedOn: v.optional(v.string()),
    interviewOn: v.optional(v.string()),
    greenCardOn: v.optional(v.string()),
    /** Premium processing requested after filing, the move to a field office, the card in the mail (lib DETAIL_DATES). */
    premiumOn: v.optional(v.string()),
    officeMovedOn: v.optional(v.string()),
    cardArrivedOn: v.optional(v.string()),
    /** A spouse's H-4 extension (I-539) and H-4 work permit, each filed and approved (lib H4_DATES). */
    h4FiledOn: v.optional(v.string()),
    h4ApprovedOn: v.optional(v.string()),
    h4EadFiledOn: v.optional(v.string()),
    h4EadApprovedOn: v.optional(v.string()),
    /** How the H-4 work permit was filed (lib H4_EAD_ROUTES); the filing days decide when it is absent. */
    h4EadRoute: v.optional(v.union(v.literal("with-i539"), v.literal("alone"))),
    /** Whether the interview was held or waived (lib INTERVIEW_OUTCOMES). */
    interview: v.optional(v.union(v.literal("held"), v.literal("waived"))),
    /** What the person did to move the case, sorted by day; each kind is checked against lib CONTACT_KINDS on save. */
    contacts: v.optional(v.array(v.object({ on: v.string(), kind: v.string() }))),
    /**
     * Updates in the person's USCIS account, sorted by day. The form and code are checked against the lib's lists on
     * save (EVENT_FORMS, ACCOUNT_CODES or a typed code matching TYPED_CODE), so they're stored as plain strings.
     */
    accountEvents: v.optional(v.array(v.object({ on: v.string(), form: v.optional(v.string()), code: v.optional(v.string()) }))),
    rfeForm: v.optional(v.union(v.literal("i140"), v.literal("i485"))),
    rfeReason: v.optional(
      v.union(
        v.literal("ability-to-pay"),
        v.literal("experience"),
        v.literal("education"),
        v.literal("job-offer"),
        v.literal("perm-docs"),
        v.literal("medical"),
        v.literal("supplement-j"),
        v.literal("status"),
        v.literal("civil-docs"),
        v.literal("other"),
      ),
    ),
    rfeIssuedOn: v.optional(v.string()),
    rfeRespondedOn: v.optional(v.string()),
    rfeOutcome: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"))),
    /** RFEs after the first (lib MAX_MORE_RFES), each checked against the lib's lists on save. */
    moreRfes: v.optional(
      v.array(
        v.object({ form: v.string(), reason: v.optional(v.string()), issuedOn: v.optional(v.string()), respondedOn: v.optional(v.string()), outcome: v.optional(v.string()) }),
      ),
    ),
    /** DOL's filing date for the case. Written by the verifier only. */
    permFiledOn: v.optional(v.string()),
    /** DOL's certification date. Written by the verifier only. */
    permCertifiedOn: v.optional(v.string()),
    permCertifiedSource: v.optional(v.union(v.literal("disclosure"), v.literal("observed"))),
    /** When the verifier last read DOL's record for this case. */
    permCheckedAt: v.optional(v.number()),
    /** Set by an admin to take a row off every surface without deleting it. */
    hiddenAt: v.optional(v.number()),
    /** The owner's decision. Only an approved row reaches a page. */
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("declined"))),
    reviewedAt: v.optional(v.number()),
    declineReason: v.optional(v.union(v.literal("implausible"), v.literal("duplicate"), v.literal("spam"))),
    /** When its author last changed a timeline the owner had approved; cleared once the owner has looked. */
    editedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseNumber"])
    .index("by_case_key", ["caseNumber", "editKeyHash"])
    .index("by_case_ip", ["caseNumber", "ipHash"])
    .index("by_perm_checked", ["permCheckedAt"])
    .index("by_editKeyHash", ["editKeyHash"])
    .index("by_fieldOffice", ["fieldOffice"])
    .index("by_status_created", ["status", "createdAt"])
    .index("by_editedAt", ["editedAt"]),

  /**
   * Consulate reports: what happened at a US consulate's visa interview or drop box, as the person waiting
   * reports it (convex/consularReports.ts, rules in convex/lib/consularReport.ts). Self-reported, and
   * labelled so wherever it renders: never State's data.
   *
   * No account, no case number, no name and no free text: a post, a kind of visa, an outcome, dates and a few
   * choices from fixed lists. Whoever
   * holds the edit key (32 random bytes the browser keeps for that consulate) can change or remove the
   * report; only its SHA-256 is stored. `ipHash` (a keyed hash of the address) caps how many reports one
   * connection adds for one post, and is cleared about a day after the report is saved
   * (`consularReports.clearIpHashes`, hourly, from `ipHashUntil`).
   */
  consularReports: defineTable({
    post: v.string(),
    /** Every kind of visa (owner, Nov 5 2026): everyone goes through the same posts. */
    category: v.union(
      v.literal("employment"),
      v.literal("h1b"),
      v.literal("h4"),
      v.literal("l1"),
      v.literal("l2"),
      v.literal("family"),
      v.literal("immediate"),
      v.literal("k1"),
      v.literal("f1"),
      v.literal("b1b2"),
      v.literal("other"),
    ),
    /** A nonimmigrant visa only: an interview, or a drop box with no interview. */
    mode: v.optional(v.union(v.literal("interview"), v.literal("dropbox"))),
    /** YYYY-MM: when NVC said the case was documentarily complete. Immigrant visas and the K-1 only. */
    nvcCompleteMonth: v.optional(v.string()),
    /** When the interview letter came. */
    scheduledOn: v.optional(v.string()),
    /** The interview, or the day the documents went into the drop box. */
    interviewOn: v.optional(v.string()),
    outcome: v.union(
      v.literal("waiting"),
      v.literal("approved"),
      v.literal("issued"),
      v.literal("passport-returned"),
      v.literal("221g"),
      v.literal("refused"),
      v.literal("cancelled"),
      v.literal("rescheduled"),
    ),
    /** Only with outcome "refused". */
    refusalGround: v.optional(v.union(v.literal("214b"), v.literal("public-charge"), v.literal("other"))),
    /** Approved at the window (or the drop box approved), before the visa is printed. */
    approvedOn: v.optional(v.string()),
    /** The visa issued, the passport back, or the 221(g) cleared. */
    resolvedOn: v.optional(v.string()),
    /** A nonimmigrant visa's 221(g): the slip's colour. */
    slipColor: v.optional(
      v.union(
        v.literal("white"),
        v.literal("yellow"),
        v.literal("pink"),
        v.literal("blue"),
        v.literal("green"),
        v.literal("unsure"),
      ),
    ),
    /** A nonimmigrant visa's 221(g): whether the officer asked for documents by email. */
    askedToEmailDocs: v.optional(v.union(v.literal("yes"), v.literal("no"), v.literal("unsure"))),
    /** The exact category (EB-2, F2A, IR-1...) within employment, family preference or immediate relative. */
    line: v.optional(
      v.union(
        v.literal("eb1"),
        v.literal("eb2"),
        v.literal("eb3"),
        v.literal("ew"),
        v.literal("eb4"),
        v.literal("eb5"),
        v.literal("f1"),
        v.literal("f2a"),
        v.literal("f2b"),
        v.literal("f3"),
        v.literal("f4"),
        v.literal("ir1"),
        v.literal("ir2"),
        v.literal("ir3"),
        v.literal("ir5"),
      ),
    ),
    /** Only with outcome "221g", any kind of visa: why, as the officer put it. */
    holdReason: v.optional(
      v.union(v.literal("documents"), v.literal("admin"), v.literal("public-charge"), v.literal("not-told")),
    ),
    /** Only with outcome "cancelled" or "rescheduled". */
    cancelledBy: v.optional(v.union(v.literal("consulate"), v.literal("me"))),
    editKeyHash: v.string(),
    /** Cleared about a day after the report is saved. */
    ipHash: v.optional(v.string()),
    /** When `ipHash` is cleared; gone with it. */
    ipHashUntil: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    /** Set by an admin to take a report off every figure without deleting it. */
    hidden: v.optional(v.boolean()),
  })
    .index("by_post", ["post"])
    .index("by_post_key", ["post", "editKeyHash"])
    .index("by_post_ip", ["post", "ipHash"])
    .index("by_ip_until", ["ipHashUntil"])
    // The owner's daily email reads the day's saves and edits by this.
    .index("by_updated", ["updatedAt"]),

  /**
   * Browser push subscriptions for case-status changes, with no account and
   * no email. A row is one browser watching one case; the subscription JSON
   * is the browser's delivery address and identifies a device, not a person.
   * Seeded on the first sweep like the email alerts, so a subscription taken
   * out the day after a change is not told about it.
   */
  caseStatusPushAlerts: defineTable({
    caseNumber: v.string(),
    /** The PushSubscription JSON the browser handed back. */
    subscription: v.string(),
    /** SHA-256 of the subscription endpoint: the identity for dedupe and for "stop". */
    endpointHash: v.string(),
    lastSeenStatus: v.optional(v.string()),
    createdAt: v.number(),
    lastCheckedAt: v.optional(v.number()),
    /** Set when the case reached a final status, the browser revoked, or the person stopped it. */
    closedAt: v.optional(v.number()),
    failures: v.number(),
  })
    .index("by_closed", ["closedAt"])
    .index("by_endpoint", ["endpointHash"])
    .index("by_endpoint_case", ["endpointHash", "caseNumber"]),

  /**
   * Browser push when a new visa bulletin is out, for one category and country (convex/bulletinPushAlerts.ts).
   * Like caseStatusPushAlerts: no account and no email, the browser's subscription is the only address.
   */
  bulletinPushAlerts: defineTable({
    category: v.string(),
    country: v.string(),
    subscription: v.string(),
    endpointHash: v.string(),
    /** The newest bulletin this row has been told about (or seeded with), "YYYY-MM", and its cutoff then. */
    lastSeenBulletin: v.optional(v.string()),
    lastSeenCutoff: v.optional(v.string()),
    createdAt: v.number(),
    lastCheckedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    failures: v.number(),
  })
    .index("by_closed", ["closedAt"])
    .index("by_endpoint", ["endpointHash"])
    .index("by_endpoint_line", ["endpointHash", "category", "country"]),

  /**
   * Contact-form submissions. Stored first, THEN forwarded by a scheduled
   * action, so a Resend outage loses nothing - the message is already here.
   */
  contactMessages: defineTable({
    name: v.string(),
    email: v.string(),
    message: v.string(),
    /** Best-effort caller IP for the per-IP limit; spoofable, cost-raiser only. */
    ip: v.string(),
    createdAt: v.number(),
    /** Set when the forward to support@ actually succeeded. */
    notifiedAt: v.optional(v.number()),
    /** What the route knew that the words don't show (the Turnstile check), for the spam check. */
    checkSignals: v.optional(v.array(v.object({ weight: v.number(), why: v.string() }))),
  })
    .index("by_created", ["createdAt"])
    .index("by_ip_created", ["ip", "createdAt"]),

  /**
   * Reviews of PERM Tracker (convex/siteReviews.ts), shown on /reviews and the homepage once the owner approves
   * them. Left on the site's own form since Oct 23 2026, and copied from Senja, the form used before, by a daily
   * job so old links still reach the queue. Approval is never by stars (16 CFR 465.7(b)): the owner declines
   * spam, abuse and reviews of something else. A review by someone who runs the site is kept and never shown or
   * counted (16 CFR 465.5).
   */
  siteReviews: defineTable({
    /** 1 to 5. */
    rating: v.number(),
    text: v.string(),
    /** Shown with the review, as the reviewer wrote it. */
    name: v.string(),
    /** Private: never shown and never sent anywhere. Lets the owner follow up and see the reviewer watches a case. */
    email: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("declined")),
    /** "alert": a rating tapped in a case's last alert email, queued as a review with no words (Oct 31 2026). */
    source: v.union(v.literal("site"), v.literal("senja"), v.literal("alert")),
    /**
     * sha256 of the reviewer's address (lowercased), on a rating from an alert email and on a written review that
     * gave an address: where the two meet, so one person counts once. No address is kept for it.
     */
    raterKey: v.optional(v.string()),
    /**
     * The rating behind an alert review, so the admin page can say who rated and for which case (owner, Oct 31
     * 2026: "it doesn't say who at all?"). Read only by the admin list; never by a public query.
     */
    ratingId: v.optional(v.id("alertRatings")),
    /** Senja's id for a copied review: the copy is made once. */
    senjaId: v.optional(v.string()),
    /** Someone who runs PERM Tracker: kept, never shown or counted. */
    insider: v.optional(v.boolean()),
    /** When the review was left (Senja's own date for a copy). */
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
    /** Sent faster than a person likely could, or with no timing: kept for the owner to judge, never dropped. */
    quick: v.optional(v.boolean()),
    /** The email came from a sealed link we sent that address, so the address is confirmed. */
    viaLink: v.optional(v.boolean()),
    /** Why the owner declined it, from the reasons 16 CFR 465.7(b) allows. */
    declineReason: v.optional(
      v.union(
        v.literal("spam"),
        v.literal("abusive"),
        v.literal("personal"),
        v.literal("unrelated"),
        v.literal("duplicate"),
        v.literal("other"),
      ),
    ),
    /** The owner's own words on why (required with "other"); deleted with the words at the 90-day scrub. */
    declineNote: v.optional(v.string()),
    /** A declined review's words, name and email are deleted 90 days after the decision; the rating and reason stay. */
    scrubbedAt: v.optional(v.number()),
    /**
     * What a reviewer who gave 3 stars or fewer said could be better, added on the thanks screen. Private: only the
     * admin page shows it, never the review. Deleted 90 days after it was written.
     */
    privateNote: v.optional(v.string()),
    privateNoteAt: v.optional(v.number()),
    /**
     * The keys (SHA-256, hex) of the tokens given to the browser that posted this review, which /review/note must
     * bring back for the private note (convex/lib/reviewNoteKey.ts). Only on a review of 3 stars or fewer, at most
     * NOTE_KEYS_KEPT (a double send gets its own). Absent on reviews stored before Nov 4 2026: they take no note.
     */
    noteKeys: v.optional(v.array(v.string())),
    /**
     * On a waiting rating from an alert email: the same person's written review, which takes its place in the
     * queue (Nov 2 2026). Approving that review deletes this row; declining or deleting it clears the field, so
     * the rating waits again. Never shown publicly.
     */
    supersededBy: v.optional(v.id("siteReviews")),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_senja_id", ["senjaId"])
    .index("by_note_at", ["privateNoteAt"])
    .index("by_rater_key", ["raterKey"]),

  /**
   * How many reviews the site shows, by stars (index 0 is one star): kept as reviews are approved, declined and
   * copied, so the average and the count stay exact however many there are. The public read hands back only the
   * newest 500. One row, keyed "shown"; `siteReviews.rebuildTally` makes it from the table when it's missing.
   */
  siteReviewTally: defineTable({
    key: v.literal("shown"),
    stars: v.array(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Someone following ONE employer's PERM cases.
   *
   * Fourth sibling of the alert tables, same consent grammar: double opt-in,
   * a staged `pendingSlug` that only a fresh confirm click makes live,
   * tombstoned opt-outs, purpose-scoped tokens (`employer-confirm` /
   * `employer-unsubscribe`). It answers "did DOL do something to this
   * employer's cases as a group": a day when five or more of its cases went
   * on hold or came off it, or a batch of decisions well above its own pace.
   * Both lists are precomputed by the daily sweep into
   * `perm_docs['employer_stages']`; this table only remembers which of those
   * days each follower has already been told about.
   *
   * A follow has one of two sizes (`scope`). "group" is the above. "each" is
   * for someone who manages the cases: every status change of every one of the
   * employer's cases, read from the event log, with `caseToldThrough` as its
   * change detector (src/lib/employerCaseMoves.ts).
   */
  employerAlerts: defineTable({
    email: v.string(),
    /** The `/perm-employers/<slug>` slug. */
    slug: v.string(),
    /** The employer's name as the page printed it at subscribe time. */
    employerName: v.string(),
    confirmedAt: v.optional(v.number()),
    /** Staged by an unauthenticated POST; made live only by a confirm click. */
    pendingSlug: v.optional(v.string()),
    pendingName: v.optional(v.string()),
    /** What to send: bulk moves only, or every case. Absent on a row from before the choice existed: a group follow. */
    scope: v.optional(v.union(v.literal("group"), v.literal("each"))),
    /** Staged with `pendingSlug`, so a form can't change what a confirmed follower gets without their click. */
    pendingScope: v.optional(v.union(v.literal("group"), v.literal("each"))),
    /** An "each" follow's change detector: the newest case move already told, in milliseconds. */
    caseToldThrough: v.optional(v.number()),
    /** Throttles repeat confirmations to this address. Records intent. */
    lastConfirmationSentAt: v.optional(v.number()),
    /**
     * Staged inside another confirmation's ten-minute cooldown, so no email has named it yet. When the cooldown
     * ends, one follow-up confirmation names every row of the address that carries this (and clears it). A
     * click on the first email in the meantime confirms the row and clears it too.
     */
    confirmationOwed: v.optional(v.boolean()),
    /**
     * The moves already told, as `<date>|<kind>|<to>` keys, newest last and
     * capped. THIS is the change detector: the doc lists a move for months,
     * and a follower hears about each one once.
     */
    toldMoves: v.optional(v.array(v.string())),
    /** Only moves dated on or after this ET date are news to this follower. */
    followingFrom: v.optional(v.string()),
    lastCheckedAt: v.optional(v.number()),
    lastAlertSentAt: v.optional(v.number()),
    alertCount: v.optional(v.number()),
    unsubscribedAt: v.optional(v.number()),
    createdAt: v.number(),
    source: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_email_slug", ["email", "slug"])
    /** Live rows first, least recently checked first: the sweep's round-robin. */
    .index("by_alert_sweep", ["unsubscribedAt", "lastCheckedAt"])
    .index("by_created", ["createdAt"])
    /** Retention's read of unconfirmed sign-ups past the horizon, so confirmed rows never stand in front. */
    .index("by_confirmed_created", ["confirmedAt", "createdAt"]),

  /**
   * A law firm's claim on its `/perm-attorneys/<slug>` page (convex/firmClaims.ts).
   *
   * One row per (address, firm). Verified on its own when DOL's disclosure
   * files print the address's domain beside the firm (`firm_email_domains`,
   * scripts/build_firm_domains.py); otherwise it waits for the admin. The
   * claimant's role is private: it helps the admin judge a manual claim and
   * is never shown. The profile the claim submitted is kept here until it is
   * published to `firmProfiles`.
   */
  firmClaims: defineTable({
    slug: v.string(),
    /** The firm's name from our records at claim time, never from the form. */
    firmName: v.string(),
    email: v.string(),
    domain: v.string(),
    /** Free text, private: "partner", "office manager". */
    role: v.string(),
    status: v.union(
      v.literal("pending_email"),
      v.literal("pending_review"),
      v.literal("verified"),
      v.literal("rejected"),
      v.literal("revoked"),
    ),
    /** How a verified claim was verified. */
    verifiedBy: v.optional(v.union(v.literal("domain"), v.literal("admin"))),
    /** What the domain check found at request time: filings DOL ties to it, and why it fell short. */
    domainFilings: v.number(),
    domainReason: v.optional(v.string()),
    /** The profile as submitted with the claim (see src/lib/firmProfile.ts). */
    draft: v.object({
      website: v.optional(v.string()),
      description: v.optional(v.string()),
      languages: v.array(v.string()),
      offices: v.array(v.object({ city: v.string(), state: v.string() })),
      focus: v.array(v.string()),
    }),
    createdAt: v.number(),
    /** When the confirmation link went out; throttles repeats to one address. */
    lastConfirmationSentAt: v.optional(v.number()),
    lastEditLinkSentAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    source: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_email_slug", ["email", "slug"])
    .index("by_slug", ["slug"])
    .index("by_status", ["status", "createdAt"]),

  /**
   * What a verified firm publishes on its page, one row per firm. Shown apart
   * from DOL's figures as the firm's own words. `hidden` is set by the admin or
   * by the firm itself, and when the last verified claim is revoked; a hidden
   * profile is not shown anywhere.
   *
   * The top-level fields are the APPROVED version, the only one the page reads.
   * A version a firm sends waits in `pending` until the admin approves it
   * (convex/firmClaims.ts, since Oct 5 2026); `lastReview` keeps the newest
   * decision, and a declined version, so the firm can fix and resend it. A row
   * can exist with nothing approved yet, which shows nothing.
   */
  firmProfiles: defineTable({
    slug: v.string(),
    website: v.optional(v.string()),
    /** A website held back because its domain isn't the verified one; the admin can approve it. */
    pendingWebsite: v.optional(v.string()),
    description: v.optional(v.string()),
    languages: v.array(v.string()),
    offices: v.array(v.object({ city: v.string(), state: v.string() })),
    focus: v.array(v.string()),
    verifiedBy: v.union(v.literal("domain"), v.literal("admin")),
    hidden: v.optional(v.boolean()),
    hiddenBy: v.optional(v.union(v.literal("admin"), v.literal("firm"), v.literal("revoked"))),
    /** When a version was first approved; absent while the first one waits. */
    publishedAt: v.optional(v.number()),
    /** When what the page shows last changed. */
    updatedAt: v.number(),
    /** The version a firm sent, waiting for the admin, and whose claim sent it. */
    pending: v.optional(
      v.object({
        website: v.optional(v.string()),
        description: v.optional(v.string()),
        languages: v.array(v.string()),
        offices: v.array(v.object({ city: v.string(), state: v.string() })),
        focus: v.array(v.string()),
        claimId: v.id("firmClaims"),
      }),
    ),
    /** When `pending` arrived; the admin's list reads this index. */
    pendingAt: v.optional(v.number()),
    lastReview: v.optional(
      v.object({
        decision: v.union(v.literal("approved"), v.literal("declined")),
        at: v.number(),
        /** Shown to the firm with a decline. */
        reason: v.optional(v.string()),
        /** A declined version, so the firm's edit page can offer it back. */
        version: v.optional(
          v.object({
            website: v.optional(v.string()),
            description: v.optional(v.string()),
            languages: v.array(v.string()),
            offices: v.array(v.object({ city: v.string(), state: v.string() })),
            focus: v.array(v.string()),
          }),
        ),
      }),
    ),
  })
    .index("by_slug", ["slug"])
    .index("by_pending_at", ["pendingAt"]),

  /**
   * Alert email waiting for its recipient's one email of the day.
   *
   * Every alert kind builds its own complete email and hands it to
   * `deliverAlert` (convex/lib/alertDelivery.ts). An address that follows one
   * thing and has not been mailed today gets it at once; anything else waits
   * here, and `alertOutbox.sendBundles` sends each address at most one email
   * per Eastern day: the stored email itself when one item is waiting, one
   * "Your PERM Tracker updates" email when several are. Sent rows keep only
   * their summary, for the admin panel, and are pruned after 30 days.
   */
  alertOutbox: defineTable({
    email: v.string(),
    /** One list for every copy of it (convex/lib/alertKinds.ts). */
    kind: alertKindValidator,
    /** `<kind>:<row id>`, so an opt-out can drop what is still waiting. */
    ref: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("dropped"),
      v.literal("failed"),
    ),
    /** Retired Oct 31 2026 (English only): kept so older rows validate; nothing reads or writes it. */
    lang: v.optional(v.string()),
    subject: v.string(),
    /** The single-item email. Cleared once sent; a bundle renders its own. */
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    listUnsubscribe: v.optional(v.string()),
    /** One line in a bundle: what moved, and where to look. */
    summary: v.object({
      title: v.string(),
      line: v.string(),
      url: v.string(),
      tone: v.optional(v.union(v.literal("good"), v.literal("bad"), v.literal("neutral"))),
    }),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    /** How many items went out in the email that carried this one. */
    bundleSize: v.optional(v.number()),
    /** True when it went straight out, never waiting. */
    direct: v.optional(v.boolean()),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_email_status", ["email", "status"])
    .index("by_ref_status", ["ref", "status"])
    .index("by_created", ["createdAt"]),

  /**
   * The daily operator report (convex/dailyReport.ts), one row per Eastern
   * day, kept 60 days for the admin page. `report` is the whole report as the
   * email showed it; `overall` is its worst section status.
   */
  dailyReports: defineTable({
    day: v.string(),
    overall: v.string(),
    report: v.any(),
    createdAt: v.number(),
  }).index("by_day", ["day"]),

  /**
   * How many people a daily email budget turned away, per pool per Eastern
   * day. The admin panel's "time to move off Resend's free plan" signal; see
   * convex/lib/alertBudgets.ts. Pruned after 30 days.
   */
  budgetRefusals: defineTable({
    day: v.string(),
    /** A key of BUDGETS in convex/lib/alertBudgets.ts. */
    pool: v.string(),
    /** People who got no email at all (turned away). */
    count: v.number(),
    /** Requests a full pool queued instead (convex/confirmationQueue.ts). */
    queued: v.optional(v.number()),
    /**
     * When the day's one "the whole site is at its sign-up line" email went, on the row of the kind that set it off.
     * That cause is the site's, not a pool's, so it's claimed once a day across every row (alertBudgets.claimSiteNotice).
     */
    siteNoticeAt: v.optional(v.number()),
  }).index("by_day_pool", ["day", "pool"]),

  /**
   * How password resets end, per Eastern day: codes sent, resets completed, codes refused. Counts only, for the
   * morning report's "are resets getting through" line; see convex/lib/authOutcomes.ts. Pruned after a month
   * with the alert outbox.
   */
  authOutcomes: defineTable({
    day: v.string(),
    /** One of RESET_OUTCOMES in convex/lib/authOutcomes.ts. */
    kind: v.string(),
    count: v.number(),
  }).index("by_day_kind", ["day", "kind"]),

  /**
   * The off-server check on the server (convex/serverWatch.ts): one row, the
   * alarm's state, so it emails when trouble starts, every 6 hours while it
   * lasts, and once on recovery.
   */
  serverWatch: defineTable({
    key: v.string(),
    down: v.boolean(),
    since: v.number(),
    mailedAt: v.number(),
    reason: v.string(),
    // A database miss waiting for the next check before it mails (convex/lib/serverWatch.ts).
    pendingSince: v.optional(v.number()),
    pendingReason: v.optional(v.string()),
    // Single database misses in the last day, for the morning report.
    blips: v.optional(v.array(v.number())),
  }).index("by_key", ["key"]),

  /**
   * The day's email count against Resend's free-plan quota (convex/lib/emailLimits.ts).
   * One row per UTC day, the day Resend counts by. `sent` is this app's own
   * count after each successful send; `reported` is the highest count Resend
   * itself gave (its `x-resend-daily-quota` header, or its list of sent mail
   * plus a margin for received mail). The day's use is the larger of the two.
   */
  emailDays: defineTable({
    day: v.string(),
    sent: v.number(),
    reported: v.optional(v.number()),
    /** Sends that failed and went into the retry queue. */
    retried: v.optional(v.number()),
    /** Queued sends given up on (two weeks, or a queue at its ceiling). */
    lost: v.optional(v.number()),
    /** When the admin was emailed about failed sends today. */
    alertedAt: v.optional(v.number()),
  }).index("by_day", ["day"]),

  /**
   * Emails that failed to send for a reason a retry can fix: Resend's own
   * limits or outages, the network, a key or domain problem (Sep 29 2026). The
   * whole send is kept as JSON and tried again on a backoff; a quota refusal
   * waits for the next UTC day. Deleted when sent; given up on after two weeks.
   * Sign-in codes are never stored here: a late code is useless.
   */
  emailRetries: defineTable({
    kind: v.string(),
    /** First recipient, for the admin view. */
    to: v.string(),
    payload: v.string(),
    queuedAt: v.number(),
    nextAttemptAt: v.number(),
    attempts: v.number(),
    lastError: v.string(),
    claimedAt: v.optional(v.number()),
    /**
     * The alert subscriptions this email carries (`<kind>:<id>` refs), so an
     * opt-out drops the email here too, not only in the outbox (Oct 10 2026).
     */
    refs: v.optional(v.array(v.string())),
  })
    .index("by_next", ["nextAttemptAt"])
    .index("by_queuedAt", ["queuedAt"])
    .index("by_to", ["to"]),

  /**
   * Confirmation requests a full pool could not send at once (Sep 29 2026).
   * One row per (kind, address): a newer request replaces the waiting one,
   * because each module's per-address cooldown would absorb a second
   * confirmation minutes after the first anyway. `payload` is the subscribe
   * call's own arguments as JSON, without the caller's IP; the drain replays
   * it through the same mutation. Rows are deleted when sent, and after
   * three days unsent (counted as turned away).
   */
  confirmationQueue: defineTable({
    kind: v.union(
      v.literal("case"),
      v.literal("employer"),
      v.literal("queue"),
      v.literal("bulletin"),
      v.literal("prefs"),
      v.literal("firm"),
      /** A firm's edit-link request: its own kind, so it can't overwrite a waiting claim. */
      v.literal("firmEdit"),
      /** The weekly digest's own sign-up (convex/digestSignup.ts). */
      v.literal("digest"),
      /** A pasted list of cases, held as one request (`subscribeList` in convex/caseAlerts.ts). */
      v.literal("caseList"),
      /** A USCIS receipt watch (convex/uscisAlerts.ts). */
      v.literal("uscis"),
    ),
    pool: v.string(),
    email: v.string(),
    payload: v.string(),
    queuedAt: v.number(),
    /** Set while a drain is sending it; a lease older than 10 minutes is free again. */
    claimedAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
  })
    .index("by_queuedAt", ["queuedAt"])
    .index("by_kind_email", ["kind", "email"]),

  /** The last Eastern day each address was sent an alert email. One row per address. */
  alertRecipients: defineTable({
    email: v.string(),
    /** YYYY-MM-DD, America/New_York. */
    lastSentDay: v.string(),
    lastSentAt: v.number(),
    emailsSent: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_last_sent", ["lastSentAt"]),

  /**
   * One-time passes from a passed Turnstile check (convex/lib/turnstilePass.ts).
   * A new password account needs one. Only the SHA-256 is stored; a row is
   * deleted when used, and expired rows are pruned as new ones are issued.
   */
  turnstilePasses: defineTable({
    hash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_hash", ["hash"])
    .index("by_expires", ["expiresAt"]),

  /**
   * One row per account that has made an API key: its plan, and `account`, a
   * random id that is the only thing the public-data database's usage
   * counters carry (never a user id or an email). See convex/apiKeys.ts.
   */
  apiAccounts: defineTable({
    userId: v.id("users"),
    account: v.string(),
    plan: v.union(v.literal("free"), v.literal("plus")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_account", ["account"]),

  /**
   * API keys. Only the SHA-256 of a key is stored; the key itself is shown
   * once, when it is made. `keyId` is the key's first 8 random characters,
   * its public id. A revoked key keeps its row so a call with it can be told
   * "revoked" rather than "unknown".
   */
  apiKeys: defineTable({
    userId: v.id("users"),
    account: v.string(),
    keyHash: v.string(),
    keyId: v.string(),
    name: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    /**
     * What the key may do (convex/lib/apiPlans.ts API_SCOPES). Absent on a key
     * made before scopes existed (Oct 8 2026), which holds DEFAULT_SCOPES.
     */
    scopes: v.optional(v.array(v.string())),
    /** When the key stops working on its own, if its maker chose a lifetime. */
    expiresAt: v.optional(v.number()),
    /** A pt_test_ key: fixed sample data, never the live records, never counted. */
    sandbox: v.optional(v.boolean()),
    /**
     * Set when the key was rotated: it keeps working until `graceUntil` (24
     * hours) so the new key can be rolled out, then stops. `replacedBy` is
     * the new key's public id.
     */
    graceUntil: v.optional(v.number()),
    replacedBy: v.optional(v.string()),
  })
    .index("by_hash", ["keyHash"])
    .index("by_key_id", ["keyId"])
    .index("by_user", ["userId"]),

  /**
   * Webhook endpoints an API account registers (convex/webhooks.ts). The
   * signing secret is shown once and kept encrypted (convex/lib/crypto.ts),
   * because signing needs it back; `secretHint` is its last four characters.
   * After 24 hours of failed deliveries an endpoint pauses (`pausedAt`) and
   * its owner gets one email (`pauseNotifiedAt`).
   */
  webhookEndpoints: defineTable({
    userId: v.id("users"),
    account: v.string(),
    url: v.string(),
    events: v.array(v.string()),
    secretEnc: v.string(),
    secretHint: v.string(),
    createdAt: v.number(),
    pausedAt: v.optional(v.number()),
    pauseReason: v.optional(v.string()),
    pauseNotifiedAt: v.optional(v.number()),
    lastDeliveryAt: v.optional(v.number()),
    lastStatusCode: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_account", ["account"]),

  /**
   * What an account's webhooks watch: a case number (case.status_changed) or
   * an employer's page slug (employer.moved). The sweeps keep what each watch
   * last saw, like the email alerts do.
   */
  webhookWatches: defineTable({
    userId: v.id("users"),
    account: v.string(),
    kind: v.union(v.literal("case"), v.literal("employer")),
    target: v.string(),
    createdAt: v.number(),
    lastSeenStatus: v.optional(v.string()),
    toldMoves: v.optional(v.array(v.string())),
    /** The Eastern day an employer watch began: moves before it aren't news. */
    followingFrom: v.optional(v.string()),
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_account", ["account"])
    .index("by_user", ["userId"])
    .index("by_kind_and_checked", ["kind", "lastCheckedAt"])
    .index("by_account_kind_target", ["account", "kind", "target"]),

  /**
   * One event, its body fixed when it happened so every retry sends the same
   * bytes. `key` makes a feed event (a bulletin, a queue month) happen once
   * however many sweeps notice it. `account` is set for a watch's event.
   */
  webhookEvents: defineTable({
    type: v.string(),
    key: v.string(),
    payload: v.string(),
    account: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_created", ["createdAt"]),

  /** One event to one endpoint: the queue, the retries and the log Settings shows. */
  webhookDeliveries: defineTable({
    endpointId: v.id("webhookEndpoints"),
    eventId: v.id("webhookEvents"),
    account: v.string(),
    type: v.string(),
    /** held: waiting for its paused endpoint to resume. */
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed"), v.literal("held")),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    firstAttemptAt: v.optional(v.number()),
    /** Set while a delivery run holds the row, so two runs never send it twice. */
    leaseUntil: v.optional(v.number()),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status_and_next", ["status", "nextAttemptAt"])
    .index("by_endpoint", ["endpointId"])
    .index("by_account", ["account"])
    .index("by_created", ["createdAt"]),

  /** What the feed events last saw (the newest bulletin month), so each publication fires once. */
  webhookFeedState: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
