/** The pages that print the USCIS sample's figures, expired after each load (`permtracker-uscis uscis-sample`). */
export const USCIS_SAMPLE_PAGES = ["/uscis-receipt-blocks"] as const;

export const USCIS_SAMPLE_PAGE_FAMILIES = [
  "/(site)/(public)/uscis-receipt-blocks/[block]",
  "/(site)/(public)/uscis-receipt-blocks/[block]/numbers",
  "/(site)/(public)/uscis-processing-times/[form]",
  "/(site)/(public)/i485-by-field-office/[office]",
] as const;
