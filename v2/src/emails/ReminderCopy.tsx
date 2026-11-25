/**
 * A case's deadline reminders for the second person who confirmed them (convex/reminderRecipients.ts): the same rows
 * the owner's daily email shows, for this one case, a line saying the reader confirmed them, when it was checked
 * (Eastern) and a one-click stop that pairs with the email's List-Unsubscribe header. It names nobody: the
 * invitation said who asked, and the Privacy Policy says these name the employer, the job title and the deadlines.
 *
 * The second person has no account, so there's no link into the app and no settings link: the stop link is the way
 * out. Nothing of the case beyond the employer, the job title and the deadlines is shown.
 */
import { Link, Section, Text } from "react-email";
import { EmailLayout } from "./components";
import { SANS_STACK } from "./components/QueueStamp";
import { urgencyHeadStyle, urgencyHeadText, urgencyRow, urgencyRowLast } from "./components/emailStyles";
import { formatDateForDisplay, formatRelativeDays, getUrgencyColor } from "../../convex/lib/digestHelpers";
import { deadlineDigestWords } from "../../convex/lib/deadlineDigestWords";
import type { CopyItem } from "../../convex/lib/reminderRecipients";

export interface ReminderCopyProps {
  /** "Robotics Engineer at ACME Robotics", or "a PERM case" (convex/lib/reminderRecipients.ts, `safeCaseLine`). */
  caseLine: string;
  /** The case's reminders due today, most urgent first. */
  items: CopyItem[];
  /** "November 20, 2026, 9:00 AM ET". */
  checkedAt: string;
  /** The one-click stop page for this recipient. */
  stopUrl: string;
}

/** Section order, label and banner colour: the owner's daily email's. */
const SECTIONS: ReadonlyArray<{ key: CopyItem["urgency"]; label: string; color: string }> = [
  { key: "overdue", label: "Overdue", color: "#991B1B" },
  { key: "urgent", label: "This week", color: "#DC2626" },
  { key: "upcoming", label: "Next week", color: "#C2410C" },
  { key: "later", label: "Coming up", color: "#2563EB" },
];

export function ReminderCopy({ caseLine, items, checkedAt, stopUrl }: ReminderCopyProps) {
  const words = deadlineDigestWords(items.length, items.filter((i) => i.urgency === "overdue").length);
  return (
    <EmailLayout
      previewText={words.preview}
      hideSettingsLink
      footerText="You get these because you confirmed this case’s deadline reminders on PERM Tracker."
      footerExtra={
        <Text className="em-text-secondary" style={styles.footerExtra}>
          <Link href={stopUrl} className="em-link" style={styles.footerLink}>
            Stop these reminders
          </Link>
        </Text>
      }
    >
      <Section style={styles.stamp}>
        <Text className="em-text-secondary" style={styles.stampEyebrow}>Deadline reminders for</Text>
        <Text className="em-text" style={styles.stampValue}>{caseLine}</Text>
      </Section>

      <Text className="em-text-body" style={styles.body}>
        {words.headline}. Here&rsquo;s what&rsquo;s due, most urgent first.
      </Text>

      {SECTIONS.map(({ key, label, color }) => {
        const rows = items.filter((i) => i.urgency === key);
        if (rows.length === 0) return null;
        return (
          <Section key={key} style={styles.section}>
            <Section className="em-banner" style={urgencyHeadStyle(color)}>
              <Text className="em-text-white" style={urgencyHeadText}>
                {`${label} (${rows.length})`}
              </Text>
            </Section>
            {rows.map((item, i) => (
              <Section
                key={`${item.deadlineType}-${item.deadlineDate}`}
                className="em-deadline-row"
                style={i === rows.length - 1 ? { ...urgencyRow, ...urgencyRowLast } : urgencyRow}
              >
                <table width="100%" cellPadding="0" cellSpacing="0" role="presentation">
                  <tbody>
                    <tr>
                      <td style={styles.rowContent}>
                        <Text className="em-text" style={styles.deadlineType}>
                          {item.deadlineType}
                        </Text>
                      </td>
                      <td style={styles.dateCell}>
                        <Text className="em-text" style={styles.date}>
                          {formatDateForDisplay(item.deadlineDate)}
                        </Text>
                        <Text
                          className={item.urgency === "overdue" || item.urgency === "urgent" ? "em-days-overdue" : "em-days-warning"}
                          style={{ ...styles.days, color: getUrgencyColor(item.urgency) }}
                        >
                          {formatRelativeDays(item.daysUntil)}
                        </Text>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            ))}
          </Section>
        );
      })}

      <Text className="em-text-secondary" style={styles.note}>
        You confirmed these reminders. Checked {checkedAt}.
      </Text>
    </EmailLayout>
  );
}

ReminderCopy.PreviewProps = {
  caseLine: "Robotics Engineer at ACME Robotics",
  checkedAt: "November 20, 2026, 9:00 AM ET",
  stopUrl: "https://permtracker.app/case-alert/reminders/stop?token=preview&r=preview&u=preview",
  items: [
    { deadlineType: "ETA 9089 filing window closes", deadlineDate: "2026-11-19", daysUntil: -1, urgency: "overdue" },
    { deadlineType: "PWD expiration", deadlineDate: "2026-11-27", daysUntil: 7, urgency: "urgent" },
  ],
} satisfies ReminderCopyProps;

export default ReminderCopy;

const styles = {
  stamp: { marginBottom: "24px" },
  stampEyebrow: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", margin: "0 0 4px 0" },
  stampValue: { fontFamily: SANS_STACK, color: "#1A1A1A", fontSize: "24px", fontWeight: 700, lineHeight: "30px", margin: 0 },
  body: { fontFamily: SANS_STACK, color: "#2A2A2A", fontSize: "16px", lineHeight: "26px", margin: "0 0 20px 0" },
  section: { marginBottom: "24px" },
  rowContent: { verticalAlign: "top" as const, paddingRight: "12px" },
  deadlineType: { color: "#18181b", fontSize: "14px", fontWeight: "600" as const, margin: "0" },
  dateCell: { textAlign: "right" as const, verticalAlign: "top" as const },
  date: { color: "#18181b", fontSize: "14px", fontWeight: "600" as const, margin: "0 0 2px 0" },
  days: { fontSize: "14px", fontWeight: "700" as const, margin: "0" },
  note: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", lineHeight: "20px", margin: 0 },
  footerExtra: { color: "#5F5F67", fontSize: "14px", lineHeight: "18px", margin: "0 0 12px 0" },
  // A standalone control on its own line: inline-block with padding makes the hit box 44px tall.
  footerLink: { color: "#5F5F67", textDecoration: "underline", display: "inline-block", padding: "13px 4px" },
} as const;
