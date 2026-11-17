/**
 * Read what a person copies from their own USCIS online account, in their browser only: the case data their browser
 * received (JSON) or the updates as text. Nothing here sends, stores or logs anything; the page that uses it keeps it
 * that way, and a test holds it.
 *
 * USCIS publishes no format for this data, so the reader looks for its shape rather than for fixed names: an object
 * carrying a receipt number and a form is a case; a list of objects each carrying a code and a date is that case's
 * updates. A pasted text is read line by line: a line holding a date and a code the form lists is an update.
 *
 * A receipt number is never kept whole: the reader returns it masked, with the center its letters name.
 */
import {
  ACCOUNT_CODES,
  I485_CENTERS,
  MAX_ACCOUNT_EVENTS,
  TYPED_CODE,
  type EventFormId,
  type TimelineInput,
} from "@/lib/communityTimeline";
import { RECEIPT_PREFIXES, decodeReceipt } from "@/lib/uscis/receipt";

export interface ReadUpdate {
  /** The Eastern day the update shows. */
  on: string;
  code: string | null;
}

export interface ReadCase {
  /** The receipt, masked: the three letters and the last four digits. Null when the data named none. */
  receipt: string | null;
  /** The form as the data names it ("I-485"), and the timeline form's id for it when it records that form. */
  formLabel: string | null;
  form: EventFormId | null;
  /** The service center the receipt's letters name, as one of the six centers' codes; null for IOE and the rest. */
  center: string | null;
  /** The day USCIS received it, when the data says. */
  receivedOn: string | null;
  updates: ReadUpdate[];
}

export interface ReadResult {
  kind: "json" | "text" | "none";
  cases: ReadCase[];
}

const RECEIPT = /\b([A-Z]{3})(\d{10})\b/;
const FORM = /^I-?(\d{3})([A-Z])?$/i;
const FORM_IN_TEXT = /\bI-?(\d{3})([A-Z])?\b/i;
const LISTED = new Set<string>(ACCOUNT_CODES);

/** "I-485" (or "I485", "I-485J") to the timeline form's id, when it records that form. */
export function formIdOf(label: string | null): EventFormId | null {
  const m = label ? FORM.exec(label.trim()) : null;
  if (!m) return null;
  const id = `i${m[1]}${(m[2] ?? "").toLowerCase()}`;
  return id === "i140" || id === "i485" || id === "i765" || id === "i131" || id === "i485j" ? id : null;
}

/** The six centers by the name their receipt letters carry (src/lib/uscis/receipt.ts), so neither list is copied. */
function centerOf(prefix: string | null): string | null {
  const name = prefix ? RECEIPT_PREFIXES[prefix]?.name : undefined;
  return (name && I485_CENTERS.find((c) => c.label === name)?.id) || null;
}

function mask(receipt: string): string {
  return `${receipt.slice(0, 3)}••••••${receipt.slice(-4)}`;
}

/**
 * A date or timestamp to the Eastern calendar day: "2026-06-01T03:10:00Z" was May 31 in Washington. A bare day stays
 * as written. Null for anything that isn't a date.
 */
export function easternDay(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = typeof raw === "number" ? raw : Date.parse(s);
  if (!Number.isFinite(t) || t < Date.UTC(2005, 0, 1)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : null;
}

const codeOf = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return TYPED_CODE.test(c) ? c : null;
};

const isCodeKey = (k: string) => /^(event|action|history)?_?code$|eventcode|actioncode/i.test(k);
const isDateKey = (k: string) => /date|time|timestamp|created|updated/i.test(k);
const isFormKey = (k: string) => /^form(type|number|name|_type|_number)?$/i.test(k);
const isReceivedKey = (k: string) => /submi|received|filed|receipt_?date|receiptdate/i.test(k);

/** One update from an object, when it carries a code and a date. */
function updateOf(o: Record<string, unknown>): ReadUpdate | null {
  let code: string | null = null;
  let on: string | null = null;
  for (const [k, v] of Object.entries(o)) {
    if (code === null && isCodeKey(k)) code = codeOf(v);
    if (on === null && isDateKey(k)) on = easternDay(v);
  }
  return code !== null && on !== null ? { on, code } : null;
}

function readJson(value: unknown): ReadCase[] {
  const cases: ReadCase[] = [];
  const walk = (node: unknown, inherited: ReadCase | null): void => {
    if (Array.isArray(node)) {
      for (const x of node) walk(x, inherited);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const o = node as Record<string, unknown>;
    let here = inherited;
    const update = updateOf(o);
    const receiptRaw = Object.values(o).find((v) => typeof v === "string" && RECEIPT.test(v.toUpperCase()));
    const formRaw = Object.entries(o).find(([k, v]) => isFormKey(k) && typeof v === "string" && FORM.test(v.trim()))?.[1] as string | undefined;
    // A case is an object naming a receipt or a form and carrying no code itself; an update may repeat its case's
    // receipt or form, and stays that case's update.
    if (!update && (receiptRaw !== undefined || formRaw !== undefined)) {
      const decoded = typeof receiptRaw === "string" ? decodeReceipt(RECEIPT.exec(receiptRaw.toUpperCase())![0]) : null;
      const receivedRaw = Object.entries(o).find(([k]) => isReceivedKey(k))?.[1];
      const formLabel = formRaw ? formRaw.trim().toUpperCase().replace(/^I(\d)/, "I-$1") : null;
      here = {
        receipt: decoded ? mask(decoded.receipt) : null,
        formLabel,
        form: formIdOf(formLabel),
        center: decoded ? centerOf(decoded.prefix) : null,
        receivedOn: easternDay(receivedRaw),
        updates: [],
      };
      cases.push(here);
    }
    if (update) {
      if (!here) {
        here = { receipt: null, formLabel: null, form: null, center: null, receivedOn: null, updates: [] };
        cases.push(here);
      }
      here.updates.push(update);
      return;
    }
    for (const v of Object.values(o)) walk(v, here);
  };
  walk(value, null);
  return cases;
}

/** A day written in a line of text, either way round. A time after it is left out: a line gives its day as shown. */
const ISO_DAY_IN_TEXT = /\b\d{4}-\d{2}-\d{2}/;
const US_DAY_IN_TEXT = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;

function readText(text: string): ReadCase[] {
  const byForm = new Map<string, ReadCase>();
  for (const line of text.split(/\r?\n/)) {
    const date = ISO_DAY_IN_TEXT.exec(line) ?? US_DAY_IN_TEXT.exec(line);
    if (!date) continue;
    const on = easternDay(date[0]);
    if (!on) continue;
    // In free text only a code the form lists counts: "EAD" or "USCIS" on the line isn't a code.
    const code = [...line.toUpperCase().matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)].map((m) => m[0]).find((t) => LISTED.has(t)) ?? null;
    if (!code) continue;
    const formMatch = FORM_IN_TEXT.exec(line);
    const formLabel = formMatch ? `I-${formMatch[1]}${(formMatch[2] ?? "").toUpperCase()}` : null;
    const key = formLabel ?? "";
    const c = byForm.get(key) ?? { receipt: null, formLabel, form: formIdOf(formLabel), center: null, receivedOn: null, updates: [] };
    c.updates.push({ on, code });
    byForm.set(key, c);
  }
  return [...byForm.values()];
}

function tidy(found: ReadCase[]): ReadCase[] {
  // One case per receipt: the same receipt read twice (a summary and its detail) is one case.
  const merged: ReadCase[] = [];
  for (const c of found) {
    const same = c.receipt ? merged.find((m) => m.receipt === c.receipt) : undefined;
    if (!same) {
      merged.push({ ...c, updates: [...c.updates] });
      continue;
    }
    same.updates.push(...c.updates);
    same.formLabel ??= c.formLabel;
    same.form ??= c.form;
    same.center ??= c.center;
    same.receivedOn ??= c.receivedOn;
  }
  return merged
    .map((c) => {
      const seen = new Map(c.updates.map((u) => [`${u.on}|${u.code ?? ""}`, u]));
      return { ...c, updates: [...seen.values()].sort((a, b) => a.on.localeCompare(b.on) || (a.code ?? "").localeCompare(b.code ?? "")) };
    })
    .filter((c) => c.updates.length > 0 || c.receipt !== null);
}

/** The most of a paste the reader reads: a case's data runs to tens of thousands of characters, never millions. */
export const MAX_PASTE = 1_000_000;

/** Read a paste. Never throws: data it can't read comes back as `kind: "none"`. */
export function readAccount(text: string): ReadResult {
  const trimmed = text.slice(0, MAX_PASTE).trim();
  if (trimmed === "") return { kind: "none", cases: [] };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const cases = tidy(readJson(JSON.parse(trimmed)));
      return cases.length > 0 ? { kind: "json", cases } : { kind: "none", cases: [] };
    } catch {
      // Not JSON after all: read it as text.
    }
  }
  const cases = tidy(readText(trimmed));
  return cases.length > 0 ? { kind: "text", cases } : { kind: "none", cases: [] };
}

/** Whether a code is one the form lists. */
export const isListed = (code: string): boolean => LISTED.has(code);

/**
 * What the timeline form takes from a reading: every update (on its form when the timeline records that form), the
 * newest MAX_ACCOUNT_EVENTS of them, and the I-485's center and the day USCIS received it. Never a receipt number.
 */
export function timelineFrom(cases: readonly ReadCase[]): TimelineInput {
  const events = cases
    .flatMap((c) => c.updates.map((u) => ({ on: u.on, form: c.form, code: u.code })))
    .sort((a, b) => a.on.localeCompare(b.on))
    .slice(-MAX_ACCOUNT_EVENTS);
  const i485 = cases.find((c) => c.form === "i485");
  return {
    route: "adjustment",
    ...(events.length > 0 ? { accountEvents: events } : {}),
    ...(i485?.center ? { i485Center: i485.center } : {}),
    ...(i485?.receivedOn ? { i485FiledOn: i485.receivedOn } : {}),
  };
}
