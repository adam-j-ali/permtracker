/**
 * The inbox an address reaches, one rule for every check that must not be walked around by another spelling of the
 * same address: the email blocklist (convex/lib/emailBlocklist.ts) and a second reminder recipient's refusal list
 * and invitation count (convex/lib/reminderRecipients.ts).
 *
 * @module
 */

/** Gmail's two domains, one inbox: googlemail.com is read as gmail.com. */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The inbox an address reaches: trimmed and lowercased, a "+tag" dropped from the local part on every domain, and on
 * Gmail the local part's dots dropped and googlemail.com read as gmail.com. A local part that would be left empty is
 * kept as it was. Only comparisons and keys use it: mail still goes to the address as typed.
 */
export function canonicalAddress(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.replace(/\./g, "") || local;
  }
  return `${local}@${domain}`;
}
