"use client";

import { useEffect, useRef } from "react";

import { trackCaseNotFound } from "@/lib/funnelEvents";

/**
 * Sends `case_not_found` once, when a lookup ends with no record. Until Nov 11 2026 nothing was sent for this
 * ending, so the share of typed case numbers that find nothing couldn't be counted. It renders nothing.
 */
export function CaseNotFoundSeen({ why, format }: { why: "none" | "gap"; format: "current" | "legacy" | "unreadable" }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackCaseNotFound(why, format);
  }, [why, format]);
  return null;
}
