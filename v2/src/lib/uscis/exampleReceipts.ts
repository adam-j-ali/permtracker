/**
 * Example receipt numbers for page copy, placeholders and docs. Each sits on a real office and the real shape, so the
 * reading beside a receipt box shows on it, but in a fiscal year USCIS hasn't reached (service centers) or at zero
 * (online numbers count up from one, and real ones run from IOE01 to at least IOE98), so no example is ever a real
 * person's case. `exampleReceipts.test.ts` fails once
 * a year comes within five years, and `receipt-examples-in-copy.test.ts` fails on any other receipt-shaped number in
 * copy.
 */
export const EXAMPLE_RECEIPT = "EAC3512345678";
export const EXAMPLE_ONLINE_RECEIPT = "IOE0000000000";
export const EXAMPLE_RECEIPTS = [
  EXAMPLE_RECEIPT,
  EXAMPLE_ONLINE_RECEIPT,
  "WAC3512345678",
  "SRC3512312345",
  "LIN3523412345",
] as const;
