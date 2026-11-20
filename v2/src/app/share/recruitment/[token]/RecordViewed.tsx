"use client";

import { useEffect } from "react";
import { ConvexHttpClient } from "convex/browser";

import { api } from "@convex/_generated/api";

/**
 * Notes the day this shared record was opened (recruitmentShares.recordView), for the attorney's office to see on
 * the case. It runs in the browser once the page has loaded, never in the request for the page, so a mail scanner
 * that fetches the link writes nothing. Best effort: the page is the same whether or not the note is saved.
 */
export function RecordViewed({ token }: { token: string }) {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return;
    // A note the office reads later: a failed save changes nothing on this page, so it isn't shown to the reader.
    new ConvexHttpClient(url).mutation(api.recruitmentShares.recordView, { token }).catch(() => {});
  }, [token]);
  return null;
}
