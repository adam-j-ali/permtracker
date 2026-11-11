/**
 * How a contact-form message's copy in support mail names the form's own row.
 *
 * A message sent through the contact form is stored twice: its own row in
 * `contactMessages` (written first, with the sender's IP for the per-IP limit) and a
 * copy filed with support mail so a reply threads (convex/contactForm.ts). The copy's
 * `messageId` carries the row's id, which is how deleting a held copy finds the row
 * (convex/inboundFilter.ts). One format, written and read here.
 */

const PREFIX = "<contact-form-";
const SUFFIX = "@permtracker.app>";

/** The `messageId` of the support-mail copy of one contact-form row. */
export function contactMailId(rowId: string): string {
  return `${PREFIX}${rowId}${SUFFIX}`;
}

/** The contact-form row's id inside a support-mail `messageId`, or null when the mail didn't come from the form. */
export function contactRowIdOf(messageId: string): string | null {
  if (!messageId.startsWith(PREFIX) || !messageId.endsWith(SUFFIX)) return null;
  const id = messageId.slice(PREFIX.length, messageId.length - SUFFIX.length);
  return id.length > 0 ? id : null;
}
