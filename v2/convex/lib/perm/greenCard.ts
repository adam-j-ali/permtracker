/**
 * A case past the I-140: the green card's own steps and the facts that decide its line.
 *
 * SINGLE SOURCE for the names of these fields, the adjustment-or-consulate choice, the preference category with its
 * subclasses, and the country of birth and chargeability. The schema builds its validators from the arrays here; the
 * status calculation, the validator, the form, the export and the bulletin alert all read the helpers.
 *
 * Every field is optional. A case saved before they existed has none of them and keeps the stage it had.
 *
 * @module
 */

import type { CountryKey } from "./calculators/priorityDate";

// ============================================================================
// THE PATH
// ============================================================================

/**
 * How the green card is issued: adjustment of status inside the US (Form I-485) or an immigrant visa at a consulate
 * abroad (the National Visa Center, Form DS-260, the interview).
 */
export const GREEN_CARD_PATHS = ["adjustment", "consular"] as const;
export type GreenCardPath = (typeof GREEN_CARD_PATHS)[number];

export const GREEN_CARD_PATH_LABELS: Record<GreenCardPath, string> = {
  adjustment: "Adjustment of status in the US (I-485)",
  consular: "Immigrant visa at a consulate abroad",
};

export function isGreenCardPath(value: unknown): value is GreenCardPath {
  return typeof value === "string" && (GREEN_CARD_PATHS as readonly string[]).includes(value);
}

// ============================================================================
// THE FIELDS
// ============================================================================

/** The I-485 and the two applications usually filed with it: the work permit (I-765) and travel document (I-131). */
export const ADJUSTMENT_DATE_FIELDS = [
  "i485FilingDate",
  "i485ReceiptDate",
  "i485BiometricsDate",
  "i485InterviewDate",
  "i485ApprovalDate",
  "i485DenialDate",
  "eadFilingDate",
  "eadApprovalDate",
  "apFilingDate",
  "apApprovalDate",
] as const;

/** The consulate's steps: the National Visa Center's case, the DS-260 and the interview. */
export const CONSULAR_DATE_FIELDS = ["nvcReceivedDate", "ds260SubmittedDate", "consularInterviewDate"] as const;

/** The card itself, on either path. */
export const CARD_DATE_FIELDS = ["cardProducedDate", "cardReceivedDate"] as const;

export const GREEN_CARD_DATE_FIELDS = [...ADJUSTMENT_DATE_FIELDS, ...CONSULAR_DATE_FIELDS, ...CARD_DATE_FIELDS] as const;
export type GreenCardDateField = (typeof GREEN_CARD_DATE_FIELDS)[number];

/** USCIS receipt numbers for the three adjustment forms. */
export const GREEN_CARD_RECEIPT_FIELDS = ["i485ReceiptNumber", "eadReceiptNumber", "apReceiptNumber"] as const;
export type GreenCardReceiptField = (typeof GREEN_CARD_RECEIPT_FIELDS)[number];

/** Two-letter country codes (ISO 3166-1 alpha-2). */
export const GREEN_CARD_COUNTRY_FIELDS = ["countryOfBirth", "chargeabilityCountry"] as const;

/** Every text field past the I-140: dates, receipt numbers, countries. Each takes `null` on update to clear it. */
export const GREEN_CARD_TEXT_FIELDS = [
  ...GREEN_CARD_DATE_FIELDS,
  ...GREEN_CARD_RECEIPT_FIELDS,
  ...GREEN_CARD_COUNTRY_FIELDS,
] as const;
export type GreenCardTextField = (typeof GREEN_CARD_TEXT_FIELDS)[number];

/** What each field is called wherever a person reads it: the form, the case page, the timeline, the export. */
export const GREEN_CARD_FIELD_LABELS: Record<GreenCardTextField | "greenCardPath" | "ebCategory", string> = {
  greenCardPath: "Green card path",
  ebCategory: "Preference category",
  countryOfBirth: "Country of birth",
  chargeabilityCountry: "Chargeability country",
  i485FilingDate: "I-485 filed",
  i485ReceiptDate: "I-485 receipt date",
  i485ReceiptNumber: "I-485 receipt number",
  i485BiometricsDate: "I-485 fingerprints (biometrics)",
  i485InterviewDate: "I-485 interview",
  i485ApprovalDate: "I-485 approved",
  i485DenialDate: "I-485 denied",
  eadFilingDate: "Work permit (I-765) filed",
  eadReceiptNumber: "Work permit receipt number",
  eadApprovalDate: "Work permit approved",
  apFilingDate: "Travel document (I-131) filed",
  apReceiptNumber: "Travel document receipt number",
  apApprovalDate: "Travel document approved",
  nvcReceivedDate: "National Visa Center case created",
  ds260SubmittedDate: "DS-260 submitted",
  consularInterviewDate: "Consular interview",
  cardProducedDate: "Card produced",
  cardReceivedDate: "Card received",
};

/** The subset of a case these helpers read. Every field optional, `null` treated as absent. */
export type GreenCardFields = Partial<Record<GreenCardTextField, string | null>> & {
  greenCardPath?: GreenCardPath | null;
  ebCategory?: EbCategory | null;
  i140Category?: I140Category | null;
};

/** The dates past the I-140, each optional: what the timeline and the calendar rows carry. */
export type GreenCardDates = Partial<Record<GreenCardDateField, string | null>>;

/** The dates past the I-140 a case holds, and nothing else, so a row can carry them on. */
export function pickGreenCardDates(c: GreenCardDates): Partial<Record<GreenCardDateField, string>> {
  const out: Partial<Record<GreenCardDateField, string>> = {};
  for (const f of GREEN_CARD_DATE_FIELDS) {
    const value = c[f];
    if (value) out[f] = value;
  }
  return out;
}

/**
 * Every field past the I-140 a case holds (the dates, the receipt numbers, the countries, the choice and the
 * category), and nothing else: how the form, the quick edit and the status calculation carry them from a case.
 */
export function pickGreenCardFields(c: GreenCardFields): Partial<Record<GreenCardTextField, string>> & {
  greenCardPath?: GreenCardPath;
  ebCategory?: EbCategory;
} {
  const out: Partial<Record<GreenCardTextField, string>> & { greenCardPath?: GreenCardPath; ebCategory?: EbCategory } = {};
  for (const f of GREEN_CARD_TEXT_FIELDS) {
    const value = c[f];
    if (value) out[f] = value;
  }
  if (c.greenCardPath) out.greenCardPath = c.greenCardPath;
  if (c.ebCategory) out.ebCategory = c.ebCategory;
  return out;
}

/** Whether the case has any date past the I-140. */
export function hasGreenCardDates(c: GreenCardFields): boolean {
  return GREEN_CARD_DATE_FIELDS.some((f) => !!c[f]);
}

/**
 * The path the case is on: the choice when it's made, otherwise the one its dates belong to. A card date alone
 * names neither path.
 */
export function greenCardPathOf(c: GreenCardFields): GreenCardPath | undefined {
  if (c.greenCardPath) return c.greenCardPath;
  if (ADJUSTMENT_DATE_FIELDS.some((f) => !!c[f])) return "adjustment";
  if (CONSULAR_DATE_FIELDS.some((f) => !!c[f])) return "consular";
  return undefined;
}

// ============================================================================
// THE PREFERENCE CATEGORY
// ============================================================================

/**
 * The employment-based preference category, with the subclasses the bulletin or USCIS tell apart: EB-1's three
 * (extraordinary ability, outstanding researcher, multinational manager), EB-3's three (professional, skilled
 * worker, other worker, whose bulletin row is its own), EB-4 (special immigrants) and EB-5 (investors).
 */
export const EB_CATEGORIES = [
  "EB-1A",
  "EB-1B",
  "EB-1C",
  "EB-2",
  "EB-2-NIW",
  "EB-3-professional",
  "EB-3-skilled",
  "EB-3-other",
  "EB-4",
  "EB-5",
] as const;
export type EbCategory = (typeof EB_CATEGORIES)[number];

export const EB_CATEGORY_LABELS: Record<EbCategory, string> = {
  "EB-1A": "EB-1A, extraordinary ability",
  "EB-1B": "EB-1B, outstanding researcher or professor",
  "EB-1C": "EB-1C, multinational manager or executive",
  "EB-2": "EB-2, advanced degree or exceptional ability",
  "EB-2-NIW": "EB-2 with a national interest waiver",
  "EB-3-professional": "EB-3, professional",
  "EB-3-skilled": "EB-3, skilled worker",
  "EB-3-other": "EB-3, other worker",
  "EB-4": "EB-4, special immigrant",
  "EB-5": "EB-5, investor",
};

export function isEbCategory(value: unknown): value is EbCategory {
  return typeof value === "string" && (EB_CATEGORIES as readonly string[]).includes(value);
}

/** The older, coarser category the I-140 section stored before the subclasses. */
export const I140_CATEGORIES = ["EB-1", "EB-2", "EB-2-NIW", "EB-3"] as const;
export type I140Category = (typeof I140_CATEGORIES)[number];

/**
 * The older I-140 category a subclass belongs to, so what reads that field (the I-140 estimate, the chat, the
 * export) agrees with the newer one. EB-4 and EB-5 have none: their petitions are the I-360 and the I-526.
 */
export function i140CategoryFor(eb: EbCategory): I140Category | undefined {
  if (eb.startsWith("EB-1")) return "EB-1";
  if (eb === "EB-2" || eb === "EB-2-NIW") return eb;
  if (eb.startsWith("EB-3")) return "EB-3";
  return undefined;
}

/** A visa bulletin row, as the bulletin prints its code (convex/lib/bulletinLineNames.ts). */
export type BulletinCategory = "EB1" | "EB2" | "EB3" | "EW3" | "EB4" | "EB5";

const BULLETIN_ROW: Record<EbCategory, BulletinCategory> = {
  "EB-1A": "EB1",
  "EB-1B": "EB1",
  "EB-1C": "EB1",
  "EB-2": "EB2",
  "EB-2-NIW": "EB2",
  "EB-3-professional": "EB3",
  "EB-3-skilled": "EB3",
  "EB-3-other": "EW3",
  "EB-4": "EB4",
  "EB-5": "EB5",
};

const LEGACY_BULLETIN_ROW: Record<I140Category, BulletinCategory> = {
  "EB-1": "EB1",
  "EB-2": "EB2",
  "EB-2-NIW": "EB2",
  "EB-3": "EB3",
};

/** The case's bulletin row: from the preference category, or from the older I-140 category when that's all it has. */
export function bulletinCategoryOf(c: Pick<GreenCardFields, "ebCategory" | "i140Category">): BulletinCategory | null {
  if (c.ebCategory) return BULLETIN_ROW[c.ebCategory];
  if (c.i140Category) return LEGACY_BULLETIN_ROW[c.i140Category];
  return null;
}

// ============================================================================
// COUNTRY OF BIRTH AND CHARGEABILITY
// ============================================================================

/**
 * Country codes, ISO 3166-1 alpha-2, plus XK, the code the State Department uses for Kosovo. Uninhabited territories
 * are left out. Names come from the browser (`Intl.DisplayNames`), so nothing here is spelled by hand.
 */
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GT", "GU", "GW", "GY",
  "HK", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ",
  "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA",
  "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "US", "UY", "UZ",
  "VA", "VC", "VE", "VG", "VI", "VN", "VU",
  "WF", "WS",
  "XK",
  "YE", "YT",
  "ZA", "ZM", "ZW",
] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

const COUNTRY_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && COUNTRY_SET.has(value);
}

/**
 * The country the case is charged to. Usually the country of birth; a person can be charged to a spouse's or, as a
 * child, a parent's country instead, and then the chargeability country is set.
 */
export function chargeabilityOf(c: Pick<GreenCardFields, "countryOfBirth" | "chargeabilityCountry">): string | undefined {
  return c.chargeabilityCountry || c.countryOfBirth || undefined;
}

const NAMED_COLUMNS: Partial<Record<string, CountryKey>> = {
  IN: "india",
  CN: "china",
  MX: "mexico",
  PH: "philippines",
};

/**
 * The visa bulletin column a chargeability falls in: India, mainland China, Mexico and the Philippines have their
 * own; everyone else, Hong Kong, Macau and Taiwan included, is in "all chargeability areas", the rest of the world.
 */
export function bulletinCountryOf(chargeability: string | null | undefined): CountryKey | null {
  if (!chargeability) return null;
  return NAMED_COLUMNS[chargeability] ?? "worldwide";
}
