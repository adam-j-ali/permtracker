/**
 * USCIS receipt numbers: the shape, the prefixes, and what the digits are
 * commonly read as.
 *
 * This module is CLIENT-SAFE and pure, the same way `caseNumberShape.ts` is
 * for DOL numbers: the lookup form uses it to say "that is a USCIS number,
 * not a DOL one" before a round trip, and the server uses the same rule to
 * route. It is deliberately separate from `permCaseNumber.ts`: a DOL case
 * number (`G-100-26125-868956`) and a USCIS receipt (`EAC3512345678`) are
 * different agencies, different records and different lookups, and one
 * parser that accepts both would let a P-100 row leak into the PERM table.
 *
 * ## What is primary-sourced and what is convention
 *
 * USCIS's own glossary (uscis.gov/tools/glossary, entry "Receipt Number")
 * says, verbatim: "The receipt number consists of 3 letters, such as EAC,
 * WAC, LIN, SRC, NBC, MSC or IOE, with 10 numbers." The Case Status API's
 * OpenAPI spec (developer.uscis.gov) gives
 * the validation regex as `[a-zA-Z]{3}[0-9]{10}` and, for masked numbers,
 * `[a-zA-Z]{3}\*[0-9]{9}`, and answers 422 to anything else.
 *
 * What USCIS does NOT document anywhere we could find is what the ten digits
 * mean. Three readings, from practitioners' guides and 873 numbers on real
 * notices (Nov 22 2026), each labelled where it's shown:
 * - the day series, `YY` fiscal year + `DDD` day of that year + `NNNNN`
 *   sequence, the practitioners' convention;
 * - the lockbox series, `YY` + `9` + a seven-digit counter for the year, our
 *   reading of notices (no day of a year is 900 or more);
 * - online (IOE) numbers, one running count that names no year or day.
 * Digits that fit none of them get no reading: a wrong "filed in FY2021" is
 * worse than no year, the same rule the DOL parser applies to legacy numbers.
 */

/** The canonical 13-character shape, upper-cased, no separators. */
const FULL = /^[A-Z]{3}\d{10}$/;

/** USCIS's masked form: three letters, an asterisk, nine digits. */
const MASKED = /^[A-Z]{3}\*\d{9}$/;
/** Spaces, hyphens, the Unicode dashes and dots, which a pasted number often carries. */
const TYPED_NOISE = /[\s\-\u2010-\u2015.]+/g;
/** A label pasted in front: "Receipt number:", "Receipt #", "USCIS receipt no.". Whole words only (Batch 5, Nov 25 2026). */
const RECEIPT_LABEL = /^\s*(?:USCIS\s+)?RECEIPT\b(?:\s*(?:NUMBER|NO\.?|#))?\s*[:#.]?\s*/i;
/** What was typed, without a pasted label, upper-cased, with the noise the box strips taken out. */
const typedReceipt = (input: string) => input.replace(RECEIPT_LABEL, "").toUpperCase().replace(TYPED_NOISE, "");

export interface ReceiptPrefix {
  /** The office the prefix names. */
  name: string;
  /** Where the attribution comes from. "glossary" is USCIS's own list. */
  source: "glossary" | "notices";
  /** Anything a reader should know about this prefix. */
  note?: string;
}

/**
 * The prefixes. The seven marked "glossary" are the ones USCIS lists by
 * name; YSC appears on real notices from the Potomac Service Center but is
 * absent from the glossary's list, so it is attributed to notices rather
 * than to USCIS's definition. Any three letters are still ACCEPTED as a
 * shape, because USCIS's own regex accepts them and a new center would
 * otherwise be unenterable here.
 */
export const RECEIPT_PREFIXES: Readonly<Record<string, ReceiptPrefix>> = {
  EAC: { name: "Vermont Service Center", source: "glossary", note: "The letters stand for Eastern Adjudication Center, the center's old name." },
  WAC: { name: "California Service Center", source: "glossary", note: "Western Adjudication Center, the old name." },
  LIN: { name: "Nebraska Service Center", source: "glossary", note: "Lincoln, where the center sits." },
  SRC: { name: "Texas Service Center", source: "glossary", note: "Southern Regional Center, the old name." },
  NBC: { name: "National Benefits Center", source: "glossary", note: "Cases that end at a field office, including most I-485 adjustment filings." },
  MSC: { name: "National Benefits Center", source: "glossary", note: "Missouri Service Center, the center's earlier name. It's still issued." },
  IOE: {
    name: "USCIS online filing (ELIS)",
    source: "glossary",
    note: "Filed through a USCIS online account. The Case Status API returns no filing or modified date for IOE receipts.",
  },
  YSC: { name: "Potomac Service Center", source: "notices" },
};

/** Whether this text is a USCIS receipt by shape, ignoring case, spaces and dashes. */
export function normaliseReceipt(input: string): string | null {
  // The same noise the box strips (TYPED_NOISE): a number pasted from a PDF with an en dash or dots read as whole in
  // the box and as malformed here until Nov 25 2026.
  const raw = typedReceipt(input);
  return FULL.test(raw) || MASKED.test(raw) ? raw : null;
}

export interface DecodedReceipt {
  /** The normalised 13-character number. */
  receipt: string;
  /** The three-letter prefix. */
  prefix: string;
  /** USCIS's attribution for the prefix, or null for one we do not know. */
  office: ReceiptPrefix | null;
  /** True for the masked `ABC*123456789` form, which carries no readable digits. */
  masked: boolean;
  /** How the digits read (see the top of this file). */
  digits: ReceiptDigits;
}

/**
 * The reading of the ten digits. `fiscalYear` is the four-digit federal fiscal
 * year the first two digits imply.
 */
export type ReceiptDigits =
  | { series: "day"; fiscalYear: number; day: number; sequence: string }
  | { series: "lockbox"; fiscalYear: number; counter: number }
  | { series: "online" }
  | { series: "masked" }
  | { series: "unread" };

/** The days a fiscal year can have. */
const DAYS_IN_YEAR_MAX = 366;
/** The digit after the year that marks the lockbox series. */
const LOCKBOX_MARK = "9";
const ONLINE_PREFIX = "IOE";

/**
 * Two-digit fiscal years: USCIS issued receipts under this scheme well before 2000, so 90-99 are read as the 1990s and
 * everything else as 2000s. A receipt from 1989 or earlier is not something anyone looks up.
 */
function fiscalYearOf(yy: string): number {
  const n = Number(yy);
  return n >= 90 ? 1900 + n : 2000 + n;
}

function readDigits(receipt: string): ReceiptDigits {
  if (receipt.includes("*")) return { series: "masked" };
  if (receipt.startsWith(ONLINE_PREFIX)) return { series: "online" };
  const fiscalYear = fiscalYearOf(receipt.slice(3, 5));
  if (receipt[5] === LOCKBOX_MARK) return { series: "lockbox", fiscalYear, counter: Number(receipt.slice(6)) };
  const day = Number(receipt.slice(5, 8));
  if (day >= 1 && day <= DAYS_IN_YEAR_MAX) return { series: "day", fiscalYear, day, sequence: receipt.slice(8) };
  return { series: "unread" };
}

/**
 * Decode a receipt into its parts. Shape only; nothing here asks USCIS.
 */
export function decodeReceipt(input: string): DecodedReceipt | null {
  const receipt = normaliseReceipt(input);
  if (!receipt) return null;
  const prefix = receipt.slice(0, 3);
  const office = RECEIPT_PREFIXES[prefix] ?? null;
  return { receipt, prefix, office, masked: receipt.includes("*"), digits: readDigits(receipt) };
}

/**
 * A receipt as far as it's been typed (RT1, Nov 25 2026): what each part already says (the office from three letters,
 * the fiscal year from five, the series from six, the day from eight), the first character that can't belong, a
 * one-character fix for the usual typos, and an A-number recognised as one. Shape only, like decodeReceipt: nothing
 * here asks USCIS, and nothing is read past the first wrong character.
 */
export interface PartialReceipt {
  /** What was typed, upper-cased, without spaces, dashes or dots. */
  typed: string;
  prefix: string | null;
  /** The office the three letters name, or null before three letters or for letters USCIS doesn't list. */
  office: ReceiptPrefix | null;
  /** Three letters that aren't a prefix USCIS lists or one seen on notices. Still accepted, as decodeReceipt does. */
  unknownPrefix: boolean;
  fiscalYear: number | null;
  series: "day" | "lockbox" | "online" | null;
  /** The day the day series names, once its three digits are typed and fall in a year. */
  day: number | null;
  /** Characters a full number still needs. */
  remaining: number;
  /** The first character that can't be part of a receipt, by its position from 1. */
  problem: { position: number; expected: "letter" | "digit" | "end"; got: string } | null;
  /** The number with one usual typo fixed (O for 0, I or L for 1 among the digits; 0 for O, 1 for I among the letters). */
  suggestion: string | null;
  /** Another kind of number this is instead. */
  otherKind: "a-number" | null;
  /** The full decode, once thirteen characters are right. */
  full: DecodedReceipt | null;
}

const RECEIPT_LENGTH = 13;
const PREFIX_LENGTH = 3;
/** An Alien Registration Number: an A and eight or nine digits. */
const A_NUMBER = /^A\d{8,9}$/;
const LETTER_FIXES: Readonly<Record<string, string>> = { "0": "O", "1": "I" };
const DIGIT_FIXES: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" };

function firstProblem(typed: string): PartialReceipt["problem"] {
  for (let i = 0; i < typed.length; i++) {
    const c = typed[i] as string;
    if (i >= RECEIPT_LENGTH) return { position: i + 1, expected: "end", got: c };
    const letter = i < PREFIX_LENGTH;
    if (letter ? !/[A-Z]/.test(c) : !/\d/.test(c)) return { position: i + 1, expected: letter ? "letter" : "digit", got: c };
  }
  return null;
}

function typoFix(typed: string): string | null {
  if (typed.length !== RECEIPT_LENGTH || FULL.test(typed)) return null;
  let fixes = 0;
  let unfixable = false;
  const out = [...typed]
    .map((c, i) => {
      const letter = i < PREFIX_LENGTH;
      if (letter ? /[A-Z]/.test(c) : /\d/.test(c)) return c;
      const fix = (letter ? LETTER_FIXES : DIGIT_FIXES)[c];
      if (!fix) unfixable = true;
      fixes += 1;
      return fix ?? c;
    })
    .join("");
  return !unfixable && fixes === 1 && FULL.test(out) ? out : null;
}

export function readPartialReceipt(input: string): PartialReceipt {
  const typed = typedReceipt(input);
  const masked = MASKED.test(typed);
  const problem = masked || !typed ? null : firstProblem(typed);
  const good = problem ? typed.slice(0, problem.position - 1) : typed;
  const prefix = good.length >= PREFIX_LENGTH ? good.slice(0, PREFIX_LENGTH) : null;
  const office = prefix ? (RECEIPT_PREFIXES[prefix] ?? null) : null;
  const online = prefix === ONLINE_PREFIX;
  const fiscalYear = prefix && !online && good.length >= 5 ? fiscalYearOf(good.slice(3, 5)) : null;
  const series: PartialReceipt["series"] = !prefix ? null : online ? "online" : good.length >= 6 ? (good[5] === LOCKBOX_MARK ? "lockbox" : "day") : null;
  const dayDigits = series === "day" && good.length >= 8 ? Number(good.slice(5, 8)) : null;
  const day = dayDigits !== null && dayDigits >= 1 && dayDigits <= DAYS_IN_YEAR_MAX ? dayDigits : null;
  return {
    typed,
    prefix,
    office,
    unknownPrefix: prefix !== null && office === null,
    fiscalYear,
    series,
    day,
    remaining: Math.max(0, RECEIPT_LENGTH - typed.length),
    problem,
    suggestion: typoFix(typed),
    otherKind: A_NUMBER.test(typed) ? "a-number" : null,
    full: !problem && (masked || typed.length === RECEIPT_LENGTH) ? decodeReceipt(typed) : null,
  };
}

/**
 * Is this plausibly a USCIS receipt someone half-typed, as opposed to a DOL
 * number or an employer name? Three letters then digits, no dashes in the
 * DOL positions. Used by the DOL lookup form to point at the right page
 * BEFORE refusing, since a reader with an I-140 receipt is on the wrong page
 * rather than holding a malformed number.
 */
export function looksLikeReceipt(input: string): boolean {
  const raw = typedReceipt(input);
  return /^[A-Z]{3}\*?\d{4,}$/.test(raw) && !/^[A-Z]-/.test(input.trim().toUpperCase());
}

/**
 * The sentence shown when the shape is wrong. Written once so the client
 * hint and the server notice cannot say different things.
 */
export const RECEIPT_SHAPE_MESSAGE =
  "A USCIS receipt number is three letters and ten digits, like EAC3512345678, with no spaces or dashes. It's on the top of every I-797 notice.";

/** What the characters typed so far say, in one line. The day digits wait for the result, where their caveat is. */
export function receiptReadingLine(r: PartialReceipt): string {
  if (!r.prefix) return "A receipt number is three letters, then ten digits.";
  const parts = [r.office ? r.office.name : `${r.prefix}, letters USCIS doesn't list`];
  if (r.series === "online") parts.push("filed online");
  if (r.fiscalYear !== null) parts.push(`fiscal year ${r.fiscalYear}`);
  if (r.series === "lockbox") parts.push("a lockbox number");
  const left = r.remaining > 0 ? ` ${r.remaining} more ${r.remaining === 1 ? "digit" : "digits"}.` : " Look it up for the rest.";
  return `${parts.join(", ")}.${left}`;
}

/** The first thing wrong with what's typed, by position, or null. */
export function receiptProblemLine(r: PartialReceipt): string | null {
  if (!r.problem) return null;
  if (r.problem.expected === "end") return `That's ${r.typed.length} characters. A receipt number has 13.`;
  return `Character ${r.problem.position} should be a ${r.problem.expected}.`;
}

export const A_NUMBER_MESSAGE =
  "That's an A-number, the number USCIS gives a person. A receipt number names one case: three letters and ten digits, at the top of the I-797 notice.";

/**
 * One reading for every box a receipt is typed in (the lookup box, the app's case form): null for an empty box, a
 * warning for an A-number or the first wrong character, otherwise what the characters so far say.
 */
export function describeTypedReceipt(input: string): { tone: "info" | "warn"; text: string } | null {
  if (input.trim() === "") return null;
  const r = readPartialReceipt(input);
  if (r.otherKind === "a-number") return { tone: "warn", text: A_NUMBER_MESSAGE };
  const problem = receiptProblemLine(r);
  if (problem) return { tone: "warn", text: problem };
  return { tone: "info", text: receiptReadingLine(r) };
}
