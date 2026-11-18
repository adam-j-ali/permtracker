/**
 * The email asking an alert subscriber without an account to accept a policy change (convex/policyConsent.ts).
 *
 * Sent only after the owner bumps POLICY_CONSENT_VERSION for a change that affects information already given, and
 * runs the sweep by hand. What changed, that nothing applies until they accept, one button to the page that takes
 * the click (a POST behind it, so a mail scanner opening the link accepts nothing), and their way out.
 */
import { Section, Text } from "@react-email/components";
import { EmailButton, EmailLayout } from "./components";
import { SANS_STACK } from "./components/QueueStamp";

export interface PolicyChangeProps {
  /** Absolute link to the accept page, signed for this address and this version. */
  acceptUrl: string;
  /** The address's email preferences page. */
  prefsUrl: string;
}

export function PolicyChange({ acceptUrl, prefsUrl }: PolicyChangeProps) {
  return (
    <EmailLayout
      previewText="We changed how we use information you've given us. Nothing changes for you until you accept."
      settingsUrl={prefsUrl}
      settingsLabel="Email preferences"
      footerText="You get this because this address receives PERM Tracker alerts."
    >
      <Section style={styles.stamp}>
        <Text className="em-text-secondary" style={styles.stampEyebrow}>We updated</Text>
        <Text className="em-text" style={styles.stampValue}>Our Privacy Policy and Terms</Text>
      </Section>

      <Text className="em-text-body" style={styles.body}>
        The change affects how we use information you&rsquo;ve already given us, so it waits for you. Until you
        accept it, your alerts keep running under the version you last agreed to.
      </Text>

      <Section style={styles.cta}>
        <EmailButton href={acceptUrl} variant="primary">
          Read the change and accept
        </EmailButton>
      </Section>

      <Text className="em-text-secondary" style={styles.note}>
        You don&rsquo;t have to do anything else, and you can turn your alerts off at any time from your email
        preferences.
      </Text>
    </EmailLayout>
  );
}

PolicyChange.PreviewProps = {
  acceptUrl: "https://permtracker.app/prefs/policy?token=preview&v=2027-02-01",
  prefsUrl: "https://permtracker.app/prefs?token=preview",
} satisfies PolicyChangeProps;

export default PolicyChange;

const styles = {
  stamp: { marginBottom: "24px" },
  stampEyebrow: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", margin: "0 0 4px 0" },
  stampValue: { fontFamily: SANS_STACK, color: "#1A1A1A", fontSize: "28px", fontWeight: 700, lineHeight: "34px", margin: 0 },
  body: { fontFamily: SANS_STACK, color: "#2A2A2A", fontSize: "16px", lineHeight: "26px", margin: "0 0 24px 0" },
  cta: { marginBottom: "20px" },
  note: { fontFamily: SANS_STACK, color: "#5A5A5A", fontSize: "14px", lineHeight: "20px", margin: 0 },
} as const;
