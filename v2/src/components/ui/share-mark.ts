import { formatShareOf } from "@/lib/format";

/**
 * `formatShareOf` for a narrow cell: "over 99%" becomes ">99%" and "under 0.1%" becomes "<0.1%", so the share fits
 * a column about 44px wide. Keep `formatShareOf`'s words in the accessible name and the tip, where they read.
 */
export function shareMark(n: number, total: number): string {
  return formatShareOf(n, total).replace("under ", "<").replace("over ", ">");
}
