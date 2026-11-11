/**
 * The words on the pages a queue alert's links open. One address can follow
 * three queues (PERM analyst review and the two prevailing-wage queues), so a
 * page names the queue the alert is for, and a page that can't know it yet
 * names none.
 */
import { type DolQueue, queueLabel } from "./mailKinds";
import { monthLabel } from "./newsletterCompose";

/** Before the confirming click, the link carries only the address: no queue is named. */
export const QUEUE_CONFIRM_ASK =
  "We'll email you once, on the day the Department of Labor's queue reaches the month you gave. That's the only message you'll get.";

/** The same for the page that asks before cancelling. */
export const QUEUE_CANCEL_ASK = "You'll stop receiving the one-time alert about the Department of Labor's queue reaching your month.";

/** After the confirming click: the queue by name, and the month in words. */
export function queueConfirmedWords(queue: DolQueue, filingMonth: string, alreadyReached: boolean): string {
  const label = queueLabel(queue);
  const month = monthLabel(filingMonth);
  const figures = "DOL's current figures are always on permtracker.app/perm-processing-times.";
  return alreadyReached
    ? `DOL's ${label} has already reached ${month}. Your alert is on its way now, and that's the only message you'll get. ${figures}`
    : `We'll email you once, when the Department of Labor's ${label} reaches ${month}. That's the only message you'll get. ${figures}`;
}
