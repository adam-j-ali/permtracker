/**
 * Double opt-in confirmation for the USCIS receipt tracking beta (convex/uscisAlerts.ts).
 *
 * One job, one click, so no onward links, like every confirmation in the set. What it does besides is name what
 * the click confirms: each receipt, the office its three letters stand for, and the DOL case number when one was
 * given. A receipt is thirteen characters nobody proofreads, and the office is what a reader recognises.
 *
 * It doesn't echo a status. The beta hasn't checked an unconfirmed receipt, and a status we hold because someone
 * else watches the same receipt would say that someone does.
 *
 * @module
 */

import { Section, Text } from "@react-email/components";
import { EmailButton, EmailLayout, QueueStamp } from "./components";
import { MONO_STACK, SANS_STACK } from "./components/QueueStamp";

export interface UscisConfirmReceipt {
  receipt: string;
  /** The office the receipt's three letters name, from USCIS's glossary, or null. */
  office: string | null;
  /** The DOL case number given with it, or null. */
  dolCaseNumber: string | null;
}

export interface UscisAlertConfirmProps {
  receipts: readonly UscisConfirmReceipt[];
  /** Absolute, purpose-scoped confirmation URL. */
  confirmUrl: string;
  /** The product-news box was ticked too: the same click confirms it, and the email has to say so. */
  includesNews?: boolean;
  includesNewsletter?: boolean;
}

export function UscisAlertConfirm({
  receipts,
  confirmUrl,
  includesNews = false,
  includesNewsletter = false,
}: UscisAlertConfirmProps) {
  const several = receipts.length > 1;
  const first = receipts[0];
  return (
    <EmailLayout
      previewText={
        several
          ? `Confirm and we'll email you when USCIS changes the status of any of these ${receipts.length} receipts.`
          : "Confirm and we'll email you when USCIS changes the status of this receipt."
      }
      hideSettingsLink
      footerText={`This address was entered to be told when USCIS changes the status of ${several ? `${receipts.length} receipts` : "a receipt"}. It isn’t confirmed yet, so nothing else will be sent.`}
    >
      <QueueStamp
        eyebrow={several ? "Your receipt numbers" : "Your receipt number"}
        month={several ? `${receipts.length} receipts` : first ? <ReceiptValue receipt={first.receipt} /> : ""}
      >
        {!several && first ? (
          <>
            {first.office ? (
              <Text className="em-text-secondary" style={styles.provenance}>
                {first.office}
              </Text>
            ) : null}
            {first.dolCaseNumber ? (
              <Text className="em-text-secondary" style={styles.provenance}>
                With DOL case {first.dolCaseNumber}
              </Text>
            ) : null}
          </>
        ) : null}
      </QueueStamp>

      {several ? (
        <Section style={styles.listWrap}>
          <table width="100%" cellPadding={0} cellSpacing={0} border={0} style={styles.list}>
            <caption className="em-text-secondary" style={styles.listCaption}>
              The receipts this confirms
            </caption>
            <thead>
              <tr>
                <th scope="col" align="left" className="em-text-secondary" style={styles.listHead}>
                  Receipt number
                </th>
                <th scope="col" align="left" className="em-text-secondary" style={styles.listHead}>
                  Office
                </th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.receipt}>
                  <td className="em-text" style={styles.listNumber}>
                    {r.receipt}
                  </td>
                  <td className="em-text-body" style={styles.listOffice}>
                    {r.office ?? "An office USCIS’s glossary doesn’t name"}
                    {r.dolCaseNumber ? (
                      <>
                        {", with DOL case "}
                        <span style={styles.nowrap}>{r.dolCaseNumber}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Text className="em-text-body" style={styles.body}>
        {several
          ? "If these are your receipts, confirm below, and check each one against its I-797 notice first. A typo watches someone else’s case, or nothing."
          : "If that’s your receipt, confirm below, and check it against your I-797 notice first. A typo watches someone else’s case, or nothing."}
      </Text>
      <Text className="em-text-secondary" style={styles.lag}>
        Receipt alerts are a beta. We check each watched receipt with USCIS every 4 hours and after USCIS&rsquo;s
        overnight updates, and email you when its status changes. Today&rsquo;s status isn&rsquo;t emailed: you
        already know it. Every email says when we checked.
      </Text>

      {includesNews ? (
        <Text className="em-text-secondary" style={styles.newsNote}>
          You also asked for occasional product news. The same click confirms that.
        </Text>
      ) : null}
      {includesNewsletter ? (
        <Text className="em-text-secondary" style={styles.newsNote}>
          You also asked for the weekly digest. The same click confirms that.
        </Text>
      ) : null}

      <Section style={styles.cta}>
        <EmailButton href={confirmUrl} variant="primary">
          Confirm these alerts
        </EmailButton>
      </Section>

      <Text className="em-text-secondary" style={styles.note}>
        If you didn&rsquo;t ask for this, ignore it. Nothing will be sent.
      </Text>
    </EmailLayout>
  );
}

/**
 * A receipt in the stamp, free to break after its three letters. Thirteen characters with no break point are wider
 * than a phone's card at the stamp's size; a case number breaks at its hyphens, a receipt has none. `<wbr>` adds no
 * character, so the number copies whole.
 */
function ReceiptValue({ receipt }: { receipt: string }) {
  return (
    <>
      {receipt.slice(0, 3)}
      <wbr />
      {receipt.slice(3)}
    </>
  );
}

const styles = {
  nowrap: {
    whiteSpace: "nowrap" as const,
  },
  provenance: {
    fontFamily: MONO_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "14px 0 0 0",
  },
  listWrap: {
    margin: "0 0 24px 0",
  },
  list: {
    borderCollapse: "collapse" as const,
  },
  listCaption: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    fontWeight: 700 as const,
    lineHeight: "20px",
    textAlign: "left" as const,
    paddingBottom: "8px",
  },
  listHead: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    fontWeight: 400 as const,
    lineHeight: "20px",
    padding: "0 12px 6px 0",
    borderBottom: "2px solid #000001",
  },
  listNumber: {
    fontFamily: MONO_STACK,
    color: "#1A1A1A",
    fontSize: "14px",
    fontWeight: 600 as const,
    lineHeight: "20px",
    padding: "8px 12px 8px 0",
    borderBottom: "1px solid #D9D9D9",
    whiteSpace: "nowrap" as const,
  },
  listOffice: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "14px",
    lineHeight: "20px",
    padding: "8px 0",
    borderBottom: "1px solid #D9D9D9",
  },
  body: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "16px",
    lineHeight: "26px",
    margin: "0 0 24px 0",
  },
  lag: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 24px 0",
  },
  newsNote: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0 0 24px 0",
  },
  cta: {
    marginBottom: "20px",
  },
  note: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "22px",
    margin: "0",
  },
} as const;

/** Preview props for the React Email dev server. */
UscisAlertConfirm.PreviewProps = {
  receipts: [{ receipt: "IOE0000000000", office: "USCIS online filing (ELIS)", dolCaseNumber: "G-100-26125-000000" }],
  confirmUrl: "https://permtracker.app/uscis-alert/confirm?token=abc",
} satisfies UscisAlertConfirmProps;

export default UscisAlertConfirm;
