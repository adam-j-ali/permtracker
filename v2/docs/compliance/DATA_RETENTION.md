# Data Retention Policy

> PERM Tracker data retention schedules for SOC 2 Confidentiality (C1)

## Retention Schedules

| Data Type | Retention | Mechanism | Notes |
|-----------|-----------|-----------|-------|
| User accounts & profiles | Until deletion | User-initiated | 30-day grace period on deletion |
| PERM cases | Until deletion | User-initiated | Deleted at once, with their uploaded files and recruitment log; purged with the account |
| Recruitment record share links | Until turned off or the case is deleted | User-initiated | `recruitmentShares`: the SHA-256 of the link's key, never the key, and the Eastern day it was last opened. A turned-off link answers nothing and is deleted when the case's next link is made; every link goes with its case and with the account (since Nov 20 2026) |
| A case's second reminder recipient | Until it stops the reminders, the owner removes it, or the case or account is deleted; **30 days** if never confirmed | User-initiated, the stop link, and the daily retention run (`reminderRecipients.expireInvites`) | `reminderRecipients`: the address (trimmed, lowercased), its status and the days it was invited, confirmed or stopped. Stopping erases the address and keeps the row as stopped so the owner sees it; removing deletes the row; it goes with its case and with the account (since Nov 20 2026) |
| Deleted cases' copies | **30 days** after the deletion | Daily cron (3:20 AM UTC), `retention.eraseDeletedCaseCopies` | The `auditLogs` row of a case's deletion holds the whole case so its owner can restore it from Settings (`caseRestore.restoreDeleted`, since Nov 20 2026). Then the copy is erased and the case's other `auditLogs` rows (its creation and edits) are deleted; the deletion's row keeps who, which case and when (`erasedAt`). `DELETED_CASE_DAYS` in `convex/lib/deletedCases.ts` |
| AI conversations | **90 days** | Daily cron (3 AM UTC) | Auto-deleted after 90 days of inactivity |
| Read notifications | **90 days** | Hourly cron (:30) | Unread notifications preserved regardless of age |
| Rate limit records | **24 hours** | Hourly cron (:15) | Processed in batches of 100 |
| Audit logs | **Indefinite** | N/A | Required for compliance, never auto-deleted, except a deleted case's (the row above) |
| System error logs | **180 days** | Daily cron (3:20 AM UTC) | `systemErrors`; `convex/retention.ts` (since Sep 29 2026) |
| Email events (Resend webhook) | **365 days** | Daily cron (3:20 AM UTC) | `marketingEvents` |
| AI provider usage counters | **90 days** | Daily cron (3:20 AM UTC) | `apiUsage` |
| Queued confirmation requests | **7 days** at most | Deleted when sent; the 15-minute drain drops any older than 7 days | `confirmationQueue`: the address and the form's own fields, never the IP (since Sep 29 2026) |
| Failed emails waiting to retry | **14 days** at most | Deleted when sent; the drain drops any older than 14 days | `emailRetries`: the whole rendered email (recipient, subject, body), so it can be sent again; never sign-in codes |
| Daily email counts | **400 days** | Daily cron (3:20 AM UTC) | `emailDays`: counts only, no addresses |
| Unconfirmed case-alert sign-ups | **30 days** | Daily cron (3:20 AM UTC) | `caseStatusAlerts` rows never confirmed; nothing was ever sent to them |
| Stopped browser notifications | **90 days** after stopping | Daily cron (3:20 AM UTC) | `caseStatusPushAlerts` and `bulletinPushAlerts` rows with `closedAt`: stopped, revoked or ended at a final status (since Nov 5 2026, owner's call) |

## Automated Cleanup Jobs

All cleanup runs via `convex/crons.ts`:

| Cron | Schedule | Handler |
|------|----------|---------|
| `deadline-reminders` | Daily 9 AM EST (14:00 UTC) | `checkDeadlineReminders` |
| `notification-cleanup` | Hourly :30 | `cleanupOldNotifications` |
| `weekly-digest` | Monday 9 AM EST | `sendWeeklyDigest` |
| `account-deletion-cleanup` | Hourly :45 | `processExpiredDeletions` |
| `rate-limit-cleanup` | Hourly :15 | `cleanupRateLimits` |
| `conversation-ttl-cleanup` | Daily 3:00 AM UTC | `cleanupExpiredConversations` |
| `confirmation-queue-drain` | Every 15 minutes | `confirmationQueue.drain` (sends, and drops requests past 3 days) |
| `operational-log-retention` | Daily 3:20 AM UTC | `retention.pruneOperationalLogs`, which then starts `retention.eraseDeletedCaseCopies` |

## Account Deletion

1. User requests deletion via Settings > Delete Account
2. Account enters 30-day grace period (`deletedAt` set to now + 30 days)
3. User can cancel during grace period
4. After grace period, `processExpiredDeletions` cron purges all data
5. Purge includes: cases, conversations, messages, notifications, profile, user record

## AI Provider Data Retention

| Provider | Retention | Training Use |
|----------|-----------|-------------|
| Google Gemini | Up to 55 days (abuse monitoring) | No |
| OpenRouter | Zero Data Retention (ZDR) | No |
| Mistral AI | Per DPA terms | No |
| Groq | Zero Data Retention (ZDR) | No |

## Data Export

Users can export all their data at any time via Settings > "Export All My Data" button.

Export includes:
- User record (email, name, creation date)
- Profile (with sensitive tokens redacted)
- All cases (with FEINs decrypted for export)
- All conversations and messages
- All notifications
- Audit log entries

Format: JSON file download (`perm-tracker-export-YYYY-MM-DD.json`)
