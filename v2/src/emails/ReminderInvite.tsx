/**
 * The one email a case's second reminder recipient gets before they say yes (convex/reminderRecipients.ts).
 *
 * It says who asked (the account's display name, or "a PERM Tracker user"), for which case (the job title at the
 * employer), what the reminders hold and how to stop them, with one Confirm button. Its link opens a page with a
 * button: opening the link confirms nothing. Ignored, nothing else is ever sent.
 */
import { Section, Text } from "@react-email/components";
import { EmailButton, EmailLayout } from "./components";
import { SANS_STACK } from "./components/QueueStamp";
import { INVITE_DAYS, sentenceStart } from "../../convex/lib/reminderRecipients";

export interface ReminderInviteProps {
  /** Who asked, as the email may show it (convex/lib/reminderRecipients.ts, `inviterName`). */
  inviter: string;
  /** "Robotics Engineer at ACME Robotics". */
  caseLine: string;
  /** Absolute, row-scoped confirmation URL. */
  confirmUrl: string;
}

export function ReminderInvite({ inviter, caseLine, confirmUrl }: ReminderInviteProps) {
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
    </EmailLayout>
  );
}

ReminderInvite.PreviewProps = {
  inviter: "Jordan Lee",
  caseLine: "Robotics Engineer at ACME Robotics",
  confirmUrl: "https://permtracker.app/case-alert/reminders/confirm?token=preview&r=preview",
} satisfies ReminderInviteProps;

export default ReminderInvite;

const styles = {
  stamp: { marginBottom: "24px" },
  stampEyebrow: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", margin: "0 0 4px 0" },
  stampValue: { fontFamily: SANS_STACK, color: "#1A1A1A", fontSize: "24px", fontWeight: 700, lineHeight: "30px", margin: 0 },
  body: { fontFamily: SANS_STACK, color: "#2A2A2A", fontSize: "16px", lineHeight: "26px", margin: "0 0 20px 0" },
  cta: { marginBottom: "20px" },
  note: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", lineHeight: "20px", margin: 0 },
} as const;
