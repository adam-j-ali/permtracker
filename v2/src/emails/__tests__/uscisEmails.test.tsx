// @vitest-environment jsdom
/**
 * The tracking beta's two emails (src/emails/UscisAlertConfirm.tsx, src/emails/UscisStatusChanged.tsx): each names
 * what it's about, links where it says it does, and dates every status by its check.
 *
 * When USCIS_EMAIL_PREVIEW_DIR is set, the rendered HTML is written there to be looked at.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "react-email";
import { describe, expect, it } from "vitest";

import { UscisAlertConfirm, type UscisConfirmReceipt } from "../UscisAlertConfirm";
import { UscisStatusChanged, type UscisChangedItem } from "../UscisStatusChanged";

const CONFIRM_URL = "https://permtracker.app/uscis-alert/confirm?token=abc";
const STOP_URL = "https://permtracker.app/uscis-alert/unsubscribe?token=abc";
const PREFS_URL = "https://permtracker.app/prefs?token=abc&focus=uscis";

const one: UscisConfirmReceipt = { receipt: "IOE0000000000", office: "USCIS online filing (ELIS)", dolCaseNumber: "G-100-00000-000000" };
const two: UscisConfirmReceipt = { receipt: "EAC3500000000", office: "Vermont Service Center", dolCaseNumber: null };

const moved: UscisChangedItem = {
  receipt: "IOE0000000000",
  form: "I-485",
  fromStatus: "Case Was Received",
  toStatus: "Case Was Approved",
  tone: "good",
  isFinal: true,
  checkedAt: "4:12 AM ET, Nov 24",
  statusUrl: "https://permtracker.app/uscis-case-status?receipt=IOE0000000000",
  blockUrl: "https://permtracker.app/uscis-receipt-blocks/IOE00000",
  dolCaseNumber: "G-100-00000-000000",
  dolCaseUrl: "https://permtracker.app/perm-case-status?case=G-100-00000-000000",
};
const alsoMoved: UscisChangedItem = {
  ...moved,
  receipt: "EAC3500000000",
  form: null,
  fromStatus: "Case Was Received",
  toStatus: "Request for Evidence Was Sent",
  tone: "bad",
  isFinal: false,
  checkedAt: "4:14 AM ET, Nov 24",
  statusUrl: "https://permtracker.app/uscis-case-status?receipt=EAC3500000000",
  blockUrl: "https://permtracker.app/uscis-receipt-blocks",
  dolCaseNumber: null,
  dolCaseUrl: null,
};

/** The text a reader sees, without markup. */
function words(html: string): string {
  // A <wbr> lets the receipt break on a phone and adds no character, so it reads as nothing.
  return html.replace(/<wbr\s*\/?>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|&#8217;/g, "’").replace(/\s+/g, " ");
}

function keep(name: string, html: string) {
  const dir = process.env.USCIS_EMAIL_PREVIEW_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), html);
}

describe("the confirmation", () => {
  it("names the receipt, its office and the DOL case, and its one button confirms", async () => {
    const html = await render(UscisAlertConfirm({ receipts: [one], confirmUrl: CONFIRM_URL }));
    keep("confirm-one", html);
    const text = words(html);
    expect(text).toContain("IOE0000000000");
    expect(text).toContain("USCIS online filing (ELIS)");
    expect(text).toContain("With DOL case G-100-00000-000000");
    expect(text).toContain("Confirm these alerts");
    expect(text).toMatch(/every 4 hours and after USCIS.s overnight updates/);
    expect(html).toContain(`href="${CONFIRM_URL.replace(/&/g, "&amp;")}"`);
    // One job: no link but the button's, and no status (the beta hasn't checked an unconfirmed receipt).
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !/\/(privacy|terms)$/.test(h!) && h !== "https://permtracker.app");
    expect(links).toEqual([CONFIRM_URL]);
  });

  it("lists several receipts in a table with their offices", async () => {
    const html = await render(UscisAlertConfirm({ receipts: [one, two], confirmUrl: CONFIRM_URL, includesNews: true }));
    keep("confirm-two", html);
    const text = words(html);
    expect(text).toContain("2 receipts");
    expect(text).toContain("Vermont Service Center");
    expect(text).toContain("The receipts this confirms");
    expect(text).toContain("You also asked for occasional product news");
    expect(html).toContain('scope="col"');
  });
});

describe("the change email", () => {
  it("shows the move, the time of the check, and links the receipt, its block and the PERM case", async () => {
    const html = await render(UscisStatusChanged({ items: [moved], unsubscribeUrl: STOP_URL, prefsUrl: PREFS_URL }));
    keep("changed-one", html);
    const text = words(html);
    expect(text).toContain("IOE0000000000");
    expect(text).toContain("Case Was Received");
    expect(text).toContain("Case Was Approved");
    expect(text).toContain("USCIS showed this when we checked, at 4:12 AM ET, Nov 24.");
    expect(text).toContain("keep watching it for a year");
    expect(text).not.toMatch(/no change/i);
    expect(html).toContain(moved.statusUrl);
    expect(html).toContain(moved.blockUrl);
    expect(html).toContain(moved.dolCaseUrl!);
    expect(html).toContain(STOP_URL);
    expect(text).toContain("Stop these alerts");
    expect(text).toContain("Email preferences");
  });

  it("names every receipt that moved in one email, each with its own time and link", async () => {
    const html = await render(UscisStatusChanged({ items: [moved, alsoMoved], unsubscribeUrl: STOP_URL, prefsUrl: PREFS_URL }));
    keep("changed-two", html);
    const text = words(html);
    expect(text).toContain("USCIS changed the status of 2 of your receipts.");
    expect(text).toContain("at 4:12 AM ET, Nov 24");
    expect(text).toContain("at 4:14 AM ET, Nov 24");
    expect(text).toContain("See EAC3500000000 on PERM Tracker");
    expect(html).toContain(alsoMoved.statusUrl);
    // The PERM case link only for the receipt that has one.
    expect(text.match(/Your PERM case/g)).toHaveLength(1);
  });
});
