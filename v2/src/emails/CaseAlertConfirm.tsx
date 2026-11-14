/**
 * Double opt-in confirmation for a per-case status alert.
 *
 * One job: get one click. Like `QueueAlertConfirm`, it carries NO onward links,
 * because every one of them leads out of an opt-in the reader has not completed
 * and a confirmation is the one email in the set with a conversion rate to
 * protect. Nothing is lost: they are all in the alert this confirms.
 *
 * ## The real work this email does
 *
 * It echoes the case's CURRENT status and employer back. A mistyped case number
 * is otherwise undetectable: it looks exactly like a real subscription and
 * produces silence for a year. One line here catches it, and the employer name
 * is what catches it, because a person recognises their employer instantly and
 * cannot proofread an 18-character case number.
 *
 * Showing that status to an unconfirmed address is not a leak. The same case
 * number returns the same status on our own public lookup page with no login,
 * because DOL's per-case status is public record. This adds no access anyone
 * did not already have.
 *
 * ## The case we do not hold
 *
 * A freshly filed case is not in our records yet, and that person is precisely
 * the one who wants alerts most, so the subscription is allowed. What this
 * email must not do is promise an alert the moment it appears: our first sight
 * of a case cannot distinguish "it just arrived" from "it has been sitting in
 * this status for eight months and we only started watching now". So the copy
 * promises what the sweep actually does, which is to email on the first move
 * AFTER we start watching. A false alarm is how an alert product loses someone
 * permanently.
 *
 * @module
 */

import { Section, Text } from "@react-email/components";
import { EmailButton, EmailLayout, QueueStamp } from "./components";
import { MONO_STACK, SANS_STACK } from "./components/QueueStamp";
import { caseStatusTint, prettyStatus, type CaseStatusTint } from "../lib/statusTone";

/** One case a confirmation for several names. */
export interface ConfirmCase {
  caseNumber: string;
  /** DOL's status as we hold it, or null when we don't hold the case, or couldn't check. */
  status: string | null;
}

/**
 * Up to this many cases, the list sits above the button, where it's read before the click. A longer list goes
 * under the button, which says so, because a button a hundred rows down isn't found.
 */
export const LIST_ABOVE_BUTTON_MAX = 10;

/** How many of the numbers we don't hold are named in the sentence. The rest are marked in the list. */
const NOT_HELD_NAMED = 6;

/**
 * The list's own, shorter font stacks. Every cell carries its styles inline, a list can run to 100 rows, and
 * Gmail cuts a message off past 102 KB, taking the footer's links with it: the full stacks cost 15 KB there.
 */
const LIST_MONO = "'JetBrains Mono', Menlo, Consolas, monospace";
const LIST_SANS = "'Space Grotesk', Arial, sans-serif";

/** The bar beside each case in the list: the site's one status colour code. The words carry the meaning. */
const TINT_HEX: Record<CaseStatusTint, string> = {
  good: "#2ECC40",
  wait: "#E8A33D",
  bad: "#E05A44",
  withdrawn: "#6D28D9",
  aside: "#4B5563",
  flat: "#D4D4D8",
};

export interface CaseAlertConfirmProps {
  /** DOL case number, normalised, as the reader typed it. */
  caseNumber: string;
  /** The case's current status, or null when the mirror does not hold it. */
  currentStatus?: string | null;
  /** The employer on the case, when the mirror carries one. */
  employerName?: string | null;
  /**
   * The day DOL's record was first seen showing the current status, formatted, or null when unknown. See the
   * note in `CaseStatusChanged`.
   */
  asOf?: string | null;
  /** Absolute, purpose-scoped confirmation URL. */
  confirmUrl: string;
  /**
   * True when the subscriber also ticked the product-news box, so the same
   * confirm click opts them into that as well.
   *
   * A plain sentence, never a link and never a second button: this email
   * carries no onward links and everything on it is subordinate to the confirm
   * button. But the sentence has to be here, because a click that confirms two
   * things is only consent for the second if the email said so.
   */
  includesNews?: boolean;
  /** Optional, default off: links already in inboxes predate it. */
  includesNewsletter?: boolean;
  /**
   * True when DOL's record couldn't be read for this email. A failed read is never "no record": the email says
   * the check couldn't run, instead of calling a correct number what a typo looks like.
   */
  lookupFailed?: boolean;
  /**
   * What to call this filing, with its article: "a PERM case", "a prevailing
   * wage request", "an LCA". From `programNounWithArticle` at the call site.
   *
   * A prop rather than a constant because DOL's case-status endpoint serves
   * three programs and this email is sent for all of them. The subject line
   * and the text part were already program-correct; this footer was the one
   * string still saying "a PERM case" over a wage request, which is the kind
   * of wrong that makes a reader doubt the whole subscription.
   */
  nounWithArticle?: string;
  /**
   * Every case the click confirms, this one included, when there are several: a pasted list, or the cases typed
   * inside this address's ten minutes after an earlier confirmation. Each is named with DOL's status as we hold
   * it, because a click is consent only for what the email said, and the status is what catches a typo. With
   * several, the email is about the list: `caseNumber`, `currentStatus` and `employerName` aren't drawn.
   */
  cases?: readonly ConfirmCase[];
}

export function CaseAlertConfirm({
  caseNumber,
  currentStatus = null,
  employerName = null,
  asOf = null,
  confirmUrl,
  includesNews = false,
  includesNewsletter = false,
  nounWithArticle = "a PERM case",
  lookupFailed = false,
  cases = [],
}: CaseAlertConfirmProps) {
  const known = currentStatus !== null;
  const several = cases.length > 1;
  const notHeld = cases.filter((c) => c.status === null).map((c) => c.caseNumber);
  const listFirst = cases.length <= LIST_ABOVE_BUTTON_MAX;

  const caseList = several ? (
    <Section style={styles.listWrap}>
      <table width="100%" cellPadding={0} cellSpacing={0} border={0} style={styles.list}>
        <caption className="em-text-secondary" style={styles.listCaption}>
          The cases this confirms
        </caption>
        <thead>
          <tr>
            <th scope="col" align="left" className="em-text-secondary" style={styles.listHead}>
              Case number
            </th>
            <th scope="col" align="left" className="em-text-secondary" style={styles.listHead}>
              DOL&rsquo;s status
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.caseNumber}>
              <td
                className="em-text"
                style={{ ...styles.listNumber, borderLeft: `6px solid ${TINT_HEX[caseStatusTint(c.status)]}` }}
              >
                {c.caseNumber}
              </td>
              <td className={c.status ? "em-text-body" : "em-text-secondary"} style={c.status ? styles.listStatus : styles.listStatusNone}>
                {c.status ? prettyStatus(c.status) : lookupFailed ? "Couldn\u2019t check" : "Not in our records yet"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  ) : null;

  return (
    <EmailLayout
      previewText={
        several
          ? `Confirm and we'll email you when DOL's status for any of these ${cases.length} cases changes.`
          : known
            ? `Confirm and we'll email you when DOL's status for this case changes.`
            : lookupFailed
              ? `We couldn't check this case number just now. Check it before you confirm.`
              : `We don't hold this case number yet. Check it before you confirm.`
      }
      hideSettingsLink
      footerText={
        several
          ? `This address was entered to be told when the status of ${cases.length} DOL cases changes. It isn\u2019t confirmed yet, so nothing else will be sent.`
          : `This address was entered to be told when ${nounWithArticle}\u2019s status changes. It isn\u2019t confirmed yet, so nothing else will be sent.`
      }
    >
      <QueueStamp eyebrow={several ? "Your case numbers" : "Your case number"} month={several ? `${cases.length} cases` : caseNumber}>
        {several ? (
          <Text className="em-text-secondary" style={styles.provenance}>
            {lookupFailed
              ? "Couldn\u2019t check DOL\u2019s record just now"
              : notHeld.length === 0
                ? `All ${cases.length} are in our records`
                : `${cases.length - notHeld.length} of them are in our records`}
          </Text>
        ) : known ? (
          <>
            <Text className="em-text-secondary" style={styles.provenance}>
              Currently {currentStatus}
              {employerName ? ` at ${employerName}` : ""}
            </Text>
            <Text className="em-text-secondary" style={styles.provenance}>
              {asOf
                ? `Shown since at least ${asOf}`
                : "We don\u2019t have a date for this status yet"}
            </Text>
          </>
        ) : lookupFailed ? (
          <Text className="em-text-secondary" style={styles.provenance}>
            Couldn&rsquo;t check DOL&rsquo;s record just now
          </Text>
        ) : (
          <Text className="em-text-secondary" style={styles.provenance}>
            Not in our records yet
          </Text>
        )}
      </QueueStamp>

      {several ? (
        <>
          <Text className="em-text-body" style={styles.body}>
            If these are your cases, confirm below. We&rsquo;ll email you every time DOL&rsquo;s status for any of
            them changes, and we&rsquo;ll keep watching each one for a year after it&rsquo;s decided, in case
            it&rsquo;s appealed or reopened.
          </Text>
          {lookupFailed ? (
            <Text className="em-text-body" style={styles.body}>
              We couldn&rsquo;t check these case numbers just now. Check them against your receipts before you
              confirm. If you confirm, we&rsquo;ll start watching them and email you the first time a status moves
              after that.
            </Text>
          ) : notHeld.length > 0 ? (
            <Text className="em-text-body" style={styles.body}>
              {`We don\u2019t hold ${notHeld.length} of them yet: `}
              {notHeld.slice(0, NOT_HELD_NAMED).map((number, i) => (
                <span key={number}>
                  {i > 0 ? ", " : ""}
                  <span style={styles.numbers}>{number}</span>
                </span>
              ))}
              {notHeld.length > NOT_HELD_NAMED ? ` and ${notHeld.length - NOT_HELD_NAMED} more, marked in the list` : ""}
              {`. That\u2019s normal for a recent filing, and it\u2019s also what a typo looks like, so check ${notHeld.length === 1 ? "it against your receipt" : "them against your receipts"} first.`}
            </Text>
          ) : null}
          <Text className="em-text-secondary" style={styles.lag}>
            We ask DOL about watched cases every 5 minutes on weekdays from 7 AM
            to 9 PM Eastern, and every half hour otherwise. We email a change as
            soon as we see it, and every alert says since when DOL&rsquo;s record has shown the status.
          </Text>
          {listFirst ? (
            caseList
          ) : (
            <Text className="em-text-body" style={styles.body}>
              {`All ${cases.length} are listed under the button.`}
            </Text>
          )}
        </>
      ) : known ? (
        <>
          <Text className="em-text-body" style={styles.body}>
            If that&rsquo;s your case, confirm below. We&rsquo;ll email you
            every time DOL&rsquo;s status for it changes, and we&rsquo;ll keep
            watching for a year after it&rsquo;s decided, in case it&rsquo;s
            appealed or reopened. If it isn&rsquo;t your case, ignore this and
            enter the number again.
          </Text>
          <Text className="em-text-secondary" style={styles.lag}>
            We ask DOL about watched cases every 5 minutes on weekdays from 7 AM
            to 9 PM Eastern, and every half hour otherwise. We email a change as
            soon as we see it, and every alert says since when DOL&rsquo;s record has shown the status.
          </Text>
        </>
      ) : lookupFailed ? (
        <Text className="em-text-body" style={styles.body}>
          We couldn&rsquo;t check this case number just now. Check it against
          your receipt before you confirm. If you confirm, we&rsquo;ll start
          watching it and email you the first time its status moves after that.
        </Text>
      ) : (
        <Text className="em-text-body" style={styles.body}>
          We don&rsquo;t hold this case number yet. That&rsquo;s normal for a
          recent filing, and it&rsquo;s also what a typo looks like, so check it
          against your receipt first. If you confirm, we&rsquo;ll start watching
          it and email you the first time its status moves after that.
        </Text>
      )}

      {includesNews ? (
        <Text className="em-text-secondary" style={styles.newsNote}>
          You also asked for occasional product news. The same click confirms
          that.
        </Text>
      ) : null}
      {includesNewsletter ? (
        <Text className="em-text-secondary" style={styles.newsNote}>
          You also asked for the weekly digest. The
          same click confirms that.
        </Text>
      ) : null}

      <Section style={styles.cta}>
        <EmailButton href={confirmUrl} variant="primary">
          Confirm these alerts
        </EmailButton>
      </Section>

      {several && !listFirst ? caseList : null}

      <Text className="em-text-secondary" style={styles.note}>
        If you didn&rsquo;t ask for this, ignore it. Nothing will be sent.
      </Text>
    </EmailLayout>
  );
}

const styles = {
  numbers: {
    fontFamily: MONO_STACK,
    fontWeight: 600 as const,
    whiteSpace: "nowrap" as const,
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
    fontFamily: LIST_MONO,
    color: "#1A1A1A",
    fontSize: "14px",
    fontWeight: 600 as const,
    lineHeight: "20px",
    padding: "8px 12px 8px 10px",
    borderBottom: "1px solid #D9D9D9",
    whiteSpace: "nowrap" as const,
  },
  listStatus: {
    fontFamily: LIST_SANS,
    color: "#2A2A2A",
    fontSize: "14px",
    lineHeight: "20px",
    padding: "8px 0",
    borderBottom: "1px solid #D9D9D9",
  },
  listStatusNone: {
    fontFamily: LIST_SANS,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "20px",
    padding: "8px 0",
    borderBottom: "1px solid #D9D9D9",
  },
  provenance: {
    fontFamily: MONO_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "14px 0 0 0",
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
  // Above the button, not below it: a reader who clicks straight away never
  // sees anything under the CTA, and this line has to be read before the click
  // rather than after it.
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
CaseAlertConfirm.PreviewProps = {
  caseNumber: "P-100-26125-868956",
  currentStatus: "IN PROCESS",
  employerName: "Psomagen, Inc.",
  asOf: "August 5, 2026",
  confirmUrl: "https://example.convex.site/case-alert/confirm?token=abc",
} satisfies CaseAlertConfirmProps;

export default CaseAlertConfirm;
