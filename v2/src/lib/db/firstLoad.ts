/**
 * A table the first load hasn't made yet holds nothing. Any other failed read is a failure, and throws.
 *
 *   rows(sql, args).catch(beforeFirstLoad([]))
 *
 * A reader that answers every failure with "nothing held" turns a database blip into a page that says there is no
 * record, and the page is then kept for its whole cache window. With this, a page whose subject the read is keeps
 * its last good render, and a page that only borrows the figure names its own fallback where it calls
 * (`softFail`, src/lib/softRead.ts).
 */
export const beforeFirstLoad =
  <T>(empty: T) =>
  (error: unknown): T => {
    if (/no such table/i.test(String((error as Error | undefined)?.message ?? error))) return empty;
    throw error;
  };
