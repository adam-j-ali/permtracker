# Convex API Reference

**Version:** 2.0.0
**Last Updated:** 2026-11-25
**Status:** Production

---

## Table of Contents

- [What this file covers](#what-this-file-covers)
- [Authentication Patterns](#authentication-patterns)
- [Module Reference](#module-reference)
  - [cases.ts](#casests)
  - [notifications.ts](#notificationsts)
  - [dashboard.ts](#dashboardts)
  - [calendar.ts](#calendarts)
  - [timeline.ts](#timelinets)
  - [users.ts](#usersts)
  - [Change log (lib/audit.ts and caseRestore.ts)](#change-log-libauditts-and-caserestorets)
  - [deadlineEnforcement.ts](#deadlineenforcementts)
  - [userCaseOrder.ts](#usercaseorderts)
- [Scheduled Jobs](#scheduled-jobs)
- [Internal Actions](#internal-actions)
- [Error Handling](#error-handling)
- [Cross-Cutting Patterns](#cross-cutting-patterns)
- [Patterns to follow](#patterns-to-follow)

---

## What this file covers

PERM Tracker's signed-in app runs on [Convex](https://convex.dev): reactive queries, transactional mutations and
actions, with Convex Auth deciding who the caller is.

This file covers the Convex functions behind the signed-in app: cases, notifications, the dashboard, the calendar,
the timeline, the account (users), the change log and case restore, deadline enforcement and case ordering, plus the
scheduled jobs and internal actions that send their reminders, digests and pushes. It doesn't document every Convex
module in `v2/convex/`. Alerts for people without an account, the chat, the admin pages, the public data reads, API
keys, webhooks and the rest each live in their own modules and aren't described here.

> **The public developer API is documented elsewhere.** The `/v1` JSON API, the `/mcp` server and the SDKs are
> described on [`/developers`](https://permtracker.app/developers). One registry, `src/lib/api/openapi.ts`, describes
> every operation: `/v1/openapi.json`, the `/mcp` tools and the `/developers` lists are built from it, and
> `src/lib/api/__tests__/sdk-parity.test.ts` holds both SDKs (`v2/sdk`, `v2/sdk-python`) to it. The answers' shapes
> are in `src/lib/api/schemas.ts` and the error codes in `src/lib/api/errors.ts`. The reads behind the operations are
> in `src/lib/api/reads.ts` and `src/lib/api/figureReads.ts`. Their Convex halves are `convex/apiKeys.ts` (keys,
> scopes, plans) and `convex/webhooks.ts` (endpoints and watches), and the paywall switch is `PAYWALL_ENFORCED`, read
> in `convex/lib/apiPlans.ts`. Alerts, support mail and the morning report are in `v2/CLAUDE.md`.

### Function Summary

Counted on 2026-11-25 as the lines of the form `export const <name> = <kind>(` in the 14 modules listed under
Module Overview, by kind. Helper functions, types and constants those files export aren't counted. Crons are
counted separately, as the `crons.daily`, `crons.hourly`, `crons.weekly`, `crons.cron` and `crons.interval` calls in
`convex/crons.ts`.

| Category | Count | Description |
|----------|-------|-------------|
| **Public queries** | 32 | Reads a signed-in client can call |
| **Public mutations** | 39 | Writes a signed-in client can call |
| **Public actions** | 3 | `users.immediateAccountDeletion`, `notificationActions.sendTestEmail`, `pushNotifications.sendTestPush` |
| **Internal queries** | 16 | Server-side reads |
| **Internal mutations** | 14 | Server-side writes |
| **Internal actions** | 12 | Server-side actions: email, push, the scheduled runs |
| **Total functions** | 116 | |
| **Crons that call these modules** | 8 | Of the 36 crons in `convex/crons.ts` |

### Module Overview

| Module | Public functions | Internal functions | Description |
|--------|-----------------|-------------------|-------------|
| `cases.ts` | 26 (11 queries, 15 mutations) | 1 (internal query) | Case reads, create and update with previews, delete, bulk changes, import, reopen, calendar sync switches |
| `notifications.ts` | 8 (4 queries, 4 mutations) | 7 (4 internal mutations, 3 internal queries) | In-app notifications: the bell, the dropdown, the notifications page |
| `dashboard.ts` | 3 (queries) | 0 | Deadlines, the summary and recent activity |
| `calendar.ts` | 3 (2 queries, 1 mutation) | 0 | Calendar events and the calendar's preferences |
| `timeline.ts` | 5 (2 queries, 3 mutations) | 0 | Timeline preferences and which cases show on it |
| `users.ts` | 17 (5 queries, 11 mutations, 1 action) | 3 (internal mutations) | The account, its profile and preferences, push subscription, analytics switches, account deletion |
| `caseRestore.ts` | 2 (1 query, 1 mutation) | 1 (internal mutation) | Listing and restoring deleted cases from the change log |
| `deadlineEnforcement.ts` | 5 (2 queries, 3 mutations) | 1 (internal mutation) | Closing cases whose deadlines have passed, and the alerts that say so |
| `userCaseOrder.ts` | 2 (1 query, 1 mutation) | 0 | The case list's drag and drop order |
| `pushSubscriptions.ts` | 1 (query) | 2 (1 internal query, 1 internal mutation) | Push subscription reads and clean-up |
| `pushNotifications.ts` | 1 (action) | 1 (internal action) | Web push delivery |
| `notificationActions.ts` | 1 (action) | 7 (internal actions) | Email delivery |
| `scheduledJobs.ts` | 0 | 17 (10 internal queries, 4 internal mutations, 3 internal actions) | The handlers most crons call |
| `deadlineDigest.ts` | 0 | 2 (1 internal query, 1 internal action) | The daily deadline reminder run |

The audit helpers in `convex/lib/audit.ts` and the auth helpers in `convex/lib/auth.ts` are plain functions, so they
aren't in the counts.

### Quick Start

```typescript
// 1. Import the Convex client
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

// 2. Query cases (reactive: re-runs when the data changes)
const cases = useQuery(api.cases.list, { status: "pwd" });

// 3. Create a case (employerName and positionTitle are the only required fields)
const createCase = useMutation(api.cases.create);
await createCase({
  employerName: "Acme Corp",
  positionTitle: "Software Engineer",
  beneficiaryIdentifier: "JD-01",
});

// 4. Get dashboard data
const summary = useQuery(api.dashboard.getSummary);
const deadlines = useQuery(api.dashboard.getDeadlines);
```

---

## Authentication Patterns

Every public function in these modules finds its caller through Convex Auth. Queries and mutations use the two
helpers in `convex/lib/auth.ts`. Actions read `ctx.auth.getUserIdentity()` and take the user id with
`extractUserIdFromAction(identity.subject)`, which keeps the part of the subject before the first `|`.

### `getCurrentUserId(ctx)`: strict authentication

Throws `Error("not authenticated")`, in lower case, when nobody is signed in. Mutations use it.

```typescript
export async function getCurrentUserId(ctx: AuthContext): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("not authenticated");
  }
  return userId;
}
```

It returns the id from the session. It doesn't check that a `users` row exists for it.

**Use it when:**
- Creating, updating or deleting data
- Anything that can't go ahead without a signed-in user

### `getCurrentUserIdOrNull(ctx)`: graceful authentication

Returns `null` when nobody is signed in. Queries use it, so signing out or a token refresh shows an empty state
instead of an error.

```typescript
// convex/cases.ts, list
handler: async (ctx, args) => {
  const userId = await getCurrentUserIdOrNull(ctx);
  if (userId === null) {
    return [];
  }

  // Security: Verify userId exists in users table (protects against invalid/foreign auth tokens)
  const userExists = await ctx.db.get(userId);
  if (!userExists) {
    console.warn("[list] Invalid userId from auth token:", userId);
    return [];
  }

  // Live cases, newest first (convex/lib/userCases.ts)
  let filteredCases = (await readUserCases(ctx, userId)).cases;
  // ...
},
```

**Use it when:**
- The function only reads
- An empty answer is fine while the session changes

### `verifyOwnership(ctx, doc, resourceName)`: ownership check

Checks that the signed-in user owns a document. It throws `Error("<resourceName> not found")` when the document is
`null`, then calls `getCurrentUserId` (so it can throw `"not authenticated"`), then throws
`Error("Access denied: you do not own this <resourceName>")` when the document's `userId` isn't the caller's.

```typescript
// convex/cases.ts, update
const caseDoc = await ctx.db.get(args.id);

// Verify ownership (throws if not found or not owned by user)
await verifyOwnership(ctx, caseDoc, "case");
```

The two messages differ, so a caller can tell a missing case from someone else's. In this reference's modules only
`cases.ts` uses it, in 11 functions: `previewUpdate`, `update`, `remove`, `toggleFavorite`, `togglePinned`,
`setWatchEnabled`, `toggleCalendarSync`, `enableCalendarSync`, `disableCalendarSync`, `clearJobDescription` and
`reopenCase`. The other modules compare `userId` themselves. `cases.get` returns `null` in every case instead, so it never says
whether an id exists.

**Steps for a guarded write:**
1. Read the document
2. Call `verifyOwnership()`
3. Make the change

---

## Module Reference

### cases.ts

The signed-in app's case functions: reading, creating, editing, deleting, importing and closing PERM cases, with PERM validation, the change log, notifications and calendar sync.

**Module Location:** `convex/cases.ts`

Things every function here shares:

- Reads go through `readUserCases` (`convex/lib/userCases.ts`). It reads the account's live cases newest first through the `by_user_and_deleted` index, stops at `USER_CASES_MAX` (5,000) or when the transaction's read budget runs low, and hands them back oldest first with a `truncated` flag.
- The employer's FEIN is stored encrypted (`encryptToken`, `convex/lib/crypto.ts`). `list`, `get` and `listByIds` decrypt it. A value that isn't encrypted is returned as stored, and one that fails to decrypt comes back as `undefined`.
- Deleting a case erases its row. Before that, `logDelete` writes every field of the old document (the FEIN redacted) to its `auditLogs` row, which `convex/caseRestore.ts` can restore from for 30 days.
- The change log (`logCreate`, `logUpdate`, `logDelete` in `convex/lib/audit.ts`) is written after each change. A change-log failure is recorded with `recordError` and doesn't undo the change, except in `clearJobDescription`, which doesn't catch it.
- Ownership checks use `verifyOwnership(ctx, doc, "case")`. It throws `"case not found"` for a missing document, `"not authenticated"` with no session, and `"Access denied: you do not own this case"` for someone else's case. These are plain `Error`s, so in production Convex shows the client a generic server error in their place.
- `create`, `update` and `bulkUpdateStatus` are rate limited per account (`caseCreate` and `caseUpdate` in `convex/rateLimitConfig.ts`: a token bucket of 60 a minute with a capacity of 30).

---

#### `list` (query)

The account's live cases, with an optional stage or favourites filter.

```typescript
list(args: {
  status?: "pwd" | "recruitment" | "eta9089" | "i140" | "i485" | "consular" | "complete" | "closed";
  favoritesOnly?: boolean;
}): Promise<Case[]>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | `CaseStatus` | No | Only cases at this stage |
| `favoritesOnly` | `boolean` | No | Only favourited cases |

**Returns:** `Case[]`: full case documents, oldest first, with the FEIN decrypted. An empty array when nobody is signed in or the session's user id has no `users` row.

**Authentication:** `getCurrentUserIdOrNull()`.

**Example:**
```typescript
const pwdCases = useQuery(api.cases.list, { status: "pwd" });
const favorites = useQuery(api.cases.list, { favoritesOnly: true });
const allCases = useQuery(api.cases.list, {});
```

**Notes:**
- It reads up to 5,000 live cases (`USER_CASES_MAX`), newest first, so an account with more loses its oldest. `readCoverage` says when that happens.
- For the case list page, with search, sorting and paging, use `listFiltered`.

---

#### `get` (query)

One case by id, for its owner only.

```typescript
get(args: {
  id: string;
}): Promise<Case | null>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | Yes | The case id as text, usually straight from the page's address |

**Returns:** `Case | null`: the case with its FEIN decrypted, or `null`.

**Authentication:** `getCurrentUserIdOrNull()`.

**Returns `null` when:**
- nobody is signed in
- the text isn't the shape of a case id (`ctx.db.normalizeId("cases", id)` returns `null`)
- no case has that id
- the case carries a `deletedAt` stamp
- the case belongs to another account

**Example:**
```typescript
const caseDoc = useQuery(api.cases.get, { id: params.id });

if (caseDoc === undefined) return <Skeleton />;
if (caseDoc === null) return <NotFound />;
return <CaseDetails case={caseDoc} />;
```

**Notes:**
- The argument is a plain string so a cut-off or mistyped link reaches the handler and returns `null`. With `v.id("cases")` it threw before the handler ran.
- It returns `null` in every failure case, so it never says whether another account's case exists. In development each reason is logged at debug level.

---

#### `listFiltered` (query)

The case list page: filters, search, sorting and paging over the account's cases.

```typescript
listFiltered(args: {
  status?: string;
  progressStatus?: string;
  searchQuery?: string;
  favoritesOnly?: boolean;
  duplicatesOnly?: boolean;
  activeOnly?: boolean;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
}): Promise<CaseListResponse>
```

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `status` | `string` | No | - | Only cases at this stage |
| `progressStatus` | `string` | No | - | Only cases with this progress status |
| `searchQuery` | `string` | No | - | Search, described below |
| `favoritesOnly` | `boolean` | No | `false` | Only favourited cases |
| `duplicatesOnly` | `boolean` | No | `false` | Only cases with a `duplicateOf` link |
| `activeOnly` | `boolean` | No | `false` | Leaves out closed cases and cases with an approved I-140 |
| `sortBy` | `string` | No | `"deadline"` | One of `deadline`, `updated`, `employer`, `status`, `pwdFiled`, `etaFiled`, `i140Filed`, `custom`, `favorites`. Anything else falls back to `deadline` |
| `sortOrder` | `string` | No | `"asc"` | `asc` or `desc`. Anything else falls back to `asc` |
| `page` | `number` | No | `1` | Page number, starting at 1 |
| `pageSize` | `number` | No | `12` | Cases a page. `0` returns every matching case |

**Returns:**
```typescript
interface CaseListResponse {
  cases: CaseCardData[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;           // matching cases, after filters and search
    totalPages: number;           // 0 when totalCount is 0
    totalUnfilteredCount: number; // live cases read, before any filter
    truncated: boolean;           // the account holds more than one read returns
  };
}
```

`CaseCardData` is the card projection from `projectCaseForCard` (`convex/lib/caseListHelpers.ts`), with the next deadline worked out for today. The types live in `convex/lib/caseListTypes.ts`.

**Authentication:** `getCurrentUserIdOrNull()`. With nobody signed in, or a session user id with no `users` row, it returns no cases and an empty pagination block.

**Example:**
```typescript
const result = useQuery(api.cases.listFiltered, {
  searchQuery: "Acme",
  status: "recruitment",
  sortBy: "deadline",
  sortOrder: "asc",
  page: 1,
  pageSize: 20,
});
```

**Notes:**
- It reads the account's live cases once (up to 5,000), then filters, searches, sorts and pages them in memory.
- Search is `filterBySearch`: every word typed has to be found in the employer, the foreign worker ID, the position title or the notes, with typos forgiven by the site's fuzzy matcher (`convex/lib/fuzzy.ts`). A query of four or more letters and digits also matches a case number exactly, ignoring dashes and spaces (the DOL number, the internal number, the wage request and ETA 9089 numbers, the I-140 receipt number and the SOC code), and that match ranks first. The search ranks its matches by relevance, then the sort orders them by `sortBy`.

---

#### `listFilteredIds` (query)

Every case id the list's filters and search match, for "select all" and "export what's shown".

```typescript
listFilteredIds(args: {
  status?: string;
  progressStatus?: string;
  searchQuery?: string;
  favoritesOnly?: boolean;
  duplicatesOnly?: boolean;
  activeOnly?: boolean;
}): Promise<Id<"cases">[]>
```

**Returns:** `Id<"cases">[]`. An empty array when nobody is signed in.

**Authentication:** `getCurrentUserIdOrNull()`.

**Notes:** It takes the same filters as `listFiltered` and runs the same search, so it picks exactly the cases the list shows.

---

#### `readCoverage` (query)

Whether the account holds more live cases than one read returns. The case list, dashboard, calendar and timeline show a notice when it does (`src/components/cases/CaseCapNotice.tsx`).

```typescript
readCoverage(args: {}): Promise<{ truncated: boolean; max: number }>
```

**Returns:** `truncated`, and `max`, which is `USER_CASES_MAX` (5,000). With nobody signed in, `{ truncated: false, max: 5000 }`.

**Authentication:** `getCurrentUserIdOrNull()`.

---

#### `listByIds` (query)

Full case documents for a list of ids, for the export feature.

```typescript
listByIds(args: {
  ids: Id<"cases">[];
}): Promise<Array<Omit<Case, "userId">>>
```

**Returns:** each case that exists, has no `deletedAt` stamp and belongs to the caller, without its `userId` and with the FEIN decrypted. Ids that fail any check are skipped. An empty array when nobody is signed in.

**Authentication:** `getCurrentUserIdOrNull()`.

---

#### `checkDuplicates` (query)

Finds which of a list of cases would duplicate one the account already has, before an import or a save.

```typescript
checkDuplicates(args: {
  cases: Array<{
    employerName: string;
    beneficiaryIdentifier?: string;
  }>;
  excludeCaseId?: Id<"cases">;
}): Promise<{ duplicates: DuplicateMatch[] }>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cases` | `Array<{ employerName, beneficiaryIdentifier? }>` | Yes | Cases to check |
| `excludeCaseId` | `Id<"cases">` | No | A case to leave out of the comparison, so an edited case isn't its own duplicate |

**Returns:**
```typescript
interface DuplicateMatch {
  index: number;                 // position in the input array
  employerName: string;
  beneficiaryIdentifier: string; // "" when the input had none
  existingCaseId: string;
  existingPositionTitle?: string;
  existingCaseStatus?: string;
}
```

**Authentication:** `getCurrentUserIdOrNull()`. Returns `{ duplicates: [] }` when nobody is signed in.

**Notes:**
- Two cases match when the employer and the foreign worker ID are equal after trimming and lowercasing. A missing foreign worker ID counts as `""`.
- It reads every live case on the account with `.collect()` on `by_user_and_deleted`.

---

#### `previewCreate` (query)

What `create` would do with these arguments, without writing: whether they pass validation, and the stage the new case would start at.

```typescript
previewCreate(args: CaseCreateArgs): Promise<{
  valid: boolean;
  errors: string[];
  caseStatus: string;
  progressStatus: string;
}>
```

**Returns:** `errors` holds each failed rule as `"[ruleId] field: message"`. `caseStatus` and `progressStatus` are the stage the dates put the case at, or the ones passed when `progressStatusOverride` is true.

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Notes:** It and `create` both work from `planCaseCreate`, so they can't disagree.

---

#### `create` (mutation)

Creates a case: derived dates, validation, the stage, the change log, a notification and calendar sync.

```typescript
create(args: {
  // Required
  employerName: string;
  positionTitle: string;

  // Everything else is optional: any stored field of the `cases` table
  // except the ones the server sets (userId, recruitmentStartDate,
  // recruitmentEndDate, filingWindowOpens, filingWindowCloses,
  // recruitmentWindowCloses, closureReason, closedAt, createdAt,
  // updatedAt, deletedAt, markedAsDuplicateAt). For example:
  beneficiaryIdentifier?: string;
  caseStatus?: "pwd" | "recruitment" | "eta9089" | "i140" | "i485" | "consular" | "complete" | "closed";
  progressStatus?: "working" | "waiting_intake" | "filed" | "approved" | "under_review" | "rfi_rfe";
  progressStatusOverride?: boolean;
  priorityLevel?: "low" | "normal" | "high" | "urgent";
  isProfessionalOccupation?: boolean;
  pwdFilingDate?: string;          // ISO date, YYYY-MM-DD
  pwdDeterminationDate?: string;
  pwdExpirationDate?: string;
  employerFein?: string;
  duplicateOf?: Id<"cases">;
  calendarEventIds?: {             // seven of the stored slots
    pwd_expiration?: string;
    eta9089_filing_window?: string;
    eta9089_expiration?: string;
    i140_filing_deadline?: string;
    rfi_due?: string;
    rfe_due?: string;
    recruitment_end?: string;
  };
  // ...
}): Promise<Id<"cases">>
```

The arguments are built from the table's own validator (`schema.tables.cases.validator`), so they can't drift from it, and a compile-time check (`CaseArgsFitTable`) proves every argument is a stored field of the stored type.

**Returns:** `Id<"cases">`: the new case's id.

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Throws:**
- the rate limiter's error past the `caseCreate` limit
- `"<Field> exceeds maximum length of <n> characters"` from `validateCaseText`: 500 characters for names, titles and codes, 10,000 for recruitment notes and the recruitment summary, 50,000 for the job description
- `"SOC code must be a code such as 15-1252 or 15-1252.00."`
- `"Documents are added by uploading them to the case."` when `documents` names any file (a new case holds none)
- `"Validation failed: ..."` when any PERM rule fails

**What it does:**
1. Works out the derived dates with `calculateDerivedDates`: `recruitmentStartDate`, `recruitmentEndDate`, `filingWindowOpens`, `filingWindowCloses` and `recruitmentWindowCloses`. A certified case gets its ETA 9089 expiration from `resolveEta9089ExpirationDate`.
2. Validates with `validateCase` and refuses the case on any error.
3. Sets the stage from the dates with `calculateAutoStatus`, unless `progressStatusOverride` is true. Then it uses the stage passed, or `pwd` and `working`.
4. Stores the case through `insertCaseByCreateRules` with these defaults: `beneficiaryIdentifier` `""`, `priorityLevel` `normal`, `calendarSyncEnabled` true, empty lists for tags, documents, recruitment methods and RFI and RFE entries. A DOL number typed only in a step's box becomes the case's `caseNumber`. The FEIN is encrypted, and `markedAsDuplicateAt` is stamped when `duplicateOf` is set.
5. Writes the change log's creation row.
6. Schedules a Google Calendar sync through `scheduleCalendarSync` unless `calendarSyncEnabled` is false. That helper schedules nothing for an account that can't sync.
7. When the account's `emailStatusUpdates` preference is on and the case isn't the sample case, creates a "New case created" notification and, when the preferences allow, schedules `sendStatusChangeEmail`.

Steps 5 to 7 are best-effort: a failure is logged and recorded and the case stays.

The arguments include `liveStatus`, `liveStatusSeenAt`, `liveStatusIsFinal` and `watchEnabled`, but `insertCaseByCreateRules` doesn't store them.

**Example:**
```typescript
const createCase = useMutation(api.cases.create);

const caseId = await createCase({
  employerName: "Acme Corporation",
  positionTitle: "Senior Software Engineer",
  beneficiaryIdentifier: "JD-01",
  pwdFilingDate: "2024-06-01",
  pwdDeterminationDate: "2024-06-15",
  isProfessionalOccupation: true,
});
```

**Validation error format:**
```
Validation failed: [V-PWD-01] pwd_filing_date: PWD filing date must be before determination date (20 CFR 656.40)
```

Several failed rules are joined with `"; "`. The error is a `ConvexError`, so the text reaches the client in production.

---

#### `previewUpdate` (query)

What `update` would do with these arguments, without writing. The chat calls it before it shows a confirmation card.

```typescript
previewUpdate(args: CaseUpdateArgs): Promise<{
  valid: boolean;
  errors: string[];
  caseStatus: string;
  progressStatus: string;
  stageFollowsDates: boolean;
}>
```

**Returns:** the validation result, the stage the case would be at afterwards, and `stageFollowsDates`, which is false when the stage is set by hand (`progressStatusOverride`).

**Authentication:** `verifyOwnership()`. Throws `"Cannot update deleted case"` for a case with a `deletedAt` stamp.

**Notes:** It and `update` both work from `planCaseUpdate`, so they can't disagree.

---

#### `update` (mutation)

Changes a case. An absent field keeps its stored value.

```typescript
update(args: {
  id: Id<"cases">;
  // Every field `create` takes, all optional, except isSample
  // (whether a case is the sample is fixed when it's created).
  // These also take null, which clears the stored value:
  // caseNumber, internalCaseNumber, employerFein, socCode, socTitle,
  // jobOrderState, pwdFilingDate, pwdDeterminationDate, pwdExpirationDate,
  // pwdCaseNumber, pwdWageLevel, jobOrderStartDate, jobOrderEndDate,
  // sundayAdFirstDate, sundayAdSecondDate, sundayAdNewspaper,
  // additionalRecruitmentStartDate, additionalRecruitmentEndDate,
  // recruitmentNotes, recruitmentSummaryCustom, noticeOfFilingStartDate,
  // noticeOfFilingEndDate, eta9089FilingDate, eta9089AuditDate,
  // eta9089CertificationDate, eta9089DenialDate, eta9089ReconsiderationDate,
  // eta9089ReconsiderationDeniedDate, eta9089BalcaRequestDate,
  // eta9089ExpirationDate, eta9089CaseNumber, i140FilingDate,
  // i140ReceiptDate, i140ReceiptNumber, i140ApprovalDate, i140DenialDate,
  // i140ServiceCenter, i140Category, jobDescription,
  // jobDescriptionPositionTitle.
  employerName?: string;
  positionTitle?: string;
  pwdDeterminationDate?: string | null;
  // ...
}): Promise<Id<"cases">>
```

**Returns:** `Id<"cases">`: the id passed in.

**Authentication:** `verifyOwnership()`. The `caseUpdate` rate limit is charged to the case's owner.

**Throws:**
- the length and SOC code errors from `validateCaseText` (checked before ownership)
- the ownership errors above
- the rate limiter's error
- `"Cannot update deleted case"`
- `"Documents are added by uploading them to the case."` when `documents` names a file the case doesn't already hold
- `"Validation failed: ..."` when any PERM rule fails on the merged data

**What it does:**
1. Merges the arguments with the stored case and recalculates the derived dates.
2. Validates the merged case, unless every argument is a status or metadata field (`caseStatus`, `progressStatus`, `progressStatusOverride`, `notes`, `documents`, `isFavorite`, `isPinned`, `tags`, `calendarSyncEnabled`, `showOnTimeline`).
3. Sets the stage from the dates, unless `progressStatusOverride` is true in the arguments or on the case.
4. Carries a DOL number typed only in the ETA 9089's or the wage request's box into `caseNumber`. A different DOL number clears `liveStatus`, `liveStatusSeenAt` and `liveStatusIsFinal`, so the next sweep starts over.
5. Encrypts a new FEIN. A timeline switch sent back unchanged is left as it was.
6. A case leaving `closed` loses its `closureReason` and `closedAt`, and its unread `auto_closure` notifications are marked read. A case entering `closed` gets `closedAt` and a `closureReason` of `denied` (when an I-140 denial date closed it and the stage follows the dates) or `manual`.
7. Writes the change log with the old and new documents.
8. Unless the case is the sample case: a stage change creates a "Case status updated" notification and, when the preferences allow, schedules `sendStatusChangeEmail`. A progress-only change creates a low-priority "Case progress updated" notification with no email. Both need the `emailStatusUpdates` preference. A changed job description creates a low-priority "Job description updated" notification.
9. Schedules a Google Calendar sync when a deadline-related field was passed (the PWD expiration, the ETA 9089 filing, certification and expiration dates, the three derived windows, RFI and RFE entries, `calendarSyncEnabled`, `caseStatus` or `progressStatus`) and the case's sync is on.

Steps 7 to 9 are best-effort.

The patch writes every field passed, `liveStatus`, `liveStatusSeenAt`, `liveStatusIsFinal` and `watchEnabled` included.

**Example:**
```typescript
const updateCase = useMutation(api.cases.update);

await updateCase({
  id: caseId,
  pwdDeterminationDate: "2024-06-20",
  sundayAdSecondDate: null, // clears the stored date
});
```

---

#### `remove` (mutation)

Deletes a case for good and clears what other records hold about it.

```typescript
remove(args: {
  id: Id<"cases">;
}): Promise<Id<"cases">>
```

**Returns:** `Id<"cases">`: the deleted case's id.

**Authentication:** `verifyOwnership()`.

**What it does, in order:**
1. Writes the change log's deletion row, a copy of the whole case with the FEIN redacted. Settings can restore from it for 30 days (`caseRestore.listRecentlyDeleted` and `caseRestore.restoreDeleted`).
2. Deletes the case's notifications in batches of 100 (`notifications.cleanupCaseNotifications`).
3. Schedules `googleCalendarActions.deleteCaseCalendarEvents`.
4. Clears references to the case: the custom case order, the timeline selection, dismissed deadlines, a conversation's related case, chat citations and other cases' `duplicateOf` links. It also deletes the case's applicant log, its recruitment share links and its second reminder recipient.
5. Deletes the case's uploaded files from storage.
6. Deletes the case's row with `ctx.db.delete`.

Steps 1 to 5 are best-effort: a failure is logged and recorded, and the deletion goes on.

**Example:**
```typescript
const removeCase = useMutation(api.cases.remove);
await removeCase({ id: caseId });
```

---

#### `bulkRemove` (mutation)

Deletes several cases with the same steps as `remove`, carrying on past a case that fails.

```typescript
bulkRemove(args: {
  ids: Id<"cases">[];
}): Promise<{
  successCount: number;
  failedCount: number;
  errors?: string[];
}>
```

**Returns:** the counts, and `errors` (only when something failed) with lines such as `"Case <id> not found"`, `"Case <id> not owned by user"` or `"Case <id>: <message>"`.

**Authentication:** `getCurrentUserId()`.

**Notes:** The reference cleanup in step 4 of `remove` runs once, after the loop, for every case that was deleted.

**Example:**
```typescript
const bulkRemove = useMutation(api.cases.bulkRemove);
const result = await bulkRemove({ ids: selectedCaseIds });
```

---

#### `bulkUpdateStatus` (mutation)

Closes, reopens or sets the stage of several cases.

```typescript
bulkUpdateStatus(args: {
  ids: Id<"cases">[];
  status: "pwd" | "recruitment" | "eta9089" | "i140" | "i485" | "consular" | "complete" | "closed";
  closureReason?: "withdrawn" | "denied" | "manual" | "other";
}): Promise<{
  successCount: number;
  failedCount: number;
  unchangedCount: number;
  results: Array<{ id: Id<"cases">; caseStatus: string; progressStatus: string }>;
  errors?: string[];
}>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | `Id<"cases">[]` | Yes | At most 5,000 (`USER_CASES_MAX`) |
| `status` | `CaseStatus` | Yes | The stage to move them to |
| `closureReason` | `string` | No | Read only when `status` is `"closed"`. Defaults to `"manual"` |

**Returns:** the counts, the stage each changed case ended at, and `errors` when anything failed. A case already at the target stage counts as unchanged.

**Authentication:** `getCurrentUserId()`. Charges the `caseUpdate` rate limit once a call. Throws `"At most 5000 cases at a time."` for a longer list.

**What it does to each case:**
- `"closed"` closes it: `closureReason`, `closedAt` and `progressStatusOverride: true`, so a later date edit doesn't reopen it.
- Any other stage on a closed case reopens it at the stage its dates support (`determineReopenStatus`, the same rule as `reopenCase`), clears the closure fields and the override, and marks its unread `auto_closure` notifications read.
- Any other stage on an open case sets that stage by hand (`progressStatusOverride: true`).

Each change writes the change log. Unless the case is the sample case and when `emailStatusUpdates` is on, each creates a "Case status updated" notification, and the first 10 changed cases also get a status email when the preferences allow. At the end it schedules a calendar sync for every changed case.

**Example:**
```typescript
const bulkUpdateStatus = useMutation(api.cases.bulkUpdateStatus);

const result = await bulkUpdateStatus({
  ids: selectedCaseIds,
  status: "closed",
  closureReason: "withdrawn",
});
```

---

#### `bulkUpdateCalendarSync` (mutation)

Turns calendar sync on or off for several cases.

```typescript
bulkUpdateCalendarSync(args: {
  ids: Id<"cases">[];
  calendarSyncEnabled: boolean;
}): Promise<{ successCount: number; failedCount: number }>
```

**Returns:** the counts. A case already in the wanted state counts as a success. A missing, deleted or another account's case counts as a failure.

**Authentication:** `getCurrentUserId()`.

**Notes:** Turning sync on schedules a sync for the changed cases. Turning it off schedules `deleteCaseCalendarEvents` for each.

---

#### `toggleFavorite` (mutation)

Flips a case's favourite flag.

```typescript
toggleFavorite(args: {
  id: Id<"cases">;
}): Promise<boolean>
```

**Returns:** `boolean`: the new favourite state.

**Authentication:** `verifyOwnership()`.

---

#### `togglePinned` (mutation)

Flips a case's pinned flag. A case with no flag stored counts as unpinned.

```typescript
togglePinned(args: {
  id: Id<"cases">;
}): Promise<boolean>
```

**Returns:** `boolean`: the new pinned state.

**Authentication:** `verifyOwnership()`.

---

#### `setWatchEnabled` (mutation)

Turns the DOL live-status watch on or off for one case. The 5-minute sweep (`convex/appCaseWatch.ts`) skips a case whose watch is off.

```typescript
setWatchEnabled(args: {
  id: Id<"cases">;
  enabled: boolean;
}): Promise<boolean>
```

**Returns:** `boolean`: the value written to `watchEnabled`.

**Authentication:** `verifyOwnership()`. Throws `"Cannot update deleted case"`.

**Notes:** It leaves `updatedAt` alone, so the setting doesn't count as an edit of the case.

---

#### `toggleCalendarSync` (mutation)

Flips calendar sync for a case.

```typescript
toggleCalendarSync(args: {
  id: Id<"cases">;
}): Promise<boolean>
```

**Returns:** `boolean`: the new `calendarSyncEnabled` state.

**Authentication:** `verifyOwnership()`. Throws `"Cannot update deleted case"`.

**Notes:** Turning it on schedules a sync. Turning it off schedules `deleteCaseCalendarEvents`.

---

#### `enableCalendarSync` (mutation)

Turns calendar sync on for a case. Calling it again changes nothing.

```typescript
enableCalendarSync(args: { id: Id<"cases"> }): Promise<boolean>
```

**Returns:** always `true`.

**Authentication:** `verifyOwnership()`. Throws `"Cannot update deleted case"`.

**Notes:** It writes and schedules a sync only when sync was off.

---

#### `disableCalendarSync` (mutation)

Turns calendar sync off for a case. Calling it again changes nothing.

```typescript
disableCalendarSync(args: { id: Id<"cases"> }): Promise<boolean>
```

**Returns:** always `false`.

**Authentication:** `verifyOwnership()`. Throws `"Cannot update deleted case"`.

**Notes:** It writes and schedules `deleteCaseCalendarEvents` only when sync was on.

---

#### `clearJobDescription` (mutation)

Removes a case's job description, its position title and its template link.

```typescript
clearJobDescription(args: { id: Id<"cases"> }): Promise<{ success: true }>
```

**Authentication:** `verifyOwnership()`. Throws a `ConvexError` `"Case not found"` for a missing case (before the ownership check) and `"Cannot update deleted case"`.

**Notes:** It writes the change log. A change-log failure here fails the whole mutation.

---

#### `importCases` (mutation)

Imports cases from an export file, with a choice for each duplicate.

```typescript
importCases(args: {
  cases: Array<{
    employerName: string;
    beneficiaryIdentifier: string;   // required here
    positionTitle?: string;
    caseStatus?: CaseStatus;
    progressStatus?: ProgressStatus;
    // ...most stored case fields, all optional, plus:
    jobTitle?: string;               // accepted from older files and dropped
    additionalRecruitmentMethods?: Array<{ method: string; date?: string; ... }>;
    rfiEntries?: Array<ImportedRequestEntry>;  // createdAt optional, `reason` read as notes
    rfeEntries?: Array<ImportedRequestEntry>;
    notes?: Array<{ id: string; content: string; createdAt: number; status?: "pending" | "done" }>;
  }>;
  resolutions?: Record<string, "skip" | "replace">;
}): Promise<{
  importedCount: number;
  skippedCount: number;
  replacedCount: number;
  validationWarnings: Array<{
    caseIndex: number;
    employerName: string;
    beneficiaryIdentifier: string;
    errors: Array<{ ruleId: string; message: string }>;
  }>;
}>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cases` | `Array<ImportCase>` | Yes | Cases to import, in older export formats too |
| `resolutions` | `Record<string, "skip" \| "replace">` | No | What to do with each duplicate, keyed by its index in `cases` as a string. A duplicate with no choice is skipped |

**Returns:** the counts and the validation warnings.

**Authentication:** `getCurrentUserId()`.

**What it does:**
- Each case passes the same text caps as `create` (`validateCaseText`), and a failure there stops the whole import.
- A duplicate (the same employer and foreign worker ID, trimmed and lowercased) of a stored case is skipped, or with `"replace"` the stored case is deleted with every step `remove` takes and the new one is imported. A second copy of a key within the same file is skipped.
- PERM validation doesn't refuse a case: its failed rules come back in `validationWarnings` and are logged.
- Each imported case gets its derived dates and its ETA 9089 expiration. Its stage is the one in the file, or `pwd` and `working`. The dates don't set it. The FEIN is encrypted, documents start empty, and the change log gets a creation row.

**Notes:** It schedules no calendar sync and creates no notifications for the imported cases.

**Example:**
```typescript
const { duplicates } = await convex.query(api.cases.checkDuplicates, {
  cases: rows.map((r) => ({ employerName: r.employerName, beneficiaryIdentifier: r.beneficiaryIdentifier })),
});

const resolutions: Record<string, "skip" | "replace"> = {};
for (const d of duplicates) resolutions[String(d.index)] = choices[d.index] ?? "skip";

const result = await importCases({ cases: rows, resolutions });
```

---

#### `reopenCase` (mutation)

Reopens a closed case at the stage its dates support.

```typescript
reopenCase(args: {
  id: Id<"cases">;
}): Promise<{
  success: boolean;
  newCaseStatus: string;
  newProgressStatus: string;
}>
```

**Returns:** `success: true` and the stage the case reopened at.

**Authentication:** `verifyOwnership()`.

**Throws:**
- `"Case is not closed"`
- `"Cannot reopen deleted case"`

**What it does:** Works out the stage with `determineReopenStatus` (`convex/lib/caseListHelpers.ts`), which checks the most advanced stage first (an approved I-140, then a filed one, and so on down to PWD) and an open RFI or RFE. It sets `progressStatusOverride` to false, clears `closureReason` and `closedAt`, marks the case's unread `auto_closure` notifications read and writes the change log.

**Example:**
```typescript
const reopenCase = useMutation(api.cases.reopenCase);
const result = await reopenCase({ id: caseId });
```

---

#### `getSyncEligibleCaseCount` (query)

How many live cases a calendar sync would cover, for the "Syncing N cases" message in Settings.

```typescript
getSyncEligibleCaseCount(args: {}): Promise<number>
```

**Returns:** live cases whose `calendarSyncEnabled` isn't false, leaving out the sample case. `0` when nobody is signed in.

**Authentication:** `getCurrentUserIdOrNull()`.

---

#### `getCasesWithEventsCount` (query)

How many cases have calendar events, for the "Clear all" message in Settings.

```typescript
getCasesWithEventsCount(args: {}): Promise<{ caseCount: number; estimatedEventCount: number }>
```

**Returns:** the cases with at least one stored calendar event id, and the total of those ids. Zeros when nobody is signed in.

**Authentication:** `getCurrentUserIdOrNull()`.

---

#### Internal functions

- `listForSync` (internal query): `{ userId }` to each live case's `_id`, `employerName` and `calendarSyncEnabled` (always false for the sample case), for the sync-all action.

---

### notifications.ts

The in-app notifications: the bell's count, the header's dropdown and the full notifications page.

**Module Location:** `convex/notifications.ts`

Every public query reads the caller with `getCurrentUserIdOrNull()` and answers with empty data when nobody is signed in. Every public mutation reads the caller with `getCurrentUserId()`, which throws `"not authenticated"`.

---

#### `getUnreadCount` (query)

The number of unread notifications, for the bell's badge.

```typescript
getUnreadCount(): Promise<number>
```

**Returns:** `number`: unread notifications, counted up to `UNREAD_COUNT_CAP` (1,000, in `convex/lib/notificationHelpers.ts`). 0 when signed out.

**Index:** `by_user_and_unread` (`userId`, `isRead`), read with `.take(UNREAD_COUNT_CAP)`.

---

#### `getRecentNotifications` (query)

The newest notifications, for the header's dropdown.

```typescript
getRecentNotifications(args?: {
  limit?: number;
}): Promise<NotificationWithCase[]>
```

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | `number` | No | `5` | How many to return, newest first |

**Returns:**
```typescript
// A notifications document with the case it names joined on.
interface NotificationWithCase {
  _id: Id<"notifications">;
  _creationTime: number;
  userId: Id<"users">;
  caseId?: Id<"cases">;
  type: NotificationType;
  title: string;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
  deadlineDate?: string;       // ISO date
  deadlineType?: string;       // e.g. "pwd_expiration", "rfi_due"
  daysUntilDeadline?: number;
  isRead: boolean;
  readAt?: number;
  emailSent: boolean;
  emailSentAt?: number;
  createdAt: number;
  updatedAt: number;
  // null when there's no caseId, or the case is gone or deleted
  caseInfo: {
    employerName?: string;
    beneficiaryIdentifier?: string;
    positionTitle?: string;
    caseStatus?: string;
  } | null;
}
```

**Authentication:** returns `[]` when signed out.

**Index:** `by_user_id`, read newest first with `.take(limit)`.

**Notes:**
- The query doesn't cap `limit`. Convex's own read limits are the only ceiling.

---

#### `getNotifications` (query)

One page of notifications for the full notifications page, with optional filters.

```typescript
getNotifications(args?: {
  cursor?: string;
  limit?: number;
  filters?: {
    type?: NotificationType[];
    isRead?: boolean;
    caseId?: Id<"cases">;
  };
}): Promise<{
  notifications: NotificationWithCase[];
  nextCursor: string | null;
  hasMore: boolean;
}>
```

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cursor` | `string` | No | - | The `nextCursor` of the previous page |
| `limit` | `number` | No | `20` | Page size, clamped to 1 to 100 |
| `filters.type` | `NotificationType[]` | No | - | Only these types (an empty array means every type) |
| `filters.isRead` | `boolean` | No | - | Only read, or only unread |
| `filters.caseId` | `Id<"cases">` | No | - | Only this case's notifications |

**Returns:** the page, newest first, each row joined to its case as in `getRecentNotifications`. `nextCursor` is set only when `hasMore` is true.

**Authentication:** returns `{ notifications: [], nextCursor: null, hasMore: false }` when signed out.

**How a page is read:**
- With `filters.isRead` set, the read uses `by_user_and_unread`. Without it, the read uses `by_user_id`. Both are scoped to the caller by the index.
- The type and case filters are checked row by row. A page keeps reading older rows until it's full or it has looked at `NOTIFICATION_PAGE_SCAN_MAX` (4,000) rows. Past either, it stops with `hasMore: true`.
- The cursor is `c:<_creationTime>` of the last row the page looked at, which may be a row it filtered out, so the next page starts where the scan stopped. An older cursor of the form `<createdAt>|<id>` still reads, as "older than createdAt".

**Example:**
```typescript
const page = useQuery(api.notifications.getNotifications, {
  limit: 20,
  filters: { isRead: false },
});

// The next page passes the cursor back.
const next = useQuery(
  api.notifications.getNotifications,
  page?.hasMore ? { cursor: page.nextCursor ?? undefined, limit: 20, filters: { isRead: false } } : "skip",
);
```

---

#### `getNotificationStats` (query)

Counts of the caller's notifications: in all, unread, and by type.

```typescript
getNotificationStats(): Promise<{
  total: number;
  unread: number;
  byType: Record<string, number>;  // e.g. { deadline_reminder: 5, status_change: 3 }
  capped: boolean;
}>
```

**Returns:** the counts over the newest `NOTIFICATION_STATS_MAX` (20,000) notifications. `capped` is true when the caller has more than that and the count stopped there.

**Authentication:** returns `{ total: 0, unread: 0, byType: {}, capped: false }` when signed out.

**Index:** `by_user_id`, newest first.

---

#### `markAsRead` (mutation)

Marks one notification read.

```typescript
markAsRead(args: {
  notificationId: Id<"notifications">;
}): Promise<{ success: true }>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `notificationId` | `Id<"notifications">` | Yes | The notification to mark read |

**Returns:** `{ success: true }`

**Throws:**
- `"not authenticated"`: nobody is signed in
- `"Notification not found"`: no such notification
- `"Access denied: you do not own this notification"`: it's another user's

**Writes:** `isRead: true`, `readAt` and `updatedAt` set to now.

---

#### `markAllAsRead` (mutation)

Marks up to 100 unread notifications read per call.

```typescript
markAllAsRead(): Promise<{
  count: number;    // marked in this call, at most 100
  hasMore: boolean; // true when unread ones remain: call again
}>
```

**Authentication:** `getCurrentUserId()`.

**Rate limit:** `notificationsMarkAllRead` in `convex/rateLimitConfig.ts` (token bucket, 20 a minute, capacity 5), keyed by user. Past it the call throws the rate limiter's `ConvexError` (`{ kind: "RateLimited", name, retryAfter }`).

**Index:** `by_user_and_unread`, reading 101 rows to learn whether more remain.

**Example:**
```typescript
const markAllAsRead = useMutation(api.notifications.markAllAsRead);

let result = await markAllAsRead();
while (result.hasMore) {
  result = await markAllAsRead();
}
```

---

#### `deleteNotification` (mutation)

Deletes one notification. The row is removed from the table.

```typescript
deleteNotification(args: {
  notificationId: Id<"notifications">;
}): Promise<{ success: true }>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `notificationId` | `Id<"notifications">` | Yes | The notification to delete |

**Returns:** `{ success: true }`

**Throws:** the same three errors as `markAsRead`.

**Side effects:** writes a delete entry to the change log (`logDelete` in `convex/lib/audit.ts`) with the notification's fields, then deletes the row.

---

#### `deleteAllRead` (mutation)

Deletes up to 100 read notifications per call.

```typescript
deleteAllRead(): Promise<{
  count: number;    // deleted in this call, at most 100
  hasMore: boolean; // true when read ones remain: call again
}>
```

**Authentication:** `getCurrentUserId()`. No rate limit.

**Side effects:** one change-log entry per call (`logDelete`, keyed to the first row, with `batchDelete: true`, the count and the deleted ids), then the rows are deleted.

---

#### `createNotification` (internal mutation)

Creates a notification from server code.

```typescript
// Internal: called with ctx.runMutation(internal.notifications.createNotification, ...)
createNotification(args: {
  userId: Id<"users">;
  caseId?: Id<"cases">;
  type: NotificationType;
  title: string;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
  deadlineDate?: string;
  deadlineType?: string;
  daysUntilDeadline?: number;
}): Promise<Id<"notifications"> | null>
```

**Notification types:**
```typescript
type NotificationType =
  | "deadline_reminder"
  | "status_change"
  | "rfe_alert"
  | "rfi_alert"
  | "system"
  | "auto_closure";
```

**Returns:** the new id, or `null` when `caseId` names the account's sample case (`isSample`), which never notifies anyone.

**Writes:** `isRead: false`, `emailSent: false`, `createdAt` and `updatedAt` set to now.

**Called from:** `convex/cases.ts` (create, update, bulk status change) and `convex/deadlineDigest.ts`. Deadline enforcement (`convex/deadlineEnforcement.ts`) inserts its notifications directly.

---

#### `cleanupCaseNotifications` (internal mutation)

Deletes up to 100 of a case's notifications per call.

```typescript
// Internal
cleanupCaseNotifications(args: {
  caseId: Id<"cases">;
}): Promise<{ count: number; hasMore: boolean }>
```

**Index:** `by_case_id`.

**Called from:** `cases.remove`, `cases.bulkRemove` and `cases.importCases` (when an import replaces a case).

---

#### `markEmailSent` (internal mutation)

Records that a notification's email went out.

```typescript
// Internal
markEmailSent(args: {
  notificationId: Id<"notifications">;
}): Promise<void>
```

**Writes:** `emailSent: true`, `emailSentAt` and `updatedAt` set to now.

**Called from:** the email helper in `convex/notificationActions.ts`, after `sendOrQueue` returns without an error.

---

#### Other internal functions

- `isNotificationValid` (internal query), `{ notificationId }` to `boolean`: true when the notification exists and its user exists, isn't soft-deleted and has a verified email. The email helper in `notificationActions.ts` skips the send when it's false.
- `isUserActiveByEmail` (internal query), `{ email }` to `boolean`: the same user check, finding the user by the `users` table's `email` index. Used by the weekly digest, the re-engagement nudge and the deadline digest emails.
- `isOwnVerifiedEmail` (internal query), `{ userId, email }` to `boolean`: true only when `email` belongs to that user, the user isn't deleted and the address is verified. It gates `notificationActions.sendTestEmail`.
- `unsubscribeWeeklyByEmail` (internal mutation), `{ email }` to `{ ok: boolean }`: the one-click weekly digest unsubscribe. It sets `emailWeeklyDigest: false` and clears `weeklyDigestSuppressedAt` on the user's profile. Deadline reminders stay on. Returns `{ ok: false }` when there's no live user or profile. Called from the `/unsubscribe` route in `convex/http.ts` and from `convex/emailPrefs.ts`.

---

### dashboard.ts

The dashboard's three queries: deadlines by urgency, case counts by stage, and the cases changed most recently.

**Module Location:** `convex/dashboard.ts`

All three read the caller with `getCurrentUserIdOrNull()` and return empty data when nobody is signed in.

---

#### `getDeadlines` (query)

Every active deadline on the caller's open cases, grouped by urgency.

```typescript
getDeadlines(): Promise<{
  overdue: DeadlineItem[];
  thisWeek: DeadlineItem[];
  thisMonth: DeadlineItem[];
  later: DeadlineItem[];
}>
```

**Returns:**
```typescript
// convex/lib/dashboardTypes.ts (built only by createDeadlineItem)
interface DeadlineItem {
  caseId: Id<"cases">;
  caseNumber?: string;
  employerName: string;
  beneficiaryName: string;   // the case's beneficiaryIdentifier, or ""
  positionTitle: string;
  type: DeadlineType;
  label: string;             // readable label from the central rules
  dueDate: string;           // ISO date (YYYY-MM-DD)
  daysUntil: number;         // negative when overdue
  urgency: "overdue" | "thisWeek" | "thisMonth" | "later";
  caseStatus: CaseStatus;
  progressStatus: ProgressStatus;
}
```

**Urgency groups** (`calculateUrgency` in `convex/lib/dashboardHelpers.ts`):
| Group | Criteria |
|-------|----------|
| `overdue` | `daysUntil < 0` |
| `thisWeek` | `0 <= daysUntil <= 7` |
| `thisMonth` | `8 <= daysUntil <= 30` |
| `later` | `daysUntil > 30` |

Each group is sorted by `daysUntil`, soonest first.

**Deadline types:** the central rules (`extractActiveDeadlines` in `convex/lib/perm/deadlines`) decide which deadlines apply and their dates. The dashboard then renames four of them:
- `filing_window_closes` becomes `recruitment_window`
- `rfi_due` becomes `rfi_response`, and `rfe_due` becomes `rfe_response`
- `i140_filing_deadline` becomes `eta9089_expiration` when it's under 30 days away, and `i140_filing_window` otherwise

The rest keep their central names: `pwd_expiration`, `filing_window_opens`, `recruitment_window_closes`, `job_order_start_deadline`, `notice_of_filing_start_deadline`, `first_sunday_ad_deadline`, `second_sunday_ad_deadline`, `denial_review_due` and `balca_request_due`.

**Notes:**
- Cases come from `readUserCases` (`convex/lib/userCases.ts`): live cases only, at most `USER_CASES_MAX` (5,000). Closed cases are left out.
- The sample case's passed deadlines are left out, and its coming ones show.
- "Today" is `dateToISODate(new Date())`, the calendar date of the server's clock.
- A case whose deadlines fail to extract is logged and skipped, so one bad case doesn't fail the query.

---

#### `getSummary` (query)

Case counts by stage, with a short breakdown and a progress figure for each dashboard card.

```typescript
getSummary(): Promise<{
  pwd: { count: number; subtext: string; progress: number };
  recruitment: { count: number; subtext: string; progress: number };
  eta9089: { count: number; subtext: string; progress: number };
  i140: { count: number; subtext: string; progress: number };
  i485: { count: number; subtext: string; progress: number };
  consular: { count: number; subtext: string; progress: number };
  complete: { count: number; subtext: string; progress: number };
  closed: { count: number; subtext: string; progress: number };
  duplicates: { count: number; subtext: string; progress: number };
}>
```

**Categories:**

| Category | Counts cases where | Subtext | `progress` |
|----------|-------------------|---------|-----------|
| `pwd` | `caseStatus` is `pwd` | "N working, N filed" | % filed |
| `recruitment` | `caseStatus` is `recruitment` | "N ready to start, N in progress" | % in progress |
| `eta9089` | `caseStatus` is `eta9089` | "N prep, N RFI, N filed" | % filed |
| `i140` | `caseStatus` is `i140` and `progressStatus` isn't `approved` | "N prep, N RFE, N filed" | % filed |
| `complete` | `caseStatus` is `i140` and `progressStatus` is `approved` | "I-140 Approved" | 100 |
| `closed` | `caseStatus` is `closed` | "Archived" | 100 |
| `duplicates` | `duplicateOf` is set, at any stage | "Marked as duplicate" | 0 |

How each `progressStatus` counts in the subtexts:
- "working" (PWD) and "prep" (ETA 9089, I-140) count `working`, `waiting_intake` and `under_review`.
- "ready to start" (recruitment) counts `working` and `waiting_intake`.
- "in progress" (recruitment) counts `filed`, `approved` and `under_review`.
- "filed" counts `filed` and `approved` for PWD and ETA 9089, and `filed` alone for I-140.
- "RFI" (ETA 9089) and "RFE" (I-140) count `rfi_rfe`.

A part with a zero count is left out of the subtext. An empty subtext falls back to "0 working", "0 ready to start" or "0 prep". Percentages are rounded whole numbers, 0 when the stage has no cases.

**Authentication:** when signed out each category is `{ count: 0, subtext: "" }`, without a `progress` field.

**Notes:** one pass over `readUserCases` (live cases, at most 5,000).

---

#### `getRecentActivity` (query)

The five cases changed most recently.

```typescript
getRecentActivity(): Promise<RecentActivityItem[]>
```

**Returns:**
```typescript
interface RecentActivityItem {
  id: Id<"cases">;
  caseNumber?: string;
  employerName: string;
  beneficiaryIdentifier: string;  // "" when unset
  positionTitle: string;
  action: string;                 // always "Updated"
  timestamp: number;              // updatedAt, or _creationTime
  caseStatus: CaseStatus;
  progressStatus: ProgressStatus;
  liveStatus?: string;            // DOL's status from the automatic watch, when held
}
```

**Authentication:** returns `[]` when signed out.

**Index:** `by_user_and_updated_at`, newest first. It reads 20 rows, drops deleted cases and keeps the first `RECENT_ACTIVITY_SHOWN` (5).

---

### calendar.ts

The calendar page's data: the caller's cases with every deadline-relevant field, and the calendar's visibility settings.

**Module Location:** `convex/calendar.ts`

---

#### `getCalendarEvents` (query)

The caller's cases, with the fields the calendar draws its events from.

```typescript
getCalendarEvents(args?: {
  showCompleted?: boolean;
  showClosed?: boolean;
}): Promise<CalendarEventData[]>
```

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `showCompleted` | `boolean` | No | `false` | Include cases at I-140 with `progressStatus: "approved"` |
| `showClosed` | `boolean` | No | `false` | Include closed cases |

**Returns:** one row per case (`calendarCaseRow` in `convex/lib/caseDates.ts`):
```typescript
interface CalendarEventData {
  id: Id<"cases">;
  employerName: string;
  beneficiaryIdentifier: string;  // "" when unset
  positionTitle: string;
  caseStatus: "pwd" | "recruitment" | "eta9089" | "i140" | "i485" | "consular" | "complete" | "closed";
  progressStatus: "working" | "waiting_intake" | "filed" | "approved" | "under_review" | "rfi_rfe";

  // PWD
  pwdFilingDate?: string;
  pwdDeterminationDate?: string;
  pwdExpirationDate?: string;
  // Recruitment
  jobOrderStartDate?: string;
  jobOrderEndDate?: string;
  sundayAdFirstDate?: string;
  sundayAdSecondDate?: string;
  additionalRecruitmentStartDate?: string;
  additionalRecruitmentEndDate?: string;
  noticeOfFilingStartDate?: string;
  noticeOfFilingEndDate?: string;
  // ETA 9089, and a denial with the review that follows it
  eta9089FilingDate?: string;
  eta9089AuditDate?: string;
  eta9089CertificationDate?: string;
  eta9089ExpirationDate?: string;
  eta9089DenialDate?: string;
  eta9089ReconsiderationDate?: string;
  eta9089ReconsiderationDeniedDate?: string;
  eta9089BalcaRequestDate?: string;
  // I-140
  i140FilingDate?: string;
  i140ReceiptDate?: string;
  i140ApprovalDate?: string;
  i140DenialDate?: string;
  // What the deadline rules need besides the dates
  isProfessionalOccupation?: boolean;
  additionalRecruitmentMethods?: Array<{ method: string; date: string; description?: string }>;
  filingWindowOpens?: string;        // stored on save
  filingWindowCloses?: string;       // stored on save
  recruitmentWindowCloses?: string;  // stored on save

  // RFI/RFE entries, [] when none
  rfiEntries: Array<{
    id: string;
    title?: string;
    description?: string;
    notes?: string;
    receivedDate: string;
    responseDueDate: string;
    responseSubmittedDate?: string;
    createdAt: number;
  }>;
  rfeEntries: Array<{ /* same shape as rfiEntries */ }>;
}
```

**Authentication:** returns `[]` when signed out.

**Notes:**
- Cases come from `readUserCases`: live cases only, at most 5,000.
- The query returns case data. The browser builds the calendar's events from it.
- Dates are ISO strings (YYYY-MM-DD).

---

#### `getCalendarPreferences` (query)

The caller's calendar settings.

```typescript
getCalendarPreferences(): Promise<{
  hiddenCases: Id<"cases">[];      // profile.calendarHiddenCases
  hiddenDeadlineTypes: string[];   // profile.calendarHiddenDeadlineTypes
  showCompleted: boolean;          // profile.calendarShowCompleted
  showClosed: boolean;             // profile.calendarShowClosed
}>
```

**Returns:** the values on the caller's `userProfiles` row. With no profile, or when signed out, every list is `[]` and both switches are `false`.

**Index:** `userProfiles.by_user_id`, then the row must have no `deletedAt`.

---

#### `updateCalendarPreferences` (mutation)

Saves the calendar settings that are passed and keeps the rest.

```typescript
updateCalendarPreferences(args?: {
  hiddenCases?: Id<"cases">[];
  hiddenDeadlineTypes?: string[];
  showCompleted?: boolean;
  showClosed?: boolean;
}): Promise<Id<"userProfiles">>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `hiddenCases` | `Id<"cases">[]` | No | Cases hidden from the calendar (the whole list) |
| `hiddenDeadlineTypes` | `string[]` | No | Event types hidden from the calendar (the whole list) |
| `showCompleted` | `boolean` | No | Show I-140 approved cases |
| `showClosed` | `boolean` | No | Show closed cases |

**Returns:** the profile's id.

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Behaviour:**
- A list replaces the stored list. An argument left out keeps its stored value, and `updatedAt` is set to now.
- With no live profile, it inserts one from `buildDefaultProfile` (`convex/lib/userDefaults.ts`) with the values passed.

**Event type values:** the server takes any strings. The calendar page stores its own event types from `src/lib/calendar/types.ts` (`DeadlineType`), such as `pwdExpires`, `filingWindowCloses`, `rfiDue` and `balcaRequestDue`.

**Example:**
```typescript
const updateCalendarPreferences = useMutation(api.calendar.updateCalendarPreferences);

// Hide one case
await updateCalendarPreferences({
  hiddenCases: [...(preferences?.hiddenCases ?? []), caseId],
});

// Show everything again
await updateCalendarPreferences({ hiddenCases: [], hiddenDeadlineTypes: [] });
```

---

### timeline.ts

The timeline page: its time range, and which cases it shows.

**Module Location:** `convex/timeline.ts`

Whether a case is on the timeline is the case's own switch, `cases.showOnTimeline` (`convex/lib/timelineShow.ts`). An unset switch follows the case: on while it's open, off once it's closed. Set either way, it holds whatever the case's status. The list of case ids once kept in `timelinePreferences.selectedCaseIds` is no longer read.

---

#### `getPreferences` (query)

The caller's timeline range.

```typescript
getPreferences(): Promise<{
  selectedCaseIds: null;
  timeRange: 3 | 6 | 12 | 24;
}>
```

**Returns:** `timeRange` from the caller's `timelinePreferences` row, or `12` when there's none or nobody is signed in. `selectedCaseIds` is always `null`. It stays in the answer for pages that read `null` as "every open case".

**Index:** `timelinePreferences.by_user_id`.

---

#### `getCasesForTimeline` (query)

The caller's cases that are on the timeline, with their dates.

```typescript
getCasesForTimeline(args?: {
  timeRange?: 3 | 6 | 12 | 24;
}): Promise<TimelineCaseData[]>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timeRange` | `3 \| 6 \| 12 \| 24` | No | Accepted and not read: the query returns the same cases for every range |

**Returns:**
```typescript
interface TimelineCaseData {
  id: Id<"cases">;
  employerName: string;
  positionTitle: string;
  caseStatus: CaseStatus;
  progressStatus: ProgressStatus;
  // Every field of CalendarEventData's dates block above (caseDeadlineDates in convex/lib/caseDates.ts):
  // the PWD, recruitment, ETA 9089 (denial and review included) and I-140 dates, isProfessionalOccupation,
  // additionalRecruitmentMethods and the three stored windows.
  rfiEntries: TimelineRfiRfeEntry[];  // [] when none; same shape as the calendar's
  rfeEntries: TimelineRfiRfeEntry[];
}
```

**Authentication:** returns `[]` when signed out.

**Notes:** cases come from `readUserCases` (live cases, at most 5,000), kept when `onTimeline(case)` is true.

---

#### `updatePreferences` (mutation)

Saves the time range, and sets which cases the timeline shows.

```typescript
updatePreferences(args?: {
  selectedCaseIds?: Id<"cases">[] | null;
  timeRange?: 3 | 6 | 12 | 24;
}): Promise<Id<"timelinePreferences">>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selectedCaseIds` | `Id<"cases">[] \| null` | No | A list sets each case's switch: the cases listed are on and every other case is off, an empty list included. `null` clears every case's switch, so each follows its status again. |
| `timeRange` | `3 \| 6 \| 12 \| 24` | No | Months to show |

**Returns:** the `timelinePreferences` row's id.

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Behaviour:**
- With `selectedCaseIds`, it patches the `showOnTimeline` of each of the caller's live cases whose place on the timeline changes. A switch that would match what the case's status already gives is left unset.
- It updates the existing preferences row (`updatedAt`, `timeRange` if passed, and clears a stored `selectedCaseIds` list when `selectedCaseIds` is passed), or inserts one with `timeRange` defaulting to 12.

**Example:**
```typescript
const updatePreferences = useMutation(api.timeline.updatePreferences);

await updatePreferences({ timeRange: 6 });
await updatePreferences({ selectedCaseIds: [case1Id, case2Id] });
await updatePreferences({ selectedCaseIds: null }); // every case follows its status
```

---

#### `addCaseToTimeline` (mutation)

Puts one case on the timeline (the case page's menu).

```typescript
addCaseToTimeline(args: {
  caseId: Id<"cases">;
}): Promise<null>
```

**Returns:** `null`

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Throws:** `"Case not found"` when the case doesn't exist, is deleted or belongs to someone else.

**Writes:** the case's `showOnTimeline`, only when the case isn't on the timeline already. A closed case gets `true`. An open case's switch is cleared, since following its status already puts it on.

---

#### `removeCaseFromTimeline` (mutation)

Takes one case off the timeline (the case page's menu).

```typescript
removeCaseFromTimeline(args: {
  caseId: Id<"cases">;
}): Promise<null>
```

**Returns:** `null`

**Authentication and errors:** as `addCaseToTimeline`.

**Writes:** the case's `showOnTimeline`, only when the case is on the timeline now. An open case gets `false`. A closed case's switch is cleared, since following its status already takes it off.

---

### users.ts

The signed-in account: its user record, its profile and preferences, push subscription, the chat's action mode, analytics switches and account deletion.

**Module Location:** `convex/users.ts`

---

#### `currentUser` (query)

Get the signed-in user's document from the `users` table.

```typescript
currentUser(): Promise<Doc<"users"> | null>
```

**Returns:** the user document, or `null` when nobody is signed in (or the record is gone).

**Authentication:** `getCurrentUserIdOrNull()`, so it returns `null` instead of throwing.

**Example:**
```typescript
const user = useQuery(api.users.currentUser);
```

---

#### `isAdmin` (query)

Whether the signed-in user is the site's admin.

```typescript
isAdmin(): Promise<{ isAdmin: boolean }>
```

**Returns:** `{ isAdmin: true }` only when the user's email equals the `ADMIN_EMAIL` environment variable. It's `{ isAdmin: false }` when nobody is signed in or the variable isn't set. The address itself never reaches the browser.

**Authentication:** `getCurrentUserIdOrNull()`.

---

#### `isPostHogExcluded` (query)

Whether the browser should send PostHog nothing for this account.

```typescript
isPostHogExcluded(): Promise<boolean>
```

**Returns:** `true` when the user's email matches `POSTHOG_EXCLUDED_EMAILS` (a comma-separated list, where an entry starting with `@` matches a whole domain) or the profile has `analyticsOff: true`. `false` when nobody is signed in.

**Authentication:** `getCurrentUserIdOrNull()`.

---

#### `setAnalyticsOff` (mutation)

Switch usage analytics off or back on for the account. It's stored on the profile, so it follows the account to every browser.

```typescript
setAnalyticsOff(args: { off: boolean }): Promise<null>
```

**Returns:** `null`. Creates the profile with the defaults (see `ensureUserProfile`) when there isn't one yet.

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

---

#### `setCountCaseDates` (mutation)

Settings' switch for counting this account's case dates in the site's public figures.

```typescript
setCountCaseDates(args: { on: boolean }): Promise<null>
```

**Returns:** `null`. Writes `countCaseDates` and `countCaseDatesAt` (now) on the profile, creating the profile with the defaults when there isn't one.

**Authentication:** `getCurrentUserId()`.

**Notes:** Off unless switched on. The hourly merge reads it through `caseFigures.exportForMerge`, so a change reaches the figures within the hour.

---

#### `currentUserProfile` (query)

Get the signed-in user's `userProfiles` document: notification, calendar, display and enforcement settings.

```typescript
currentUserProfile(): Promise<Doc<"userProfiles"> | null>
```

**Returns:** the profile, or `null` when nobody is signed in or no profile exists. Reads the `by_user_id` index.

**Authentication:** `getCurrentUserIdOrNull()`.

**Example:**
```typescript
const profile = useQuery(api.users.currentUserProfile);
const emailEnabled = profile?.emailNotificationsEnabled ?? true;
const timezone = profile?.timezone ?? "America/New_York";
```

---

#### `ensureUserProfile` (mutation)

Make sure the signed-in user has a profile. Safe to call again: an existing profile is returned as it is.

```typescript
ensureUserProfile(): Promise<Id<"userProfiles"> | null>
```

**Returns:** the existing or new profile's id, or `null` when the user record is gone or scheduled for deletion. That `null` stops a session that outlives a deleted account from building an orphan profile.

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Behavior:** a new profile comes from `buildDefaultProfile` (`convex/lib/userDefaults.ts`), with the name and photo copied from the `users` record. Among its defaults:

```typescript
{
  userType: "individual",
  emailNotificationsEnabled: true,
  smsNotificationsEnabled: false,
  pushNotificationsEnabled: false,
  urgentDeadlineDays: 7,
  reminderDaysBefore: [1, 3, 7, 14, 30],
  emailDeadlineReminders: true,
  emailStatusUpdates: false,
  emailRfeAlerts: true,
  emailWeeklyDigest: true,
  quietHoursEnabled: false,
  timezone: "America/New_York",
  calendarSyncEnabled: true,   // and every calendarSync* type on
  googleCalendarConnected: false,
  casesSortBy: "updatedAt",
  casesSortOrder: "desc",
  casesPerPage: 20,
  darkModeEnabled: false,
  autoDeadlineEnforcementEnabled: false,
  termsVersion: TERMS_VERSION,
  // ... timestamps and counters
}
```

**Notes:** no welcome email is sent here. That goes from `recordMyLogin`, on the first verified sign-in.

---

#### `recordMyLogin` (mutation)

Record a sign-in for the signed-in user. `LoginTracker` (`src/components/auth/LoginTracker.tsx`) calls it on every sign-in, because Convex Auth's `createOrUpdateUser` callback doesn't run for a password sign-in to an existing account.

```typescript
recordMyLogin(args: {
  analyticsOff?: boolean;  // the signing-in browser has analytics off (its own switch or Global Privacy Control)
}): Promise<void>
```

**Authentication:** `getCurrentUserIdOrNull()`. Does nothing when nobody is signed in or there's no profile.

**Side effects:**
1. Adds one to `loginCount`, sets `lastLoginAt` and `lastActiveAt`, and clears `reengagementNudgeSentAt`. A paused weekly digest stays paused.
2. On the first verified sign-in only (`postSignupEmailsSent` not yet set), it sets that flag and schedules the welcome email (`welcomeEmail.sendWelcomeEmail`).
3. On that same sign-in it charges the global `signupBurst` limit (20 an hour). When that trips, the admin gets at most one "Signup spike" email an hour (`signupAlarmEmail`).
4. It then schedules a server-side `signup_verified` PostHog event, unless the profile or the browser has analytics off.

Failures in steps 2 to 4 are recorded with `recordError` and never block the sign-in.

---

#### `recordActivity` (mutation)

Set `lastActiveAt` to now on the signed-in user's profile. `InactivityTimeoutProvider` calls it on mount and then every 5 minutes while the app is open, for server-side inactivity checks.

```typescript
recordActivity(): Promise<void>
```

**Authentication:** `getCurrentUserIdOrNull()`. Does nothing when nobody is signed in or there's no profile.

---

#### `updateUserProfile` (mutation)

Update the signed-in user's profile. Every argument is optional, and only the ones sent are written.

```typescript
updateUserProfile(args: {
  // Profile
  fullName?: string;          // at most 500 characters
  jobTitle?: string;          // at most 500 characters
  company?: string;           // at most 500 characters
  profilePhotoUrl?: string;
  // Notification settings
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  pushNotificationsEnabled?: boolean;
  urgentDeadlineDays?: number;
  reminderDaysBefore?: number[];
  // Email preferences
  emailDeadlineReminders?: boolean;
  emailDeadlineReminderPwd?: boolean;
  emailDeadlineReminderRecruitment?: boolean;
  emailDeadlineReminderEta9089?: boolean;
  emailDeadlineReminderI140?: boolean;
  emailDeadlineReminderRfi?: boolean;
  emailDeadlineReminderRfe?: boolean;
  emailStatusUpdates?: boolean;
  emailRfeAlerts?: boolean;
  emailWeeklyDigest?: boolean;
  watchSavedCases?: boolean;  // the DOL live-status watch on saved cases
  // Quiet hours
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;   // HH:MM
  quietHoursEnd?: string;     // HH:MM
  timezone?: string;
  // Calendar sync
  calendarSyncEnabled?: boolean;
  calendarSyncPwd?: boolean;
  calendarSyncEta9089?: boolean;
  calendarSyncI140?: boolean;
  calendarSyncRfe?: boolean;
  calendarSyncRfi?: boolean;
  calendarSyncRecruitment?: boolean;
  calendarSyncFilingWindow?: boolean;
  // Google (tokens are encrypted before they're stored)
  googleEmail?: string;
  googleRefreshToken?: string;
  googleAccessToken?: string;
  googleTokenExpiry?: number;
  googleScopes?: string[];
  googleCalendarConnected?: boolean;
  gmailConnected?: boolean;
  // UI preferences
  casesSortBy?: string;
  casesSortOrder?: "asc" | "desc";
  casesPerPage?: number;
  dismissedDeadlines?: Array<{ caseId: Id<"cases">; deadlineType: string; dismissedAt: number }>;
  darkModeEnabled?: boolean;
  // Deadline enforcement
  autoDeadlineEnforcementEnabled?: boolean;
}): Promise<Id<"userProfiles">>
```

**Returns:** the profile's id.

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Behavior:**
1. `fullName`, `company` and `jobTitle` are checked against `INPUT_LIMITS.SHORT` (500 characters) and refused when longer.
2. With no profile yet, it creates one from the defaults first, so it never fails for a missing profile.
3. `googleAccessToken` and `googleRefreshToken` are encrypted with `encryptToken` (AES-256-GCM, `docs/CRYPTO.md`); an empty string clears the stored token.
4. `emailWeeklyDigest: true` also clears `weeklyDigestSuppressedAt` and `reengagementNudgeSentAt`, so the weekly cron can't pause a digest the user just turned on.
5. The change is written to the change log (`logUpdate`).
6. A calendar type switched from on to off schedules `googleCalendarActions.bulkDeleteEventsByType`, which takes that type's events off Google Calendar.

**Example:**
```typescript
const updateUserProfile = useMutation(api.users.updateUserProfile);

await updateUserProfile({
  emailNotificationsEnabled: true,
  urgentDeadlineDays: 7,
  timezone: "America/Los_Angeles",
  quietHoursEnabled: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
});
```

---

#### `savePushSubscription` (mutation)

Save the browser's push subscription and turn push notifications on.

```typescript
savePushSubscription(args: {
  subscription: string;  // JSON.stringify(PushSubscription)
}): Promise<{ success: true }>
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subscription` | `string` | Yes | The browser's PushSubscription as JSON |

**Returns:** `{ success: true }`

**Authentication:** `getCurrentUserId()`. Rate limited per user by `pushSubscriptionSave` (a token bucket of 10 a minute, capacity 3).

**Throws:**
- `"User profile not found"` when the profile doesn't exist.
- `"Invalid push subscription format: not valid JSON"`.
- `"Invalid push subscription: missing required fields (endpoint, keys.p256dh, keys.auth)"`.
- `"Invalid push subscription: the endpoint isn't a browser push service"` when the endpoint isn't on a known push host (`convex/lib/pushHosts.ts`).

**Side effects:** sets `pushSubscription` and `pushNotificationsEnabled: true`, and writes the change log.

**Example:**
```typescript
const savePushSubscription = useMutation(api.users.savePushSubscription);

const registration = await navigator.serviceWorker.ready;
const subscription = await registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: VAPID_PUBLIC_KEY,
});
await savePushSubscription({ subscription: JSON.stringify(subscription) });
```

---

#### `removePushSubscription` (mutation)

Clear the push subscription and turn push notifications off.

```typescript
removePushSubscription(): Promise<{ success: true }>
```

**Returns:** `{ success: true }`

**Authentication:** `getCurrentUserId()`.

**Throws:** `"User profile not found"`.

**Side effects:** clears `pushSubscription`, sets `pushNotificationsEnabled: false`, and writes the change log.

---

#### `getActionMode` (query)

How the chat may act on the account's cases.

```typescript
type ActionMode = "off" | "confirm" | "auto";
getActionMode(): Promise<ActionMode>
```

**Returns:** the profile's `actionMode`, or `"confirm"` when nobody is signed in, there's no profile or it was never set. `"off"` means the chat only answers, `"confirm"` means it proposes an action and waits for a yes, and `"auto"` means it acts without asking.

**Authentication:** `getCurrentUserIdOrNull()`. The chat route (`src/app/api/chat/route.ts`) reads it with the user's token.

---

#### `updateActionMode` (mutation)

Set the chat's action mode.

```typescript
updateActionMode(args: {
  actionMode: "off" | "confirm" | "auto";
}): Promise<{ success: true; actionMode: ActionMode }>
```

**Authentication:** `getCurrentUserId()`.

**Throws:** `"User profile not found. Please ensure your profile exists."`

**Side effects:** writes the change log.

---

#### `requestAccountDeletion` (mutation)

Schedule the account's deletion 30 days from now.

```typescript
requestAccountDeletion(): Promise<{
  success: true;
  deletionDate: number;   // epoch ms, 30 days from now
  message: string;
}>
```

**Authentication:** `getCurrentUserId()`.

**Throws:** `"User profile not found"`.

**Side effects:**
1. Schedules `accountDeletion.cleanupAndPurge` to run at the deletion date and keeps its id in `scheduledDeletionJobId`.
2. Sets `deletedAt` to the deletion date on both the profile and the `users` record.
3. Writes the change log.
4. Schedules `notificationActions.sendAccountDeletionEmail` with the date, when the user has an email.

---

#### `cancelAccountDeletion` (mutation)

Cancel a scheduled deletion inside its 30 days.

```typescript
cancelAccountDeletion(): Promise<{ success: true }>
```

**Authentication:** `getCurrentUserId()`.

**Throws:**
- `"User profile not found"`.
- `"No deletion scheduled for this account"`.
- `"Grace period has expired. Account deletion cannot be cancelled."`

**Side effects:** cancels the scheduled job, clears `deletedAt` and `scheduledDeletionJobId` on the profile and `deletedAt` on the user, and writes the change log.

---

#### `immediateAccountDeletion` (action)

Delete an account now, for a user who has already scheduled deletion.

```typescript
immediateAccountDeletion(): Promise<{ success: boolean; message: string }>
```

**Authentication:** reads `ctx.auth.getUserIdentity()` and throws `"Not authenticated"` without one.

**Behavior:** runs `prepareImmediateDeletion` (below), sends the deletion email with `immediate: true` (a failed email is recorded and doesn't stop the deletion), then runs `accountDeletion.cleanupAndPurge`, which removes the account's data and its calendar events and Resend contact. Returns `{ success: true, message: "Account permanently deleted" }`.

**Throws:** whatever `prepareImmediateDeletion` throws: no profile, no deletion scheduled, or a grace period that already ran out.

---

Internal functions in this module:

- `ensureUserProfileInternal` (internal mutation): the same profile check for a given `userId`, for the auth callback, which has no signed-in context. It writes a change log entry for a new profile.
- `prepareImmediateDeletion` (internal mutation): checks a deletion is scheduled and still inside its 30 days, cancels the scheduled job, sets `deletedAt` a second in the past on the user and profile, and returns `{ email, userName }` for the email.
- `purgeOrphanProfiles` (internal mutation): deletes profiles whose user record no longer exists. It's a dry run unless `apply: true`, and returns `{ applied, orphans }`. Run by hand.

---

### Change log (lib/audit.ts and caseRestore.ts)

Every create, update and delete of a case and of a few other tables writes a row to the `auditLogs` table. No public query lists the change log any more: `convex/auditLogs.ts` (`listMine`, `forDocument`, `byDateRange`) was removed in February 2026 because nothing used it. What's left is the write helpers, the account's own data export, and restoring a deleted case.

**Write helpers:** `convex/lib/audit.ts`

```typescript
logCreate(ctx, tableName, documentId, newDoc, metadata?, userId?): Promise<void>
logUpdate(ctx, tableName, documentId, oldDoc, newDoc, metadata?, userId?): Promise<void>
logDelete(ctx, tableName, documentId, oldDoc, metadata?, userId?): Promise<void>
// all three call logAudit(ctx, { tableName, documentId, action, oldDoc?, newDoc?, metadata?, userId? })
```

Each row records the user (`userId` when given, otherwise `getCurrentUserId()`), the table, the document id as a string, the action (`"create"`, `"update"` or `"delete"`), the field changes, optional `metadata` (`ipAddress`, `userAgent`, `source`) and a `timestamp`. A create lists every field's new value, a delete every field's old value, and an update only the fields that changed. Values are stored as JSON strings, and Convex's own `_` fields are skipped. Sensitive fields are written as `[REDACTED]` (or `[EMPTY]` when unset): the Google tokens, `token`, `password`, `passwordHash`, `secret`, `apiKey`, `employerFein`, `ssn`, `socialSecurityNumber`, `sessionToken`, `refreshToken` and `accessToken`. A failure to write the row is logged and recorded with `recordError`, and the change it describes still goes through.

The table's indexes are `by_user_id`, `by_table_name`, `by_document_id`, `by_timestamp`, `by_user_and_table`, `by_user_and_timestamp`, `by_user_table_action_restored_and_timestamp` (an account's unrestored case deletions, for "Recently deleted") and `by_table_action_erased_and_timestamp` (the retention run's erasure). `dataExport.getFullAccountData` returns the account's rows through `by_user_id`.

Deleting a case erases its row from `cases`, and its deletion row keeps a copy of every field for 30 days (`DELETED_CASE_DAYS` in `convex/lib/deletedCases.ts`). After that, `retention.eraseDeletedCaseCopies` erases the copy and the case's other change history, and keeps the deletion row itself (who deleted which case, and when).

**Module Location:** `convex/caseRestore.ts`

---

#### `listRecentlyDeleted` (query)

The account's deleted cases that can still be restored, newest first. Settings shows it under "Recently deleted".

```typescript
listRecentlyDeleted(args: {
  now: number;  // epoch ms; the window is the 30 days before it
}): Promise<{
  cases: Array<{
    auditLogId: Id<"auditLogs">;
    employerName: string;
    positionTitle: string;
    beneficiaryIdentifier: string | null;
    deletedAt: number;
    restoreBy: number;   // deletedAt + 30 days
  }>;
  more: boolean;         // more deletions than the list holds
}>
```

**Authentication:** `getCurrentUserIdOrNull()`. It returns `{ cases: [], more: false }` when nobody is signed in.

**Notes:** reads `by_user_table_action_restored_and_timestamp`, so restored cases are left out. It lists at most 100 (`RECENTLY_DELETED_MAX`) and skips copies already erased.

---

#### `restoreDeleted` (mutation)

Bring back one deleted case from its copy, once, inside the 30 days.

```typescript
restoreDeleted(args: { auditLogId: Id<"auditLogs"> }): Promise<Id<"cases">>
```

**Returns:** the new case's id.

**Authentication:** `getCurrentUserId()`. Rate limited per user by `caseCreate` (60 a minute, capacity 30).

**Throws (`ConvexError`):**
- `"That deleted case isn't in your account."` for a row that isn't one of the account's case deletions.
- `"That case was restored already. You'll find it in your cases."`
- `"That case was deleted more than 30 days ago, so it can't be restored."`

**Behavior:** stores the copy again as a new case by `create`'s rules (`planCaseCreate` and `insertCaseByCreateRules` in `cases.ts`), so its derived dates, stage and calendar are worked out again. It never refuses on validation. A closed case keeps its stage and closure. The uploaded files, the recruitment log and the employer's FEIN don't come back (the change log never stores the FEIN), and a link to a case or template that's gone is dropped. The deletion row gets `restoredAt` and `restoredCaseId`.

---

- `fromDeletedCopy` (internal mutation): a support tool run by hand. It copies chosen fields (only those in `RESTORABLE_FIELDS`) from a deleted case's copy onto a case the owner entered again, filling only fields that are still empty, then recalculates the derived dates and writes the change log. `dryRun: true` reports what it would write.

---

### deadlineEnforcement.ts

Closing cases whose deadlines have run out, and the alerts that tell the user.

**Module Location:** `convex/deadlineEnforcement.ts` (the rules are in `convex/lib/deadlineEnforcementHelpers.ts`)

---

#### `isEnforcementEnabled` (query)

Whether the signed-in user has automatic deadline enforcement on.

```typescript
isEnforcementEnabled(): Promise<boolean>
```

**Returns:** the profile's `autoDeadlineEnforcementEnabled`, or `false` when nobody is signed in or there's no profile.

**Authentication:** `getCurrentUserIdOrNull()`.

**Usage:** the dashboard (`DashboardPageClient.tsx`) calls `checkAndEnforceDeadlines` once on load when this is `true`.

---

#### `getAutoClosureAlerts` (query)

The signed-in user's unread auto-closure notifications, with case details, newest first.

```typescript
getAutoClosureAlerts(): Promise<AutoClosureAlert[]>
```

**Returns:**
```typescript
interface AutoClosureAlert {
  notificationId: Id<"notifications">;
  caseId: Id<"cases"> | null;
  title: string;
  message: string;
  closureReason: string;          // the case's closureReason, else the notification's deadlineType
  employerName: string;           // "Unknown" when the case is gone
  beneficiaryIdentifier: string;
  positionTitle: string;
  createdAt: number;
  isRead: boolean;
}
```

**Authentication:** `getCurrentUserIdOrNull()`. It returns `[]` when nobody is signed in.

**Notes:** reads the `by_user_and_unread` index on `notifications` and keeps the `auto_closure` type.

---

#### `checkAndEnforceDeadlines` (mutation)

Check the signed-in user's open cases and close those whose deadlines have run out.

```typescript
checkAndEnforceDeadlines(): Promise<EnforcementResult>
```

**Returns:**
```typescript
interface EnforcementResult {
  enabled: boolean;        // false when there's no profile or enforcement is off
  casesChecked: number;    // open cases checked
  casesClosed: number;
  closedCases: Array<{
    caseId: string;
    employerName: string;
    beneficiaryIdentifier: string;  // "" when the case has none
    violationType: string;          // "pwd_expired" | "recruitment_window_missed" | ...
    reason: string;
  }>;
}
```

**Authentication:** `getCurrentUserId()`, which throws `"not authenticated"`.

**Which cases:** every case of the user that isn't deleted, closed or the sample case.

**Rules:** `checkDeadlineViolations` checks these in order and stops at the first it finds. Each "today" is the user's or DOL's, by the rule's own timezone.

| Violation type | When it's found | Closes the case when |
|---------------|-----------------|----------------------|
| `pwd_expired` | the PWD expiration date has passed and the ETA 9089 isn't filed (skipped when recruitment began inside the PWD's validity) | always, unless the determination date is unknown, which asks for review |
| `recruitment_window_missed` | the recruitment window (or, without one, the filing window) has closed, the ETA 9089 isn't filed, and recruitment didn't finish by that date | the PWD leaves no time to restart |
| `filing_window_missed` | the filing window has closed and the ETA 9089 isn't filed | the PWD leaves no time to restart |
| `eta9089_expired` | the certification's expiration (stored, or certification + 179 days) has passed and the I-140 isn't filed | there's no way to refile or restart |

Only a violation whose suggested action is `"close"` closes a case. One that suggests a restart or review is left open.

**Side effects, for each closed case:**
1. Sets `caseStatus: "closed"`, `closureReason` (the violation type), `closedAt` and `updatedAt`.
2. Inserts an `auto_closure` notification with priority `urgent`.
3. Schedules `notificationActions.sendAutoClosureEmail` when `shouldSendEmail` allows it and the user has an email (a scheduling failure is recorded and the closure stands).
4. Schedules `pushNotifications.sendPushNotification` when the profile has push on.

**Notes:** the daily `deadline-enforcement` cron does the same for every user at 10:00 UTC (6:00 AM EDT, 5:00 AM EST) through `scheduledJobs.enforceDeadlinesForAllUsers` and `closeCaseAndNotify`. This mutation runs on the dashboard as a same-day fallback.

**Example:**
```typescript
const checkAndEnforce = useMutation(api.deadlineEnforcement.checkAndEnforceDeadlines);
const result = await checkAndEnforce();
if (result.casesClosed > 0) {
  // show the closed cases
}
```

---

#### `dismissAutoClosureAlert` (mutation)

Dismiss one auto-closure alert by marking it read.

```typescript
dismissAutoClosureAlert(args: {
  notificationId: Id<"notifications">;
}): Promise<{ success: true }>
```

**Authentication:** `getCurrentUserId()`.

**Throws:**
- `"Notification not found"`.
- `"Access denied"` when the notification belongs to another user.
- `"Not an auto-closure notification"`.

**Side effects:** sets `isRead: true`, `readAt` and `updatedAt`.

---

#### `dismissAllAutoClosureAlerts` (mutation)

Mark every unread auto-closure alert of the signed-in user read.

```typescript
dismissAllAutoClosureAlerts(): Promise<{
  success: true;
  dismissedCount: number;
}>
```

**Authentication:** `getCurrentUserId()`.

---

- `closeCaseAndNotify` (internal mutation): the cron's per-case step. Takes `{ caseId, userId, title, message, violationType, closedAt }`, closes the case and inserts its `auto_closure` notification, and returns the notification's id for the email. It returns `null` without writing when the case is gone, already closed, deleted or the sample case. It checks no ownership, so callers must.

---

### userCaseOrder.ts

The order a user dragged their cases into on the cases page, kept with the filters and sort that were active when they saved it.

**Module Location:** `convex/userCaseOrder.ts` (table `userCaseOrder`, index `by_user_id`)

---

#### `saveCaseOrder` (mutation)

Save the user's custom case order, replacing any saved before.

```typescript
saveCaseOrder(args: {
  caseIds: Id<"cases">[];   // the cases in the order the user set
  filters: {
    status?: "pwd" | "recruitment" | "eta9089" | "i140" | "i485" | "consular" | "complete" | "closed";
    progressStatus?: "working" | "waiting_intake" | "filed" | "approved" | "under_review" | "rfi_rfe";
    searchQuery?: string;
    favoritesOnly?: boolean;
  };
  baseSortMethod: "deadline" | "updated" | "employer" | "status" | "pwdFiled" | "etaFiled" | "i140Filed";
  baseSortOrder: "asc" | "desc";
}): Promise<Id<"userCaseOrder">>
```

**Returns:** the order document's id. One document per user: an existing one is patched, otherwise a new one is inserted.

**Authentication:** `getAuthUserId()` directly. It throws `"Unauthorized"` when nobody is signed in. Rate limited per user by `userCaseOrderSave` (60 a minute, capacity 20).

**Notes:** `baseSortMethod` and `baseSortOrder` are the sort that was active when the order was saved, so the cases page can place cases added later.

---

#### `getCaseOrder` (query)

Get the signed-in user's saved case order.

```typescript
getCaseOrder(): Promise<Doc<"userCaseOrder"> | null>
```

**Returns:** the document (`caseIds`, `filters`, `baseSortMethod`, `baseSortOrder`, `createdAt`, `updatedAt`), or `null` when nobody is signed in or no order is saved.

**Authentication:** `getAuthUserId()`. It returns `null` when nobody is signed in.

**Example:**
```typescript
const customOrder = useQuery(api.userCaseOrder.getCaseOrder);
const save = useMutation(api.userCaseOrder.saveCaseOrder);
```

---

## Scheduled Jobs

> The jobs below are Convex crons. The federal-data ingests run elsewhere: they're GitHub Actions workflows
> that the server's systemd timers start through `/api/cron/dispatch/<job>` (since the move off Vercel,
> Sep 28 2026), and the USCIS fetches run on the server itself. See `v2/CLAUDE.md`.

Background tasks on the Convex cron scheduler.

**Module location:** `convex/crons.ts` (the schedule), with the handlers in `convex/scheduledJobs.ts` and
`convex/deadlineDigest.ts`.

---

### Cron Configuration

`convex/crons.ts` registers 36 crons in all: 16 `crons.daily`, 11 `crons.cron`, 5 `crons.hourly`,
3 `crons.interval` and 1 `crons.weekly`, counted as the lines that start with one of those calls
(`grep -cE "^crons\.(daily|hourly|weekly|monthly|cron|interval)\(" convex/crons.ts`). The eight below call
functions this reference covers. The other 28 belong to modules outside it (alerts, webhooks, the bulletin,
retention, reviews, the server watch).

Cron times are fixed in UTC, so the Eastern time moves an hour with daylight saving.

| Job | Schedule (as written) | Eastern time | Handler |
|-----|----------------------|--------------|---------|
| `deadline-reminders` | `crons.daily`, 14:00 UTC | 9:00 AM EST, 10:00 AM EDT | `deadlineDigest.runDeadlineReminders` |
| `deadline-enforcement` | `crons.daily`, 10:00 UTC | 5:00 AM EST, 6:00 AM EDT | `scheduledJobs.enforceDeadlinesForAllUsers` |
| `notification-cleanup` | `crons.hourly`, minute 30 | every hour at :30 | `scheduledJobs.cleanupOldNotifications` |
| `weekly-digest` | `crons.weekly`, Monday 15:00 UTC | Monday 10:00 AM EST, 11:00 AM EDT | `scheduledJobs.sendWeeklyDigest` |
| `account-deletion-cleanup` | `crons.hourly`, minute 45 | every hour at :45 | `accountDeletion.processExpiredDeletions` (reads `scheduledJobs.getUsersWithExpiredDeletions`, runs `scheduledJobs.permanentlyDeleteAccount`) |
| `rate-limit-cleanup` | `crons.hourly`, minute 15 | every hour at :15 | `scheduledJobs.cleanupRateLimits` |
| `conversation-ttl-cleanup` | `crons.daily`, 03:00 UTC | 10:00 PM EST, 11:00 PM EDT, the evening before | `scheduledJobs.cleanupExpiredConversations` |
| `reengagement-check` | `crons.daily`, 16:00 UTC | 11:00 AM EST, 12:00 PM EDT | `reengagement.runReengagementCheck` (schedules `notificationActions.sendReengagementNudge`) |

```typescript
// convex/crons.ts (excerpt: the first four jobs)
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "deadline-reminders",
  { hourUTC: 14, minuteUTC: 0 },
  internal.deadlineDigest.runDeadlineReminders
);

crons.daily(
  "deadline-enforcement",
  { hourUTC: 10, minuteUTC: 0 },
  internal.scheduledJobs.enforceDeadlinesForAllUsers
);

crons.hourly(
  "notification-cleanup",
  { minuteUTC: 30 },
  internal.scheduledJobs.cleanupOldNotifications
);

crons.weekly(
  "weekly-digest",
  { dayOfWeek: "monday", hourUTC: 15, minuteUTC: 0 },
  internal.scheduledJobs.sendWeeklyDigest
);

export default crons;
```

---

### `runDeadlineReminders` (internal action)

The daily deadline reminder run, in `convex/deadlineDigest.ts`. It writes one in-app notification per case and
deadline, and sends each account one digest email listing every deadline that reached a reminder day.

```typescript
// Internal: called by the "deadline-reminders" cron
runDeadlineReminders(): Promise<{
  processed: number;        // in-app notifications written
  emailsScheduled: number;  // digest emails scheduled, one per account
}>
```

What it does:
1. Checks that the email blocklist is configured (`assertBlocklistConfigured`). A failure is recorded with
   `recordError` and the run carries on.
2. Reads the day's reminders from `scheduledJobs.getCasesNeedingReminders`.
3. For each reminder, writes a notification through `notifications.createNotification`. An RFI is stored as
   `rfi_alert`, an RFE as `rfe_alert`, and every other deadline as `deadline_reminder`.
4. Collects the reminders the account's email switches allow (`shouldSendEmail`) and, by the push switch and
   quiet hours alone (`shouldSendPush`), schedules a push through `pushNotifications.sendPushNotification`.
5. Groups the emails by account (`groupRemindersByUser`) and schedules `notificationActions.sendDeadlineDigestEmail`
   for each, one second apart.
6. Sends a copy to a case's second reminder recipient (`reminderRecipients.sendCopy`), one email per case, after
   the owners' own emails, for the reminders the owner's switches allow.

Which deadlines count: `extractReminderDeadlines` in `convex/lib/perm/deadlines`, the same active-deadline list the
dashboard and calendar show, without the filing window's opening day.

Reminder days: the account's `reminderDaysBefore`, default `[1, 3, 7, 14, 30]` (`DEFAULT_REMINDER_DAYS`). A
deadline also gets a reminder on its own day, and an overdue one gets a single reminder on the day after it passes.

Repeats: a reminder is skipped when the case already has a `deadline_reminder`, `rfi_alert` or `rfe_alert`
notification for the same deadline type and day count.

The sample case, closed cases, deleted cases and accounts without a verified address get no reminders.

---

### `enforceDeadlinesForAllUsers` (internal action)

The daily auto-closure run. For each account with `autoDeadlineEnforcementEnabled` on, a verified address and no
pending deletion, it checks every live case (the sample case and closed cases left out) with
`checkDeadlineViolations` and closes the ones whose suggested action is "close".

```typescript
// Internal: called by the "deadline-enforcement" cron
enforceDeadlinesForAllUsers(): Promise<{
  processed: number;  // accounts checked without an error
  closed: number;     // cases closed
  skipped: number;    // accounts whose check failed
}>
```

For each case it closes, it calls `deadlineEnforcement.closeCaseAndNotify`, then schedules
`notificationActions.sendAutoClosureEmail` when the account's preferences allow an urgent `auto_closure` email
(one second apart), and a push when `pushNotificationsEnabled` is on. `closeCaseAndNotify` returns `null` when the
case was closed already, and then no email goes. A failure for one account is recorded with `recordError` and the
run moves on to the next. The `checkAndEnforceDeadlines` mutation still runs when someone signs in, and it does
nothing for a case this run closed.

---

### `cleanupOldNotifications` (internal action)

Deletes read notifications older than 90 days. Unread notifications stay at any age.

```typescript
// Internal: called by the "notification-cleanup" cron
cleanupOldNotifications(): Promise<{
  deleted: number;
}>
```

It reads up to 1,000 matching notification ids a run (`getOldReadNotifications`) and deletes each with its own
`deleteNotification` mutation. The next hourly run takes what's left.

---

### `sendWeeklyDigest` (internal action)

The Monday case summary.

```typescript
// Internal: called by the "weekly-digest" cron
sendWeeklyDigest(): Promise<{
  sent: number;     // emails scheduled
  skipped: number;  // accounts left out or whose build failed
}>
```

Who gets it: accounts from `getUsersForWeeklyDigest`, whose profile isn't deleted, has
`emailNotificationsEnabled: true` and doesn't have `emailWeeklyDigest: false`, with a verified address and no
pending deletion.

`buildDigestContent` in `convex/lib/digestHelpers.ts` builds it. It lists overdue deadlines from
the past 30 days and the deadlines due in the next 14 days, split at day 7. It also lists the cases updated in the
last 7 days, with the count of live cases and the unread notification count.

When it goes: `summaryWorthSending` decides. While `savingEmail()` is true (the free plan's allowance,
`convex/lib/emailAllowance.ts`), it goes only in a week a case changed or a deadline passed. With a paid
allowance (`EMAIL_DAILY_LIMIT` above 100) it goes every week to anyone with an active case.

Each email is scheduled through `notificationActions.sendWeeklyDigestEmail`, one second apart. A failure for one
account is recorded with `recordError` and counted in `skipped`.

---

### Other scheduled handlers (scheduledJobs.ts)

```typescript
// Hourly ("rate-limit-cleanup"): deletes up to 1,000 rateLimits rows older than
// 24 hours, read through the by_timestamp index.
cleanupRateLimits(): Promise<{ deleted: number }>

// Daily ("conversation-ttl-cleanup"): deletes up to 50 chat conversations whose
// updatedAt is older than 90 days, with their messages and up to 2,000 cached
// tool answers each.
cleanupExpiredConversations(): Promise<{ deleted: number; hasMore: boolean }>

// Run per account by accountDeletion.processExpiredDeletions: purges the account
// (purgeAllUserData) once its deletedAt has passed. Refuses, with a message,
// when the user is gone, the deletion was cancelled or the grace period isn't over.
permanentlyDeleteAccount(args: {
  userId: Id<"users">;
}): Promise<{ success: boolean; message: string }>

// Deletes one notification (the cleanup run's helper).
deleteNotification(args: {
  notificationId: Id<"notifications">;
}): Promise<void>
```

---

### Internal Queries (scheduledJobs.ts)

```typescript
// The day's deadline reminders: every live case through by_deleted_at, each
// account's address (verified only) and newest live profile, and the reminders
// already sent through notifications.by_case_id.
getCasesNeedingReminders(): Promise<DeadlineReminder[]>

// Accounts that take the weekly digest.
getUsersForWeeklyDigest(): Promise<Array<{
  userId: Id<"users">;
  email: string;
  userName: string;
  profile: Doc<"userProfiles">;
}>>

// Up to 1,000 read notifications created before `olderThan` (epoch ms).
getOldReadNotifications(args: {
  olderThan: number;
}): Promise<Id<"notifications">[]>

// One account's deadlines from 30 days back to 14 days ahead, sorted by date,
// for the weekly digest. Leaves out deleted, closed and sample cases.
getDeadlinesForDigest(args: {
  userId: Id<"users">;
}): Promise<RawDeadlineData[]>

// One account's cases updated in the last 7 days (sample case left out).
getRecentlyUpdatedCases(args: {
  userId: Id<"users">;
}): Promise<RawCaseUpdateData[]>

// One account's live case count (countLiveCases).
getActiveCaseCountForUser(args: {
  userId: Id<"users">;
}): Promise<number>

// One account's unread notifications, counted up to UNREAD_COUNT_CAP.
getUnreadCountForUser(args: {
  userId: Id<"users">;
}): Promise<number>

// Up to 100 users whose deletedAt has passed.
getUsersWithExpiredDeletions(): Promise<Id<"users">[]>

// Accounts with autoDeadlineEnforcementEnabled, a verified address and no
// pending deletion.
getUsersForDeadlineEnforcement(): Promise<Array<{
  userId: Id<"users">;
  email: string;
  profile: Doc<"userProfiles">;
}>>

// One account's live cases, closed and sample cases left out.
getActiveCasesForEnforcement(args: {
  userId: Id<"users">;
}): Promise<Doc<"cases">[]>
```

`convex/deadlineDigest.ts` has one more internal query, `getDisplayNames({ userIds })`, which returns each
account's first name (or "there") for the digest greeting.

---

## Internal Actions

Server-side actions that reach outside Convex: email through Resend, and browser push.

---

### Email Actions (notificationActions.ts)

Each action renders a React Email template from `src/emails/` to HTML and sends it through `sendOrQueue`
(`convex/lib/email.ts`), from `FROM_EMAIL` (`PERM Tracker <notifications@permtracker.app>`). `sendOrQueue`:

- skips the site's own test accounts, and sends mail for the owner's own inbox through the mail Worker first;
- counts the send in the day's email ledger, and at the day's ceiling keeps the email in the retry queue for the
  next day (the ceilings are shares of `EMAIL_DAILY_LIMIT`, `convex/lib/emailLimits.ts`);
- sends with `sendEmailWithRetry`, which refuses a blocklisted recipient and retries Resend's rate limits;
- keeps a failure a retry can fix in the retry queue and reports it to the caller as `queued`, with no error.

The admin notice is the exception: it goes through `sendOwnerMail` (`convex/lib/ownerMail.ts`).

Environment variables (names only):
- `AUTH_RESEND_KEY`: the Resend API key (`getResend` throws when it's missing).
- `APP_URL`: the base for links in emails. When it's unset, links use `SITE_URL` (`https://permtracker.app`).
- `UNSUBSCRIBE_SECRET`: signs the one-click unsubscribe link in the weekly digest and the re-engagement nudge.
  When it's unset, those emails go without the link.

The actions that carry a `notificationId` first check the notification and its account through
`notifications.isNotificationValid` and send nothing when either is gone or unverified. After a send, they mark the
notification emailed with `notifications.markEmailSent`. The digest and nudge actions check the address through
`notifications.isUserActiveByEmail` instead.

---

#### `sendStatusChangeEmail` (internal action)

Emails a case's change of stage or progress. Scheduled from `convex/cases.ts` and `convex/appCaseWatch.ts`.

```typescript
sendStatusChangeEmail(args: {
  notificationId: Id<"notifications">;
  to: string;
  beneficiaryName: string;
  companyName: string;
  previousStatus: string;
  newStatus: string;
  changeType: "stage" | "progress";
  changedAt: string;
  caseId: string;
  caseNumber?: string;
}): Promise<void>
```

Subject: `"New case: {beneficiaryName} at {companyName}"` when `previousStatus` is empty or `"N/A"`, otherwise
`"{beneficiaryName} at {companyName}: {stage|progress} moved from {previousStatus} to {newStatus}"`.

Throws `Email failed: ...` when the send returns an error, after `recordError`.

---

#### `sendAutoClosureEmail` (internal action)

Emails that a case was closed for a missed deadline. Scheduled from `convex/deadlineEnforcement.ts` and
`scheduledJobs.enforceDeadlinesForAllUsers`.

```typescript
sendAutoClosureEmail(args: {
  notificationId: Id<"notifications">;
  to: string;
  beneficiaryName: string;
  companyName: string;
  violationType: string;   // a readable deadline name
  reason: string;          // why the case was closed
  closedAt: string;        // a formatted time
  caseId: string;
  caseNumber?: string;
}): Promise<void>
```

Subject: `"Case closed: {beneficiaryName} at {companyName} ({violationType})"`.

Throws `Email failed: ...` when the send returns an error.

---

#### `sendAccountDeletionEmail` (internal action)

Confirms an account deletion. Scheduled from `convex/users.ts` and `convex/lib/deletion.ts`.

```typescript
sendAccountDeletionEmail(args: {
  to: string;
  userName: string;
  deletionDate?: string;  // used for a scheduled deletion
  immediate?: boolean;    // true: deleted now, today's date and no cancel link
}): Promise<void>
```

Subject: `"Your PERM Tracker account was deleted"` when `immediate`, otherwise
`"Your PERM Tracker account is scheduled for deletion"`. Throws `Email failed: ...` on a send error.

---

#### `sendWeeklyDigestEmail` (internal action)

Sends one weekly digest built by `sendWeeklyDigest`. Adds RFC 8058 `List-Unsubscribe` and
`List-Unsubscribe-Post` headers when the one-click link can be made.

```typescript
sendWeeklyDigestEmail(args: {
  to: string;
  digestContent: DigestContent;  // validated field by field
}): Promise<void>
```

Subject: `"Your weekly case summary: all clear"` when the digest is empty,
`"Weekly case summary: {n} overdue, {m} due this week"` when something's overdue,
`"Weekly case summary: {m} deadline(s) this week"` when something's due this week, and
`"Your weekly case summary"` otherwise. Throws `Email failed: ...` on a send error.

---

#### `sendReengagementNudge` (internal action)

The "We've missed you at PERM Tracker" email to an inactive account, scheduled by
`reengagement.runReengagementCheck`. Carries the one-click unsubscribe headers when the link can be made.

```typescript
sendReengagementNudge(args: {
  to: string;
  userName: string;
  activeCaseCount: number;
}): Promise<void>
```

A send error is logged and recorded, and the action doesn't throw.

---

#### `sendDeadlineDigestEmail` (internal action)

The daily deadline digest: one email per account listing every deadline that reached a reminder day. Scheduled by
`deadlineDigest.runDeadlineReminders`. Sends nothing when `items` is empty.

```typescript
sendDeadlineDigestEmail(args: {
  to: string;
  userName: string;
  items: Array<{
    caseId: Id<"cases">;
    employerName: string;
    beneficiaryIdentifier: string;
    deadlineType: string;
    deadlineDate: string;
    daysUntil: number;
    urgency: "overdue" | "urgent" | "upcoming" | "later";
  }>;
}): Promise<void>
```

The subject comes from `deadlineDigestWords` (`convex/lib/deadlineDigestWords.ts`), from the item count and the
overdue count. Throws `Email failed: ...` on a send error.

---

#### `sendAdminNotificationEmail` (internal action)

A notice to the site's admin inbox (abuse, system errors, the email ledger, the server watch, sign-ups), rendered
with the `AdminEmail` template.

```typescript
sendAdminNotificationEmail(args: {
  subject: string;
  body: string;
  to?: string;             // overrides the default recipient
  recipientName?: string;  // default "Admin"
  route?: string;          // the alert's kind in scripts/data/alert_routes.json
}): Promise<void>
```

When `route` names a kind the routing list doesn't send at once (`isSentNow`), nothing is emailed. Without `to`, it
goes to `getSecurityAlertEmail()`, which reads `SECURITY_ALERT_EMAIL` and falls back to `ADMIN_EMAIL`. It sends
through `sendOwnerMail` and never throws: a missing recipient or a send error is logged and recorded.

---

#### `sendTestEmail` (action)

Public. Sends a test email from the notification settings.

```typescript
sendTestEmail(args: {
  email: string;
}): Promise<{ success: true }>
```

Throws `Not authenticated` without a signed-in user, and refuses any address other than the caller's own verified
one (`notifications.isOwnVerifiedEmail`). Rate limits `testEmail` (3 an hour) and `testEmailDaily` (6 a day) apply
per account. It's sent with `priority: "public"` and `noQueue: true`, so at the day's ceiling or on a failure it
throws `Email failed: ...` and never waits in the retry queue.

---

### Push Notification Actions (pushNotifications.ts)

Browser push through the `web-push` library, with VAPID. The file runs in the Node.js runtime (`"use node"`), so
its queries and mutations live in `pushSubscriptions.ts`. VAPID is set up on first use, with the contact
`mailto:support@permtracker.app`.

Environment variables (names only):
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: the VAPID public key
- `VAPID_PRIVATE_KEY`: the VAPID private key

---

#### `sendPushNotification` (internal action)

Sends a push to one account's stored subscription. Scheduled by `deadlineDigest.runDeadlineReminders`,
`scheduledJobs.enforceDeadlinesForAllUsers` and `convex/deadlineEnforcement.ts`.

```typescript
sendPushNotification(args: {
  userId: Id<"users">;
  title: string;
  body: string;
  url?: string;   // opened on click; default "/dashboard"
  tag?: string;   // groups notifications; default "perm-tracker"
}): Promise<{
  sent: boolean;
  reason?: string;
  error?: string | null;
}>
```

| `sent` | `reason` | What happened |
|--------|----------|---------------|
| `true` | none | The push service accepted it |
| `false` | `vapid_not_configured` | A VAPID key is missing or VAPID setup failed |
| `false` | `no_subscription` | The profile has no stored subscription |
| `false` | `push_disabled` | The account turned push off |
| `false` | `subscription_corrupted` | The stored subscription isn't valid JSON, so it's cleared |
| `false` | `subscription_expired` | The push service answered 404 or 410, so the subscription is cleared |
| `false` | `send_failed` | Any other push error, recorded with `recordError` |

The payload carries `title`, `body`, `url`, `tag`, `icon` (`/icon-192.png`) and `badge` (`/badge-72.png`).

---

#### `sendTestPush` (action)

Public. Sends a test push to the signed-in account's own subscription, opening `/settings`.

```typescript
sendTestPush(): Promise<{ success: true }>
```

It throws in four cases before sending: VAPID isn't configured, there's no signed-in profile (`Not authenticated`),
no subscription is stored, or push is turned off. On a 404 or 410 from the push service it clears the subscription
and throws `Push subscription expired. Please re-enable push notifications.` Any other error is recorded and thrown.

---

### Push Subscription Helpers (pushSubscriptions.ts)

```typescript
// Public query. The signed-in account's push settings, or null when signed out
// or without a live profile. sendTestPush reads it.
getCurrentUserPushProfile(): Promise<{
  userId: Id<"users">;
  pushSubscription: string | undefined;          // the stored subscription JSON
  pushNotificationsEnabled: boolean | undefined;
} | null>

// Internal query. An account's live profile (deletedAt unset), for sendPushNotification.
getUserProfileById(args: {
  userId: Id<"users">;
}): Promise<Doc<"userProfiles"> | null>

// Internal mutation. Removes the stored subscription and turns push off
// (pushNotificationsEnabled: false). Does nothing when there's no live profile.
clearPushSubscription(args: {
  userId: Id<"users">;
}): Promise<void>
```

Each reads the profile through the `by_user_id` index and keeps the one whose `deletedAt` is unset (`.unique()`).

---

## Error Handling

### Errors these modules throw

Two kinds of error reach a client. A `ConvexError` keeps its message in production. A plain `Error` reaches a
production client as Convex's generic server error, with the message kept in the deployment's logs. The messages
below are copied from the source.

```typescript
// Authentication (convex/lib/auth.ts)
throw new Error("not authenticated");                     // getCurrentUserId
throw new Error("Not authenticated");                     // users.ts, pushNotifications.ts, notificationActions.ts
throw new Error("Unauthorized");                          // userCaseOrder.saveCaseOrder

// Ownership (verifyOwnership, and the modules' own checks)
throw new Error(`${resourceName} not found`);             // "case not found"
throw new Error(`Access denied: you do not own this ${resourceName}`);
throw new Error("Access denied: you do not own this notification");
throw new Error("Access denied");                          // deadlineEnforcement.ts

// Not found
throw new ConvexError("Case not found");
throw new Error("Notification not found");
throw new Error("User profile not found");

// Validation
throw new ConvexError(`Validation failed: ${validationErrors.join("; ")}`);   // cases.create, cases.update
throw new ConvexError(`At most ${USER_CASES_MAX} cases at a time.`);         // cases.bulkUpdateStatus
throw new Error("Invalid push subscription format: not valid JSON");
throw new Error("Invalid push subscription: missing required fields (endpoint, keys.p256dh, keys.auth)");
throw new Error("Invalid push subscription: the endpoint isn't a browser push service");

// State
throw new ConvexError("Cannot update deleted case");
throw new ConvexError("Case is not closed");                // cases.reopenCase
throw new ConvexError("Cannot reopen deleted case");
throw new Error("Not an auto-closure notification");
throw new Error("No deletion scheduled for this account");
throw new Error("Grace period has expired. Account deletion cannot be cancelled.");
```

A validation message lists every rule that failed, each as `[<rule id>] <field>: <message>`, joined by `; `.

Rate limits come from `@convex-dev/rate-limiter` (0.4.3), configured in `convex/rateLimitConfig.ts`. A call made with
`throws: true` throws a `ConvexError` whose data has `kind: "RateLimited"`. In these modules: `caseCreate`
(`cases.create`, `caseRestore.restoreDeleted`), `caseUpdate` (`cases.update`, `cases.bulkUpdateStatus`),
`notificationsMarkAllRead`, `pushSubscriptionSave`, `userCaseOrderSave`, `testEmail` and `testEmailDaily`.

### How the client shows an error

Pages catch a failed call with `handleOperationError` (`src/lib/errors.ts`). It sends the error to Sentry through
`captureError` and shows a fixed message written for that action, as an error or a warning toast. The server's
message isn't shown to the user.

```typescript
try {
  const result = await markAllAsRead({});
  // ...
} catch (error) {
  handleOperationError(error, {
    userMessage: "Couldn’t mark all as read. Try again.",
    context: { operation: "bulkMarkAllRead" },
  });
}
```

### Error handling conventions

| Category | What the code does | Example |
|----------|---------|---------|
| Signed out, query | Return an empty value | `return []`, `return null`, an empty page |
| Signed out, mutation | Throw | `getCurrentUserId` throws `"not authenticated"` |
| Someone else's document, `cases.get` | Return `null` | The same answer as a missing id |
| Someone else's document, writes | Throw | `verifyOwnership` throws `"Access denied: you do not own this case"` |
| Validation | Throw a `ConvexError` listing each failed rule | `Validation failed: [V-PWD-01] ...` |
| A side effect fails after the write | Log it, call `recordError`, keep the write | The notification after `cases.create` |
| An email send fails | The email actions throw `Email failed: <message>` after `sendEmailWithRetry` returns an error | `notificationActions.ts` |

`recordError(ctx, source, operation, error, opts)` (`convex/lib/errorRecording.ts`) schedules
`systemErrors.record` (a database row and a rate-limited admin email) and a Sentry report. Queries can't schedule, so
only mutations and actions call it.

---

## Cross-Cutting Patterns

### Authentication pattern

Queries read the caller with `getCurrentUserIdOrNull` and answer empty when it's `null`. Mutations call
`getCurrentUserId`, which throws. See [Authentication Patterns](#authentication-patterns) for both, with the code.

---

### Ownership verification pattern

The modules use three shapes:

```typescript
// 1. Throw on a missing or foreign document (convex/lib/auth.ts, used by cases.ts)
await verifyOwnership(ctx, caseDoc, "case");

// 2. Answer null for both, so an id's existence never shows (cases.get)
if (caseDoc.userId !== userId) {
  return null;
}

// 3. Read through an index that starts with userId, so every row is the caller's
const unread = await ctx.db
  .query("notifications")
  .withIndex("by_user_and_unread", (q) =>
    q.eq("userId", userId).eq("isRead", false)
  )
  .take(BATCH_SIZE + 1);
```

---

### Deleting a case

Deleting a case erases its row. `cases.remove` and `cases.bulkRemove` first write a `delete` row to `auditLogs`
holding every field of the case, with the FEIN redacted. That copy is kept for 30 days (`DELETED_CASE_DAYS` in
`convex/lib/deletedCases.ts`), and `caseRestore.restoreDeleted` can bring the case back from it in that time. The
`retention` run erases the copy after that.

The `cases` table still has a `deletedAt` field, and older rows may carry it. Every read of an account's cases goes
through `readUserCases` (`convex/lib/userCases.ts`), which reads the `by_user_and_deleted` index with
`deletedAt` unset:

```typescript
const rows = ctx.db
  .query("cases")
  .withIndex("by_user_and_deleted", (q) =>
    q.eq("userId", userId).eq("deletedAt", undefined)
  )
  .order("desc");
```

It reads newest first, up to `USER_CASES_MAX` (5,000) cases, stops early when the transaction's read budget runs
low, returns the cases oldest first and sets `truncated` when it left some out.

Notifications are deleted outright. A user's own deletes write a change log row: one per notification for
`deleteNotification`, one per batch for `deleteAllRead`.

---

### Pagination patterns

#### Cursor pagination over `_creationTime`

`notifications.getNotifications` pages by creation time. The cursor is `c:<_creationTime>` of the last row it read
(an older `<time>|<id>` cursor still decodes). Each page reads through an index that starts with `userId`, newest
first, from below the cursor:

```typescript
const rows =
  isRead !== undefined
    ? ctx.db
        .query("notifications")
        .withIndex("by_user_and_unread", (q) =>
          after === null
            ? q.eq("userId", userId).eq("isRead", isRead)
            : q.eq("userId", userId).eq("isRead", isRead).lt("_creationTime", after)
        )
    : ctx.db
        .query("notifications")
        .withIndex("by_user_id", (q) =>
          after === null
            ? q.eq("userId", userId)
            : q.eq("userId", userId).lt("_creationTime", after)
        );

const page: Doc<"notifications">[] = [];
let scanned = 0;
let lastSeen: number | null = null;
let hasMore = false;
for await (const n of rows.order("desc")) {
  if (page.length === pageSize || scanned === NOTIFICATION_PAGE_SCAN_MAX) {
    hasMore = true;
    break;
  }
  scanned++;
  lastSeen = n._creationTime;
  if (filters?.caseId !== undefined && n.caseId !== filters.caseId) continue;
  if (typeSet !== null && !typeSet.has(n.type)) continue;
  page.push(n);
}
```

The page size is clamped to 1 to 100. A filtered page reads at most `NOTIFICATION_PAGE_SCAN_MAX` (4,000) rows and
then returns what it found, with `hasMore` and a cursor.

#### Page numbers over one read

`cases.listFiltered` reads the account's cases once with `readUserCases`, then filters, searches, sorts and slices
them in memory by `page` and `pageSize`.

None of these modules uses Convex's `.paginate()`.

---

### Batching patterns

`notifications.markAllAsRead` and `notifications.deleteAllRead` each handle at most 100 rows a call and report
whether more remain:

```typescript
// convex/notifications.ts, markAllAsRead
const userId = await getCurrentUserId(ctx);
await rateLimiter.limit(ctx, "notificationsMarkAllRead", { key: userId, throws: true });
const now = Date.now();
const BATCH_SIZE = 100;

const unreadNotifications = await ctx.db
  .query("notifications")
  .withIndex("by_user_and_unread", (q) =>
    q.eq("userId", userId).eq("isRead", false)
  )
  .take(BATCH_SIZE + 1); // Take one extra to check if there are more

const hasMore = unreadNotifications.length > BATCH_SIZE;
const toProcess = unreadNotifications.slice(0, BATCH_SIZE);

for (const notification of toProcess) {
  await ctx.db.patch(notification._id, {
    isRead: true,
    readAt: now,
    updatedAt: now,
  });
}

return { count: toProcess.length, hasMore };
```

`deleteAllRead` has the same shape over `isRead: true`, and writes one change log row for the batch before it
deletes. The callers (`src/components/notifications/BulkActions.tsx`, `NotificationDropdown.tsx` and the chat's
`src/lib/ai/caseActions.ts`) each make one call and don't repeat it while `hasMore` is true.

`cases.bulkUpdateStatus` refuses more than `USER_CASES_MAX` ids in one call.

---

### Notification creation patterns

#### Through `createNotification`

Case code writes notifications through the internal mutation, which skips the sample case and fills in the
read and email flags:

```typescript
// convex/cases.ts, create
const notificationId = await ctx.runMutation(internal.notifications.createNotification, {
  userId: userId,
  caseId: caseId,
  type: "status_change",
  title: "New case created",
  message: `A case for ${args.beneficiaryIdentifier || "a beneficiary"} at ${args.employerName} was added.`,
  priority: "normal",
});
```

`createNotification` takes `userId`, an optional `caseId`, `type`, `title`, `message`, `priority` and the optional
`deadlineDate`, `deadlineType` and `daysUntilDeadline` (a number). It returns the new id, or `null` for the sample
case. `cases.ts` and `deadlineDigest.ts` call it. `deadlineEnforcement.ts`, `appCaseWatch.ts` and `admin.ts` insert
into `notifications` directly.

#### With an email

The email goes out through `ctx.scheduler.runAfter` once the account's switches allow it:

```typescript
// convex/cases.ts, create
const userPrefs = buildUserNotificationPrefs(userProfile);
// ...
if (notificationId && shouldSendEmail("status_change", "normal", userPrefs)) {
  const user = await ctx.db.get(userId);
  if (user?.email) {
    await ctx.scheduler.runAfter(0, internal.notificationActions.sendStatusChangeEmail, {
      notificationId,
      to: user.email,
      beneficiaryName: args.beneficiaryIdentifier || "Beneficiary",
      companyName: args.employerName,
      previousStatus: "",
      newStatus: formatCaseStatus(effectiveCaseStatus),
      changeType: "stage",
      changedAt: emailStamp(),
      caseId: caseId.toString(),
      caseNumber: args.internalCaseNumber,
    });
  }
}
```

Deadline reminders don't send one email each. The daily run in `convex/deadlineDigest.ts` writes the in-app
notifications and then sends each account one digest email (see [Scheduled Jobs](#scheduled-jobs)).

#### Helper functions (`convex/lib/notificationHelpers.ts`)

```typescript
// Titles: "Case moved to <stage>", a deadline's title by its type and day count, and so on
generateNotificationTitle(type: NotificationType, context: NotificationContext): string

// Priority from the days left: urgent when overdue or within `urgentWithin` days (default 7,
// the account's urgentDeadlineDays), high within 14, normal within 30, low after that.
// RFI and RFE alerts are never below high.
calculatePriority(daysUntil: number, type: NotificationType, urgentWithin?: number): PriorityLevel

// The master email switch, then the switch for the notification's kind (and, for a reminder,
// the switch for its deadline type). Quiet hours never hold an email.
shouldSendEmail(notificationType, _priority, userPrefs, deadlineType?): boolean

// Push: the push switch and quiet hours
shouldSendPush(...): boolean

buildUserNotificationPrefs(profile): UserNotificationPrefs
formatDeadlineType(deadlineType): string   // "pwd_expiration" -> "PWD expiration"
```

---

### Data validation patterns

#### Argument validators taken from the schema

`cases.create` and `cases.update` don't list their fields by hand. Their validators come from the `cases` table's
own validator, so they can't drift from the schema:

```typescript
// convex/cases.ts
const caseTable = schema.tables.cases.validator;
const caseInput = caseTable.omit(
  "userId",
  "recruitmentStartDate",
  "recruitmentEndDate",
  "filingWindowOpens",
  "filingWindowCloses",
  "recruitmentWindowCloses",
  "closureReason",
  "closedAt",
  "createdAt",
  "updatedAt",
  "deletedAt",
);

const caseCreateArgs = {
  ...caseInput.omit("markedAsDuplicateAt").partial().fields,
  employerName: caseTable.fields.employerName,
  positionTitle: caseTable.fields.positionTitle,
  calendarEventIds: callerCalendarEventIds,
};
```

The stage and progress values come from one list in `convex/lib/perm/statusTypes.ts`, which the schema reads:

```typescript
export const CASE_STATUSES = [
  "pwd",
  "recruitment",
  "eta9089",
  "i140",
  "closed",
] as const satisfies readonly CaseStatus[];

export const PROGRESS_STATUSES = [
  "working",
  "waiting_intake",
  "filed",
  "approved",
  "under_review",
  "rfi_rfe",
] as const satisfies readonly ProgressStatus[];
```

Dates are ISO `YYYY-MM-DD` strings throughout.

#### Business rule validation

`create` and `update` run the central rules from `convex/lib/perm`. They map the case's camelCase fields to the
rules' snake_case names with `mapToValidatorFormat`, call `validateCase`, and throw when it fails:

```typescript
// convex/cases.ts, planCaseCreate
const validationInput = mapToValidatorFormat({
  ...args,
  eta9089ExpirationDate,
  recruitmentStartDate: derivedDates.recruitmentStartDate,
  recruitmentEndDate: derivedDates.recruitmentEndDate,
});
const validationResult = validateCase(validationInput);
const validationErrors = validationResult.valid
  ? []
  : validationResult.errors.map((e) => `[${e.ruleId}] ${e.field}: ${e.message}`);
```

When a change touches only the stage, progress or metadata fields (notes, documents, favourite, pinned, tags,
calendar sync, timeline), `update` skips the date rules. The previews, `previewCreate` and `previewUpdate`, run the same
plan and report the result without writing. An import records failed rules as warnings and imports the case anyway.

---

### Derived and cascading dates

The server stores five dates it works out from the recruitment dates: `recruitmentStartDate`,
`recruitmentEndDate`, `filingWindowOpens`, `filingWindowCloses` and `recruitmentWindowCloses`. `create` and `update`
compute them with `calculateDerivedDates` (`convex/lib/derivedCalculations.ts`), and a certified case with no ETA 9089
expiration gets one from `resolveEta9089ExpirationDate`.

The case form fills dependent dates as they're typed (`src/hooks/useFormCalculations.ts`): the PWD expiration from
the determination date, the notice of filing and job order end dates from their start dates, and the ETA 9089
expiration from the certification date.

`convex/lib/perm` also exports `applyCascade(currentState, { field, value })` and `applyCascadeMultiple(currentState,
changes)`, which apply the same rules to the rules' snake_case case shape. Only tests call them today.

---

### Index usage pattern

The indexes these modules read, from `convex/schema.ts`:

```typescript
// cases
"by_user_id"                       // ["userId"]
"by_user_and_deleted"              // ["userId", "deletedAt"]: readUserCases
"by_user_and_duplicate"            // ["userId", "duplicateOf"]
"by_user_and_status"               // ["userId", "caseStatus"]
"by_user_and_favorite"             // ["userId", "isFavorite"]
"by_user_and_priority"             // ["userId", "priorityLevel"]
"by_user_and_updated_at"           // ["userId", "updatedAt"]
"by_deleted_at"                    // ["deletedAt"]
"by_deletedAt_caseNumber"          // ["deletedAt", "caseNumber"]: the DOL status sweep
"by_user_and_filing_deadline"      // ["userId", "filingWindowCloses"]
"by_user_and_pwd_expiration"       // ["userId", "pwdExpirationDate"]
"by_user_and_recruitment_end"      // ["userId", "recruitmentEndDate"]
"by_user_and_recruitment_window"   // ["userId", "recruitmentWindowCloses"]

// notifications
"by_user_id"                       // ["userId"]
"by_user_and_unread"               // ["userId", "isRead"]
"by_case_id"                       // ["caseId"]
"by_deadline_date"                 // ["deadlineDate"]

// auditLogs
"by_user_id", "by_table_name", "by_document_id", "by_timestamp",
"by_user_and_table", "by_user_and_timestamp",
"by_user_table_action_restored_and_timestamp",   // the recently deleted list
"by_table_action_erased_and_timestamp"           // the 30-day erase

// userProfiles
"by_user_id", "by_deleted_at", "by_count_case_dates"

// userCaseOrder
"by_user_id"
```

Every index range ends with `_creationTime`, which is how `getNotifications` pages with `.lt("_creationTime", after)`.

---

## Patterns to follow

### 1. Use reactive queries

```typescript
// useQuery re-runs when the data it read changes; there's nothing to poll
const cases = useQuery(api.cases.list);
```

### 2. Use the bulk mutations for many cases

```typescript
// One call for the selection
await bulkRemove({ ids: selectedCaseIds });

// Instead of one call per case
for (const id of ids) {
  await remove({ id });
}
```

### 3. Read a user's rows through an index that starts with `userId`

Use the indexes listed under [Index usage pattern](#index-usage-pattern), and `readUserCases` for an account's cases.
A `.filter()` on a table with no index reads every row.

### 4. Handle the loading and signed-out states

```typescript
const cases = useQuery(api.cases.list);

if (cases === undefined) {
  return <Skeleton />; // loading
}
// Signed out, the query answers [] instead of throwing
```

### 5. Check before you write

The case form runs the central rules in the browser before it saves (`validateCase` in
`src/lib/forms/case-form-schema.ts`). The chat asks the server first: `src/lib/ai/caseActions.ts` calls
`cases.previewCreate` or `cases.previewUpdate`, which run the same plan as `create` and `update` and write nothing.

```typescript
// src/lib/ai/caseActions.ts (types trimmed)
preview = await fetchQuery(api.cases.previewCreate, args, { token });
```

`create` and `update` run `validateCase` again on the server and throw `Validation failed: ...` when a rule fails.
