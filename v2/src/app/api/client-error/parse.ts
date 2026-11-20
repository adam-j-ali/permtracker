/**
 * What an error screen reports to /api/client-error, checked. The screens that
 * catch a crash reload or redirect within a second (reported Oct 31 2026: gone too fast
 * to capture), and PostHog is off for staff
 * and Sentry isn't loaded on the sign-in pages, so they also tell our own server.
 *
 * Only these fields, each capped, and the path without its query string, so a
 * case number or a token in an address never reaches the log. A shared
 * recruitment record's key (/share/recruitment/<key>) is blanked wherever it
 * appears, in the path, the message or the stack: the error screen there is the
 * root one, and the Privacy Policy keeps only a one-way hash of the key.
 */
import { redactShareKey } from "@/lib/analyticsRedact";

export const OUTCOMES = ["shown", "reload", "redirect-login", "reload-stale"] as const;

/**
 * The error screens that report here (logClientError's callers). Anything else is
 * a stranger's body, refused before it reaches the log or Sentry.
 */
export const BOUNDARIES = ["GlobalError", "RouteError", "PublicDataError"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface ClientErrorReport {
  boundary: string;
  outcome: Outcome;
  name: string;
  message: string;
  digest: string | null;
  path: string;
  stack: string | null;
}

/** The most bytes a report may carry. */
export const MAX_BODY = 4096;

const cut = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

/** The report, or null when it isn't one. */
export function parseClientError(body: unknown): ClientErrorReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const boundary = BOUNDARIES.find((x) => x === b.boundary);
  if (!boundary) return null;
  const outcome = OUTCOMES.find((o) => o === b.outcome);
  if (!outcome) return null;
  const path = cut(b.path, 200);
  if (!path || !path.startsWith("/")) return null;
  return {
    boundary,
    outcome,
    name: cut(b.name, 60) ?? "Error",
    message: redactShareKey(cut(b.message, 300) ?? ""),
    digest: cut(b.digest, 40),
    path: redactShareKey(path.split(/[?#]/)[0] ?? path),
    stack: typeof b.stack === "string" ? redactShareKey(b.stack.slice(0, 1500)) : null,
  };
}

/**
 * The message with what changes between reports taken out (addresses, build
 * hashes, numbers), so one kind of error is one Sentry issue. Before this a
 * failed download of chunk 6020 and one of chunk 8174 were two issues and two
 * alert emails, as was the same chunk in two builds (Nov 1 2026: five in a day).
 */
export function groupingKey(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hash>")
    .replace(/\d+/g, "#")
    .slice(0, 160);
}

/**
 * React's "Connection closed." (error 412 in a production build, by React's own list of codes): the page's data
 * stream ended early on the visitor's side, on a dropped connection or a tab put away mid-load. The screen
 * reloads, and nothing in the site's code is at fault.
 */
export function isConnectionClosed(message: string): boolean {
  return /\bMinified React error #412(?!\d)/.test(message) || /^(?:Error: )?Connection closed\.?$/.test(message.trim());
}

/**
 * A request the visitor's connection dropped, in each browser's own bare words: Safari's "Load failed", Chrome's
 * "Failed to fetch", Firefox's "NetworkError when attempting to fetch resource.", and "network error" for a response
 * cut while its body was still being read (Huawei Browser 132 on Android, Sentry 64, Nov 20 2026, the screen's reload
 * curing it both times). Anchored, so a message that says more ("Failed to fetch dynamically imported module: ...")
 * is a build-file fault and keeps its own handling.
 */
export function isDroppedRequest(message: string): boolean {
  return /^(?:TypeError: )?(?:Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.?|network error)$/.test(
    message.trim(),
  );
}

/**
 * The build file a ChunkLoadError names, as its path under /_next/static/, or
 * null. Only a file in chunks/ or css/ passes, so the route can look for it on
 * disk without the message choosing where to look. Folder names may carry
 * Next's route groups and dynamic segments ("(site)", "[slug]", percent-encoded
 * or not): a chunk under chunks/app/(site)/ had opened its own error issue
 * (Nov 2 2026).
 */
export function chunkFileOf(message: string): string | null {
  const m = /\/_next\/static\/((?:chunks|css)\/(?:[\w()[\]%@.-]+\/)*[\w.-]+\.(?:js|css))(?:[?\s)]|$)/.exec(message);
  if (!m || !/chunk/i.test(message)) return null;
  let file: string;
  try {
    file = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  if (file.includes("..") || file.includes("\\") || !/^(?:chunks|css)\/[\w()[\]@.\/-]+$/.test(file)) return null;
  return file;
}

/**
 * The build a ChunkLoadError's file belongs to, from its `?dpl=` (the deployment id Next puts on every build
 * file), or null. A page from an older build than the live one asks for that build's files.
 */
export function dplOf(message: string): string | null {
  const m = /[?&]dpl=([\w.-]{1,120})/.exec(message);
  return m ? m[1]! : null;
}
