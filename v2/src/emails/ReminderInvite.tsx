/**
 * The one email a case's second reminder recipient gets before they say yes (convex/reminderRecipients.ts).
 *
 * It says who asked (the account's display name, or "a PERM Tracker user"), for which case (the job title at the
 * employer, or "a PERM case" when either reads like a link or a phone number: safeCaseLine), what the reminders hold
 * and how to stop them, with one Confirm button. Its link opens a page with a button: opening the link confirms nothing. Ignored,
 * nothing else is ever sent. Under the button, "Don't invite me again" opens a page whose button puts the address on
 * the refusal list, so no account can invite it again.
 */
import { Link, Section, Text } from "@react-email/components";
import { EmailButton, EmailLayout } from "./components";
import { SANS_STACK } from "./components/QueueStamp";
import { INVITE_DAYS, sentenceStart } from "../../convex/lib/reminderRecipients";

export interface ReminderInviteProps {
  /** Who asked, as the email may show it (convex/lib/reminderRecipients.ts, `inviterName`). */
  inviter: string;
  /** "Robotics Engineer at ACME Robotics", or "a PERM case" (convex/lib/reminderRecipients.ts, `safeCaseLine`). */
  caseLine: string;
  /** Absolute, row-scoped confirmation URL. */
  confirmUrl: string;
  /** Absolute "Don't invite me again" URL, signed for its own purpose (reminderDeclinePurpose). */
  declineUrl: string;
}

export function ReminderInvite({ inviter, caseLine, confirmUrl, declineUrl }: ReminderInviteProps) {
  const who = sentenceStart(inviter);
  return (
    <EmailLayout
      previewText="Confirm and you’ll get this case’s deadline reminders. Ignore it and nothing more is sent."
      hideSettingsLink
      footerText="This address was entered by a PERM Tracker user for a case’s deadline reminders. It isn’t confirmed, so nothing else will be sent."
    >
      <Section style={styles.stamp}>
        <Text className="em-text-secondary" style={styles.stampEyebrow}>Deadline reminders for</Text>
        <Text className="em-text" style={styles.stampValue}>{caseLine}</Text>
      </Section>

      <Text className="em-text-body" style={styles.body}>
        {who} tracks this PERM case on PERM Tracker and asked us to send you its deadline reminders too.
      </Text>

      <Text className="em-text-body" style={styles.body}>
        When one of the case&rsquo;s deadlines comes near, we&rsquo;ll email you its name and its date. The emails
        name the employer, the job title and the deadlines, and nothing else from the case. Each one has a
        link that stops them with one click.
      </Text>

      <Section style={styles.cta}>
        <EmailButton href={confirmUrl} variant="primary">
          Confirm the reminders
        </EmailButton>
      </Section>

      <Text className="em-text-secondary" style={styles.note}>
        If you don&rsquo;t want these, ignore this email. Nothing more will be sent, and we&rsquo;ll delete your
        address in {INVITE_DAYS} days.
      </Text>

      <Text className="em-text-secondary" style={styles.note}>
        Don&rsquo;t want to be asked again? Use this link, and no one on PERM Tracker can invite this address again.
      </Text>
      <Text className="em-text-secondary" style={styles.declineLine}>
        <Link href={declineUrl} className="em-link" style={styles.declineLink}>
          Don&rsquo;t invite me again
        </Link>
      </Text>
    </EmailLayout>
  );
}

ReminderInvite.PreviewProps = {
  inviter: "Jordan Lee",
  caseLine: "Robotics Engineer at ACME Robotics",
  confirmUrl: "https://permtracker.app/case-alert/reminders/confirm?token=preview&r=preview",
  declineUrl: "https://permtracker.app/case-alert/reminders/decline?token=preview&r=preview",
} satisfies ReminderInviteProps;

export default ReminderInvite;

const styles = {
  stamp: { marginBottom: "24px" },
  stampEyebrow: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", margin: "0 0 4px 0" },
  stampValue: { fontFamily: SANS_STACK, color: "#1A1A1A", fontSize: "24px", fontWeight: 700, lineHeight: "30px", margin: 0 },
  body: { fontFamily: SANS_STACK, color: "#2A2A2A", fontSize: "16px", lineHeight: "26px", margin: "0 0 20px 0" },
  cta: { marginBottom: "20px" },
  note: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", lineHeight: "20px", margin: "0 0 12px 0" },
  declineLine: { fontFamily: SANS_STACK, fontSize: "14px", lineHeight: "18px", margin: 0 },
  // A standalone control on its own line: inline-block with padding makes the hit box 44px tall.
  declineLink: { color: "#5A5A5A", textDecoration: "underline", display: "inline-block", padding: "13px 4px" },
} as const;
