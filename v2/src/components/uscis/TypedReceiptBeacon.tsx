"use client";

import { useEffect } from "react";

import { convexSiteUrl } from "@/lib/convexSite";

/**
 * Sends a looked-up receipt number to the sample's list, once per number per browser tab (the Privacy Policy, "Our
 * sample of USCIS cases": a typed number joins the numbers the sample checks each week, with the numbers around it).
 * Only the number goes; nothing is drawn. A failed send changes nothing on the page, and the next lookup tries again.
 */
export function TypedReceiptBeacon({ receipt }: { receipt: string }) {
  useEffect(() => {
    if (!/^[A-Z]{3}\d{10}$/.test(receipt)) return;
    const endpoint = convexSiteUrl("/uscis-typed");
    if (!endpoint) return;
    const key = `ptTyped:${receipt}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
    } catch {
      // Storage refused (a private window): send anyway; the backend keeps one row per number.
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt }),
      keepalive: true,
    })
      .then((r) => {
        if (!r.ok) return;
        try {
          window.sessionStorage.setItem(key, "1");
        } catch {
          // Nothing to remember it in; a repeat send only moves the number's last-typed time.
        }
      })
      .catch(() => {});
  }, [receipt]);
  return null;
}
