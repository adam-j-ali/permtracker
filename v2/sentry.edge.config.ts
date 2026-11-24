/**
 * Sentry Edge Runtime Configuration
 *
 * Initializes Sentry for edge runtime (middleware, edge routes).
 * This file is loaded by the instrumentation hook when running on the edge.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from "@sentry/nextjs";

import { SENTRY_DATA_COLLECTION } from "./src/lib/sentryDataCollection";
import { scrubShareKeys, scrubShareKeysOnSend } from "./src/lib/sentryRedact";

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

  // Spans are streamed, the format beforeSendSpan takes, whatever SENTRY_TRACE_LIFECYCLE says.
  traceLifecycle: "stream",

  // Debug mode (very noisy — only enable when troubleshooting Sentry itself)
  debug: false,

  // Nothing sent carries a shared recruitment record's key (scrubShareKeys, src/lib/sentryRedact.ts), and every
  // envelope is scrubbed again as it goes (scrubShareKeysOnSend, below).
  beforeSend: (event) => scrubShareKeys(event),
  beforeSendSpan: (span) => scrubShareKeys(span),
});

scrubShareKeysOnSend(Sentry.getClient());
