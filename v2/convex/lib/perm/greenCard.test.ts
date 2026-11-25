import { describe, it, expect } from "vitest";
import {
  EB_CATEGORIES,
  GREEN_CARD_DATE_FIELDS,
  COUNTRY_CODES,
  bulletinCategoryOf,
  bulletinCountryOf,
  chargeabilityOf,
  greenCardPathOf,
  hasGreenCardDates,
  i140CategoryFor,
  isCountryCode,
  isEbCategory,
} from "./greenCard";

describe("EB categories", () => {
  it("holds every subclass the app tracks, EB-1A to EB-5", () => {
    expect(EB_CATEGORIES).toEqual([
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
    ]);
    expect(isEbCategory("EB-3-other")).toBe(true);
    expect(isEbCategory("EB-1")).toBe(false);
  });

  it("maps each to the older I-140 category, and EB-4 and EB-5 to none (they aren't I-140s)", () => {
    expect(i140CategoryFor("EB-1A")).toBe("EB-1");
    expect(i140CategoryFor("EB-1C")).toBe("EB-1");
    expect(i140CategoryFor("EB-2")).toBe("EB-2");
    expect(i140CategoryFor("EB-2-NIW")).toBe("EB-2-NIW");
    expect(i140CategoryFor("EB-3-skilled")).toBe("EB-3");
    expect(i140CategoryFor("EB-3-other")).toBe("EB-3");
    expect(i140CategoryFor("EB-4")).toBeUndefined();
    expect(i140CategoryFor("EB-5")).toBeUndefined();
  });

  it("names the bulletin row: other workers have their own, and an older case's I-140 category still works", () => {
    expect(bulletinCategoryOf({ ebCategory: "EB-1B" })).toBe("EB1");
    expect(bulletinCategoryOf({ ebCategory: "EB-2-NIW" })).toBe("EB2");
    expect(bulletinCategoryOf({ ebCategory: "EB-3-professional" })).toBe("EB3");
    expect(bulletinCategoryOf({ ebCategory: "EB-3-other" })).toBe("EW3");
    expect(bulletinCategoryOf({ ebCategory: "EB-4" })).toBe("EB4");
    expect(bulletinCategoryOf({ ebCategory: "EB-5" })).toBe("EB5");
    // Only the older field: still a row.
    expect(bulletinCategoryOf({ i140Category: "EB-3" })).toBe("EB3");
    expect(bulletinCategoryOf({ i140Category: "EB-2-NIW" })).toBe("EB2");
    // The newer field wins over the older one.
    expect(bulletinCategoryOf({ ebCategory: "EB-3-other", i140Category: "EB-3" })).toBe("EW3");
    expect(bulletinCategoryOf({})).toBeNull();
  });
});

describe("Country of birth and chargeability", () => {
  it("knows the ISO country codes, Kosovo included, and nothing else", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(240);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(isCountryCode("IN")).toBe(true);
    expect(isCountryCode("XK")).toBe(true);
    expect(isCountryCode("in")).toBe(false);
    expect(isCountryCode("ZZ")).toBe(false);
  });

  it("charges to the country of birth unless another chargeability is given", () => {
    expect(chargeabilityOf({ countryOfBirth: "IN" })).toBe("IN");
    // Born in India, charged to a spouse's Canada.
    expect(chargeabilityOf({ countryOfBirth: "IN", chargeabilityCountry: "CA" })).toBe("CA");
    expect(chargeabilityOf({ chargeabilityCountry: "MX" })).toBe("MX");
    expect(chargeabilityOf({})).toBeUndefined();
  });

  it("puts a chargeability in its bulletin column: the four named countries, and the rest of the world", () => {
    expect(bulletinCountryOf("IN")).toBe("india");
    expect(bulletinCountryOf("CN")).toBe("china");
    expect(bulletinCountryOf("MX")).toBe("mexico");
    expect(bulletinCountryOf("PH")).toBe("philippines");
    // Hong Kong, Macau and Taiwan are charged apart from mainland China.
    expect(bulletinCountryOf("HK")).toBe("worldwide");
    expect(bulletinCountryOf("TW")).toBe("worldwide");
    expect(bulletinCountryOf("CA")).toBe("worldwide");
    expect(bulletinCountryOf(undefined)).toBeNull();
  });
});

describe("The adjustment-or-consulate choice", () => {
  it("is what the case says, when it says", () => {
    expect(greenCardPathOf({ greenCardPath: "consular" })).toBe("consular");
    expect(greenCardPathOf({ greenCardPath: "adjustment", nvcReceivedDate: "2026-01-02" })).toBe("adjustment");
  });

  it("is read from the dates when the choice isn't made", () => {
    expect(greenCardPathOf({ i485FilingDate: "2026-01-02" })).toBe("adjustment");
    expect(greenCardPathOf({ eadFilingDate: "2026-01-02" })).toBe("adjustment");
    expect(greenCardPathOf({ ds260SubmittedDate: "2026-01-02" })).toBe("consular");
    expect(greenCardPathOf({ cardReceivedDate: "2026-01-02" })).toBeUndefined();
    expect(greenCardPathOf({})).toBeUndefined();
  });

  it("knows when a case has any date past the I-140", () => {
    expect(hasGreenCardDates({})).toBe(false);
    for (const f of GREEN_CARD_DATE_FIELDS) {
      expect(hasGreenCardDates({ [f]: "2026-01-02" })).toBe(true);
    }
  });
});
