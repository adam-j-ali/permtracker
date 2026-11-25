"use client";

import { useCallback, useEffect, useRef } from "react";

import { analytics } from "@/lib/analytics";
import { redactIdentifiers } from "@/lib/analyticsRedact";
import type { AlertSignupKind } from "@/lib/alertSignupEvent";
import { normaliseCaseNumber } from "@/lib/caseNumberShape";
import { looksLikeReceipt } from "@/lib/uscis/receipt";
import { ISO_MONTH_RE } from "@convex/lib/months";

/**
 * The funnel's events: what people look up, how they search, whether they see
 * an alert form and start it, and whether they're shown an estimate.
 *
 * NOTHING TYPED IS SENT, with one exception. A case number, receipt, name or
 * email never leaves the browser through these: a lookup sends the SHAPE of
 * what was typed ("case", "receipt", "month", "name"), a result click sends its
 * group and position. Those are enough to count the funnel and to tell whether
 * a box is being used for what it's for. The exception is `search_miss`: the
 * words of a site search that found nothing, cut to 60 characters, and only
 * when they can't be a number or an address (searchMissText says which).
 */

export type QueryShape = "empty" | "case" | "case-undashed" | "receipt" | "month" | "name";

/** A case number typed without its dashes: G10026254230507, JOA30026271264525. */
const UNDASHED = /^(?:[A-Z]|JOA)\d{14,}$/;

/** What kind of thing a search box was given, without the thing itself. */
export function queryShape(raw: string): QueryShape {
  const q = raw.trim();
  if (q.length === 0) return "empty";
  if (ISO_MONTH_RE.test(q)) return "month";
  if (looksLikeReceipt(q)) return "receipt";
  // The box reads a number with or without its dashes (the paste tidy), but counting the ones typed without any
  // shows how often people leave them out. A typographic dash or a minus sign counts as a dash typed.
  if (normaliseCaseNumber(q) !== null) return /[-\u2010-\u2015\u2212]/.test(q) ? "case" : "case-undashed";
  if (UNDASHED.test(q.toUpperCase().replace(/[\s-]/g, ""))) return "case-undashed";
  return "name";
}

/** A case-number box was submitted. `source` names the page or box. */
export function trackLookup(source: string, raw: string): void {
  analytics.capture("case_lookup_submitted", { source, shape: queryShape(raw) });
}

/**
 * A case number was looked up and we hold no record of it. `why` is "none" (DOL's own search was asked and holds
 * none either) or "gap" (the live check couldn't be made, so the page says it doesn't know). `format` says whether
 * the number is in the current form or the older one. Never the number.
 */
export function trackCaseNotFound(why: "none" | "gap", format: "current" | "legacy" | "unreadable"): void {
  analytics.capture("case_not_found", { why, format });
}

/**
 * Someone on a certified case's page said they want USCIS case tracking: "pressed" when they press the question's
 * button (once per browser), "signed" when they send the alert form with the USCIS box ticked. The count of
 * presses against the people who saw the form is the measure; nothing about the person or the case is sent.
 */
export function trackUscisInterest(step: "pressed" | "signed", source: string): void {
  analytics.capture("uscis_interest", { step, source });
}

/**
 * The no-number finder answered: an employer's name and a filing day were read against that
 * day's list. `found` is how it ended ("cases", "close-names" or "none"), never the name.
 */
export function trackFinder(source: string, program: string, found: "cases" | "close-names" | "none"): void {
  analytics.capture("case_finder_answered", { source, program, found });
}

/** A site-wide search box (header, palette, /case-search) was submitted. */
export function trackSiteSearch(surface: string, raw: string): void {
  analytics.capture("site_search_submitted", { surface, shape: queryShape(raw) });
}

/** The most of a missed search's words that are sent. */
export const SEARCH_MISS_MAX = 60;
/** A search with this many digits or more could be a case, receipt, phone or A-number: it isn't sent. */
const MISS_DIGITS_MAX = 7;

/**
 * The words a site search that found nothing sends: trimmed, one space between words, cut to SEARCH_MISS_MAX
 * characters. Null for anything that could identify a filing or a person: a case number, a receipt or a month
 * (each has its own row, so it never misses), seven or more digits, or an email address. What people look for and
 * don't find is what the search should learn next.
 */
export function searchMissText(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, " ");
  if (q.length < 3 || queryShape(q) !== "name" || looksLikeReceipt(q)) return null;
  if ((q.match(/\d/g) ?? []).length >= MISS_DIGITS_MAX) return null;
  if (redactIdentifiers(q) !== q) return null;
  return q.slice(0, SEARCH_MISS_MAX);
}

/** A site search found nothing: its words go (searchMissText), and nothing else. */
export function trackSearchMiss(raw: string): void {
  const query = searchMissText(raw);
  if (query !== null) analytics.capture("search_miss", { query });
}

/** The search palette opened; `trigger` is "shortcut" or "button". */
export function trackPaletteOpened(trigger: "shortcut" | "button"): void {
  analytics.capture("palette_opened", { trigger });
}

/**
 * What kind of place a search result leads to, read from its address so no
 * name or number goes with the event.
 */
export function hrefGroup(href: string): string {
  const path = href.split(/[?#]/)[0] ?? "";
  if (path === "/perm-case-status" || path === "/uscis-case-status") return "case";
  if (path.startsWith("/tools/perm-timeline-calculator")) return "estimate";
  if (/^\/perm-employers\/[^/]+$/.test(path) && !["/perm-employers/compare", "/perm-employers/under-review"].includes(path)) return "employer";
  if (/^\/perm-attorneys\/[^/]+$/.test(path)) return "firm";
  if (/^\/perm-wages\/[^/]+$/.test(path)) return "job";
  if (path === "/case-search") return "all-results";
  if (/^\/(blog|guides|changelog)\//.test(path)) return "article";
  return "page";
}

/** A palette row was chosen; only the kind of place it leads to is sent. */
export function trackPaletteSelected(href: string): void {
  analytics.capture("palette_selected", { group: hrefGroup(href) });
}

/** A result on a results page was opened. */
export function trackSearchResultClicked(surface: string, group: string, position: number): void {
  analytics.capture("search_result_clicked", { surface, group, position });
}

/** A case estimate was shown, and which model dated it. */
export function trackEstimateShown(model: string, dated: boolean, source: string): void {
  analytics.capture("estimate_shown", { model, dated, source });
}

/**
 * An alert form's two quiet events: it came into view (once per mount), and
 * someone started it (first focus inside, once per mount). Together with
 * `alert_signup` they show where people drop: never saw it, saw it and didn't
 * start, or started and didn't finish.
 *
 * Returns a ref for the form's outer element and a focus handler for it.
 */
export function useAlertFormTelemetry(kind: AlertSignupKind, source?: string) {
  const ref = useRef<HTMLElement | null>(null);
  const seen = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !seen.current) {
          seen.current = true;
          analytics.capture("alert_form_viewed", { kind, source });
          io.disconnect();
        }
      },
      // Half the form on screen counts as seen; a sliver at the bottom doesn't.
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [kind, source]);

  const onFocusCapture = useCallback(() => {
    if (started.current) return;
    started.current = true;
    analytics.capture("alert_form_started", { kind, source });
  }, [kind, source]);

  const setRef = useCallback((el: HTMLElement | null) => {
    ref.current = el;
  }, []);

  return { observe: setRef, onFocusCapture };
}
