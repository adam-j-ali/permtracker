/**
 * The last receipt alert: a receipt reached a final status a year ago and nothing has moved since, so its watch ends
 * (convex/uscisAlerts.ts retireReceipt). Said once, plainly, with the way to watch it again. Before Nov 26 2026 the
 * watch just went, and the person never knew they'd stopped hearing.
 */

import { Text } from "react-email";
import { EmailButton, EmailLayout } from "./components";
import { SANS_STACK } from "./components/QueueStamp";
import { EXAMPLE_ONLINE_RECEIPT } from "../lib/uscis/exampleReceipts";

export interface UscisWatchEndedProps {
  receipts: string[];
  /** The receipt lookup, where a receipt can be signed up again. */
  lookupUrl: string;
  prefsUrl: string;
}

export function UscisWatchEnded({ receipts, lookupUrl, prefsUrl }: UscisWatchEndedProps) {
  const several = receipts.length > 1;
  const which = several ? `${receipts.length} receipts` : (receipts[0] ?? "your receipt");
  return (
    <EmailLayout
      previewText={`We've stopped watching ${which}, a year after its final status.`}
      settingsUrl={prefsUrl}
      settingsLabel="Email preferences"
      footerText="This is the last email about these receipts. Receipt alerts are a beta."
    >
      <Text className="em-text-body" style={styles.lede}>
        {several
          ? `We've stopped watching ${receipts.join(", ")}. Each reached a final status a year ago, and nothing has changed since.`
          : `We've stopped watching ${which}. It reached a final status a year ago, and nothing has changed since.`}
      </Text>{" "}
      <Text className="em-text-body" style={styles.lede}>
        You can sign a receipt up again at any time, and we&apos;ll email you when its status changes.
      </Text>{" "}
      <EmailButton href={lookupUrl} variant="primary">
        Watch a receipt again
      </EmailButton>
    </EmailLayout>
  );
}

UscisWatchEnded.PreviewProps = {
  receipts: [EXAMPLE_ONLINE_RECEIPT],
  lookupUrl: "https://permtracker.app/uscis-case-status",
  prefsUrl: "https://permtracker.app/email-preferences?token=preview",
} satisfies UscisWatchEndedProps;

export default UscisWatchEnded;

const styles = {
  lede: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "16px",
    lineHeight: "26px",
    margin: "0 0 20px 0",
  },
};
