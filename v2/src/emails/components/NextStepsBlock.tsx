/**
 * "What comes next": the step after the one an email reports, set apart by a
 * lime rule so it reads as the email's second message rather than another
 * table. Each step is a bold title, one short sentence and its one link; the
 * step marked `button` draws its link as an outline button (the onward
 * alert), and any further reading follows as plain links. Every form name
 * (I-140, I-485) stays on one line (EmailKeepWhole).
 *
 * The words and links come from convex/lib/alertNextSteps.ts, which the
 * plain-text part reads too (`nextStepsText`), so the two parts never differ.
 *
 * @module
 */

import { Link, Section, Text } from "react-email";

import type { NextSteps } from "../../../convex/lib/alertNextSteps";
import { EmailButton } from "./EmailButton";
import { EmailKeepWhole } from "./EmailKeepWhole";
import { SANS_STACK } from "./QueueStamp";

export interface NextStepsBlockProps {
  next: NextSteps;
  /** The block's heading. */
  heading?: string;
}

export function NextStepsBlock({ next, heading = "What comes next" }: NextStepsBlockProps) {
  return (
    <Section style={styles.next}>
      <Text className="em-text" style={styles.heading}>
        {heading}
      </Text>
      {next.steps.map((s) => (
        <Section key={s.title} style={styles.step}>
          <Text className="em-text-body" style={styles.body}>
            <strong>
              <EmailKeepWhole>{`${s.title}.`}</EmailKeepWhole>
            </strong>{" "}
            <EmailKeepWhole>{s.body}</EmailKeepWhole>
          </Text>
          {s.link ? (
            s.button ? (
              <Section style={styles.button}>
                <EmailButton href={s.link.href} variant="outline">
                  <EmailKeepWhole>{s.link.text}</EmailKeepWhole>
                </EmailButton>
              </Section>
            ) : (
              <Text style={styles.linkRow}>
                <Link href={s.link.href} className="em-link-strong" style={styles.link}>
                  <EmailKeepWhole>{s.link.text}</EmailKeepWhole>
                </Link>
              </Text>
            )
          ) : null}
        </Section>
      ))}
      {next.links.map((l) => (
        <Text key={l.href} style={styles.linkRow}>
          <Link href={l.href} className="em-link-strong" style={styles.link}>
            <EmailKeepWhole>{l.text}</EmailKeepWhole>
          </Link>
        </Text>
      ))}
    </Section>
  );
}

const styles = {
  next: {
    margin: "8px 0 28px 0",
    padding: "4px 0 0 16px",
    borderLeft: "4px solid #2ECC40",
  },
  heading: {
    fontFamily: SANS_STACK,
    color: "#000001",
    fontSize: "18px",
    fontWeight: 700 as const,
    lineHeight: "24px",
    margin: "0 0 10px 0",
  },
  step: {
    margin: "0 0 12px 0",
  },
  body: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "16px",
    lineHeight: "25px",
    margin: "0",
  },
  button: {
    margin: "10px 0 8px 0",
  },
  linkRow: {
    margin: "0",
  },
  link: {
    fontFamily: SANS_STACK,
    color: "#1A1A1A",
    fontSize: "15px",
    fontWeight: 600 as const,
    textDecorationLine: "underline" as const,
    // A standalone link on its own line: inline-block puts the padding inside
    // the hit box, so each one is a 44px tap target like the link list's.
    display: "inline-block",
    padding: "12px 0",
    lineHeight: "20px",
  },
} as const;
