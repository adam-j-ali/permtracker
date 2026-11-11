"use client";

/**
 * The browser's side of a shared timeline: the edit key it keeps, and the three calls it makes
 * (convex/http.ts, "/timeline/save", "/timeline/mine", "/timeline/remove").
 *
 * ONE KEY, ONE TIMELINE. The key lives in localStorage under `pt-timeline-key` (this browser's own timeline) and,
 * when the timeline names a PERM case, also under `pt-timeline-key:<case>`, which is where a case's page has
 * always looked. Both hold the same key, so a timeline saved on an office's page opens on its case's page and the
 * other way round. Without storage (a private window) the key lasts the visit.
 *
 * The key is a secret: whoever holds it can change or remove the timeline. It's never put in an address, so it
 * can't reach a log, a referrer or the analytics. Moving it to another device is a copy and a paste.
 *
 * Browser only (it reads localStorage and posts from the page), which is what the directive above says.
 */

import type { TimelineInput, TimelineStatus } from "@/lib/communityTimeline";
import { convexSiteUrl } from "@/lib/convexSite";

const OWN = "pt-timeline-key";
const forCase = (c: string) => `${OWN}:${c}`;

export const isEditKey = (k: unknown): k is string => typeof k === "string" && /^[0-9a-f]{64}$/.test(k);

function read(name: string): string | null {
  try {
    const k = window.localStorage.getItem(name);
    return isEditKey(k) ? k : null;
  } catch {
    return null;
  }
}

function write(name: string, k: string | null): void {
  try {
    if (k) window.localStorage.setItem(name, k);
    else window.localStorage.removeItem(name);
  } catch {
    // Private windows and blocked storage: the key lives for this visit only.
  }
}

/** The key kept for one case's page, if this browser saved a timeline there. */
export function caseKey(caseNumber: string): string | null {
  return read(forCase(caseNumber));
}

/**
 * This browser's own timeline key. A browser that saved one on a case's page before Nov 11 2026 holds it only
 * under that case, so the first such key is taken as its own.
 */
export function ownKey(): string | null {
  const own = read(OWN);
  if (own) return own;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const name = window.localStorage.key(i);
      if (name?.startsWith(`${OWN}:`)) {
        const k = read(name);
        if (k) return k;
      }
    }
  } catch {
    // No storage: no saved key.
  }
  return null;
}

/** Keep a key after a save: as this browser's own, and under the case when the timeline names one. */
export function rememberKey(k: string, caseNumber: string | null): void {
  if (!read(OWN)) write(OWN, k);
  if (caseNumber) write(forCase(caseNumber), k);
}

/** Use a key typed in from another device as this browser's own. */
export function adoptKey(k: string): void {
  write(OWN, k);
}

/** Drop a key after its timeline is removed, wherever it was kept. */
export function forgetKey(k: string): void {
  try {
    const names: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const name = window.localStorage.key(i);
      if (name && (name === OWN || name.startsWith(`${OWN}:`)) && window.localStorage.getItem(name) === k) names.push(name);
    }
    for (const name of names) window.localStorage.removeItem(name);
  } catch {
    // Nothing kept, nothing to drop.
  }
}

export function newKey(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The caller's own saved timeline, as the server holds it. */
export interface Mine {
  input: TimelineInput;
  /** The PERM case it names, or null. Absent from a backend older than Nov 11 2026. */
  caseNumber?: string | null;
  /** Where it stands with the review. Absent from an older backend, where every timeline showed at once. */
  status?: TimelineStatus;
  permFiledOn: string | null;
  permCertifiedOn: string | null;
}

export interface SaveReply {
  ok: boolean;
  message: string;
  status?: TimelineStatus;
}

const DROPPED = "That didn't go through, which usually means the connection dropped.";

async function post<T>(path: `/${string}`, body: Record<string, unknown>): Promise<{ res: Response; body: T | null } | null> {
  const url = convexSiteUrl(path);
  if (!url) return null;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, body: (await res.json().catch(() => null)) as T | null };
}

/** Whether this build can reach the backend at all; a form renders nothing when it can't. */
export const canShare = (): boolean => convexSiteUrl("/timeline/save") !== null;

/** Read the timeline a key opens. `caseNumber` narrows it to that case. Null when there's none, or the read failed. */
export async function loadMine(key: string, caseNumber?: string): Promise<Mine | null> {
  try {
    const r = await post<{ mine: Mine | null }>("/timeline/mine", { key, ...(caseNumber ? { caseNumber } : {}) });
    return r?.res.ok ? (r.body?.mine ?? null) : null;
  } catch {
    return null;
  }
}

export async function saveTimeline(key: string, caseNumber: string | null, form: TimelineInput): Promise<SaveReply> {
  try {
    const r = await post<SaveReply>("/timeline/save", { key, ...(caseNumber ? { caseNumber } : {}), ...form });
    if (!r) return { ok: false, message: DROPPED };
    const ok = r.res.ok && r.body?.ok === true;
    return { ok, message: r.body?.message ?? "That didn't go through. Try again in a moment.", status: r.body?.status };
  } catch {
    return { ok: false, message: DROPPED };
  }
}

export async function removeTimeline(key: string, caseNumber?: string): Promise<SaveReply> {
  try {
    const r = await post<SaveReply>("/timeline/remove", { key, ...(caseNumber ? { caseNumber } : {}) });
    if (!r) return { ok: false, message: DROPPED };
    return { ok: r.res.ok, message: r.body?.message ?? "That didn't go through." };
  } catch {
    return { ok: false, message: DROPPED };
  }
}

/** What a saved timeline's author is told about the review, by its status. Null for one that's showing. */
export function statusNote(status: TimelineStatus | undefined): string | null {
  if (status === "pending") return "Waiting for review. It shows on the site once we've checked it, usually within a day.";
  if (status === "declined") return "This timeline isn't showing: its dates didn't look right to us. Fix them and save, and we'll look again.";
  return null;
}
