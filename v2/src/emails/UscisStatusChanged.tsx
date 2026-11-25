/**
 * The tracking beta's alert: USCIS changed the status of one or more receipts this address watches
 * (convex/uscisAlerts.ts). Receipts of one address that moved in the same check come in this one email.
 *
 * ## What each receipt says
 *
 * USCIS's own status titles, the one it left and the one it's in, on the same rail as the DOL case alert; then
 * the time the checker read it, always. The time is the email's honesty: a checker that stopped for a day makes
 * the next email's time a day later, never a claim that nothing changed in between.
 *
 * It never says what a status means, predicts a date, or adds a figure. USCIS is the authority, and the email
 * says so. Each receipt links its status on /uscis-case-status and its block on /uscis-receipt-blocks, and the
 * PERM case when one was given at sign-up.
 *
 * ## What comes next
 *
 * The step the new status leads to, from the form and the status group alone (`receiptNextSteps` in
 * convex/lib/alertNextSteps.ts): how long the form takes while it waits, the response deadline after a request
 * for evidence, and the visa bulletin after an approved I-140. A denial or a withdrawal gets none.
 *
 * @module
 */

import { Link, Section, Text } from "react-email";
import { EmailButton, EmailLayout, EmailLinkList, NextStepsBlock, StatusRail } from "./components";
import { MONO_STACK, SANS_STACK } from "./components/QueueStamp";
import type { NextSteps } from "../../convex/lib/alertNextSteps";

export interface UscisChangedItem {
  receipt: string;
  /** The form USCIS names for the case, like I-485, or null. */
  form: string | null;
  fromStatus: string;
  toStatus: string;
  tone: "good" | "bad" | "neutral";
  /** True when the new status ends the filing: the watch carries on a year in case anything follows. */
  isFinal: boolean;
  /** When the checker read the new status, formatted in Eastern time. */
  checkedAt: string;
  statusUrl: string;
  blockUrl: string;
  dolCaseNumber: string | null;
  dolCaseUrl: string | null;
}

export interface UscisStatusChangedProps {
  items: readonly UscisChangedItem[];
  unsubscribeUrl: string;
  prefsUrl: string;
  /** What comes next (`receiptNextSteps`), or null when nothing honest follows. Optional for older callers. */
  next?: NextSteps | null;
}

export function UscisStatusChanged({ items, unsubscribeUrl, prefsUrl, next = null }: UscisStatusChangedProps) {
  const several = items.length > 1;
  const first = items[0];
  return (
    <EmailLayout
      previewText={
        several
          ? `${items.length} of your receipts have a new status at USCIS.`
          : first
            ? `${first.receipt} is now: ${first.toStatus}.`
            : "A receipt you watch has a new status at USCIS."
      }
      settingsUrl={prefsUrl}
      settingsLabel="Email preferences"
      footerText={`You asked to be told when USCIS changes the status of ${several ? "these receipts" : "this receipt"}. Receipt alerts are a beta. We'll email you again when a status changes again.`}
      footerExtra={
        <Text className="em-text-secondary" style={styles.footerExtra}>
          <Link href={unsubscribeUrl} className="em-link" style={styles.footerLink}>
            Stop these alerts
          </Link>
        </Text>
      }
    >
      <Text className="em-text-body" style={styles.lede}>
        {several
          ? `USCIS changed the status of ${items.length} of your receipts.`
          : "USCIS changed the status of your receipt."}
      </Text>

      {items.map((item, i) => (
        <Section key={item.receipt} style={i > 0 ? styles.itemAfter : styles.item}>
          <Text className="em-text" style={styles.receipt}>
            {item.receipt}
          </Text>
          {item.form ? (
            <Text className="em-text-secondary" style={styles.form}>
              {item.form}
            </Text>
          ) : null}
          <StatusRail
            fromStatus={item.fromStatus}
            toStatus={item.toStatus}
            tone={item.isFinal && item.tone !== "good" ? "closed" : "live"}
          />
          <Text className="em-text-secondary" style={styles.caveat}>
            {`USCIS showed this when we checked, at ${item.checkedAt}.${
              item.isFinal ? " We’ll keep watching it for a year in case anything follows, and email you only if it moves." : ""
            }`}
          </Text>
          {several ? (
            <Text style={styles.itemLinks}>
              <Link href={item.statusUrl} className="em-link-strong" style={styles.itemLink}>
                See {item.receipt} on PERM Tracker
              </Link>
            </Text>
          ) : null}
        </Section>
      ))}

      {!several && first ? (
        <Section style={styles.cta}>
          <EmailButton href={first.statusUrl} variant="primary">
            See this receipt
          </EmailButton>
        </Section>
      ) : null}

      {next ? (
        <Section style={styles.next}>
          <NextStepsBlock next={next} />
        </Section>
      ) : null}

      <Text className="em-text-secondary" style={styles.authority}>
        USCIS is the authority on every case, and its own case status page has today&rsquo;s.
      </Text>

      <EmailLinkList
        label="Also on PERM Tracker"
        items={items.flatMap((item) => [
          {
            href: item.blockUrl,
            text: several ? `The cases near ${item.receipt}, and how they're moving` : "The cases near this receipt, and how they're moving",
          },
          ...(item.dolCaseUrl && item.dolCaseNumber
            ? [{ href: item.dolCaseUrl, text: `Your PERM case ${item.dolCaseNumber} at DOL` }]
            : []),
        ]).concat(
          first ? [{ href: `${new URL(first.statusUrl).origin}/uscis-case-statuses`, text: "What each USCIS case status means" }] : [],
        )}
      />
    </EmailLayout>
  );
}

const styles = {
  lede: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "16px",
    lineHeight: "26px",
    margin: "0 0 20px 0",
  },
  item: {
    marginBottom: "8px",
  },
  itemAfter: {
    marginTop: "20px",
    paddingTop: "20px",
    borderTop: "1px solid #D9D9D9",
    marginBottom: "8px",
  },
  receipt: {
    fontFamily: MONO_STACK,
    color: "#000001",
    fontSize: "15px",
    fontWeight: 700 as const,
    letterSpacing: "0.02em",
    lineHeight: "20px",
    margin: "0",
  },
  form: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "4px 0 16px 0",
  },
  caveat: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 4px 0",
  },
  itemLinks: {
    margin: "0",
  },
  itemLink: {
    fontFamily: SANS_STACK,
    color: "#1A1A1A",
    fontSize: "15px",
    fontWeight: 600 as const,
    textDecorationLine: "underline" as const,
    // A link on its own line: inline-block puts the padding inside the hit box, a 44px tap target.
    display: "inline-block",
    padding: "12px 0",
    lineHeight: "20px",
  },
  cta: {
    marginTop: "28px",
    marginBottom: "4px",
  },
  next: {
    marginTop: "28px",
  },
  authority: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "24px 0 0 0",
  },
  footerExtra: {
    color: "#5F5F67",
    fontSize: "14px",
    lineHeight: "18px",
    margin: "0 0 12px 0",
  },
  footerLink: {
    color: "#5F5F67",
    textDecoration: "underline",
    // A control on its own line, so the 44px floor binds: inline-block puts the padding in the hit box.
    display: "inline-block",
    padding: "13px 4px",
  },
} as const;

/** Preview props for the React Email dev server. */
UscisStatusChanged.PreviewProps = {
  items: [
    {
      receipt: "IOE0000000000",
      form: "I-485",
      fromStatus: "Case Was Received",
      toStatus: "Fingerprint Fee Was Received",
      tone: "neutral",
      isFinal: false,
      checkedAt: "4:12 AM ET, Nov 24",
      statusUrl: "https://permtracker.app/uscis-case-status?receipt=IOE0000000000",
      blockUrl: "https://permtracker.app/uscis-receipt-blocks/IOE00000",
      dolCaseNumber: null,
      dolCaseUrl: null,
    },
  ],
  unsubscribeUrl: "https://permtracker.app/uscis-alert/unsubscribe?token=abc",
  prefsUrl: "https://permtracker.app/prefs?token=abc",
} satisfies UscisStatusChangedProps;

export default UscisStatusChanged;
