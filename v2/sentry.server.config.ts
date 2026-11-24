/**
 * Sentry Server-Side Configuration
 *
 * Initializes Sentry for server-side error tracking.
 * This file is loaded by the instrumentation hook when running on the server.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from "@sentry/nextjs";

import { serverEventFromStrayPost } from "./src/lib/exceptionNoise";
import { createSentryBudget } from "./src/lib/sentryBudget";
import { SENTRY_DATA_COLLECTION } from "./src/lib/sentryDataCollection";
import { scrubShareKeys, scrubShareKeysOnSend } from "./src/lib/sentryRedact";

// A per-process ceiling on what reaches Sentry in an hour (src/lib/sentryBudget.ts):
// far above a normal day, so a storm cannot spend the monthly allowance.
const budget = createSentryBudget();

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Only the live server reports: it is the one place SENTRY_ENVIRONMENT is
  // set (production.env on the Oracle server). A dev server, or a local
  // production build run for audits, sends nothing, so a half-saved file on a
  // laptop never becomes a new issue and an email (Sep 29 2026: every new
  // issue in two days came from development or the old staging server).
  enabled: Boolean(process.env.SENTRY_ENVIRONMENT),
  environment: process.env.SENTRY_ENVIRONMENT,
  release: process.env.VERCEL_GIT_COMMIT_SHA,

  // What Sentry may collect: no request body, cookie or IP address (src/lib/sentryDataCollection.ts).
  dataCollection: SENTRY_DATA_COLLECTION,

  // Performance monitoring - sample 10% of traces in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Spans are streamed as they end, and beforeSendSpan below takes that format. Set here rather than left to the
  // default, so SENTRY_TRACE_LIFECYCLE=static in an environment file can't switch formats and skip the callback.
  traceLifecycle: "stream",

  // Debug mode (very noisy — only enable when troubleshooting Sentry itself)
  debug: false,

  // Filter out noisy errors
  ignoreErrors: [
    // Next.js internal errors that are not actionable
    "NEXT_NOT_FOUND",
    "NEXT_REDIRECT",
  ],

  // A stranger's POST to a page (a scanner, a broken client) is not an error of ours: src/lib/exceptionNoise.ts.
  // Nothing sent carries a shared recruitment record's key: an error's request URL and path, a span's name and URL
  // and a log line all name the page by its address (scrubShareKeys, src/lib/sentryRedact.ts), and every envelope is
  // scrubbed again as it goes (scrubShareKeysOnSend, below).
  beforeSend: (event) => (serverEventFromStrayPost(event) ? null : budget.error(scrubShareKeys(event))),
  beforeSendSpan: (span) => scrubShareKeys(span),
  beforeSendLog: (log) => budget.log(scrubShareKeys(log)),

  integrations: [
    // Forward console.warn and console.error to Sentry Logs. This integration is what turns logs on: there is no
    // separate switch.
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    // No request body ever reaches Sentry. The SDK's default ("medium") attaches up to 10 KB of the body to an error
    // in that request, which here includes a sign-in's email and password. disableIncomingRequestSpans is the Next.js
    // SDK's own setting for this integration (Next traces requests itself), kept because this entry replaces its own.
    Sentry.httpIntegration({ disableIncomingRequestSpans: true, maxRequestBodySize: "none" }),
  ],
});

scrubShareKeysOnSend(Sentry.getClient());
