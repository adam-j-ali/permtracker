/**
 * The follow alert: something happened to an employer's PERM cases, as a group or case by case.
 *
 * What moved comes first, one row per move, each sentence naming who acted
 * (DOL holds, releases, certifies and denies; the employer withdraws). An
 * "every case" follow's row lists the cases under it, each a link to its own
 * page, with the job title and filing month DOL holds so the reader can tell
 * whose case it is. Then
 * one bar: where the employer's pending cases sit today, in the same three
 * colours the site uses for the stage groups, so the email and the page it
 * links to read alike.
 *
 * No reason for any move appears here, and none may: DOL publishes none, and
 * an explanation from another employer's story printed beside this one's
 * count is a true fact making a false implication.
 *
 * @module
 */
import { Link, Section, Text } from "@react-email/components";
import { EmailLayout } from "./components";
import { SANS_STACK } from "./components/QueueStamp";
import { formatInt } from "../../convex/lib/format";
import { closingLine, followFooter } from "../lib/employerCaseMoves";

export interface EmployerMovedCase {
  number: string;
  url: string;
  /** "Software Engineer, filed Mar 2025", or "" when DOL's record has neither. */
  note: string;
}

export interface EmployerMovedProps {
  employerName: string;
  employerUrl: string;
  moves: {
    dateLabel: string;
    sentence: string;
    tone: "good" | "bad" | "neutral";
    /** An "every case" follow: the cases this row counts, oldest filing first. */
    cases?: EmployerMovedCase[];
    /** Cases the row counts and doesn't list. */
    more?: number;
  }[];
  /** Today's pending mix, or null when the employer isn't in the census (under five pending cases). */
  mix: { pending: number; queue: number; review: number; appeal: number; held: number } | null;
  /** "September 25, 2026": the day the census was taken. */
  asOf: string;
  /** Which size of follow sent this: it decides the footer's "why you got this". */
  scope?: "group" | "each";
  unsubscribeUrl: string;
  prefsUrl?: string;
}

/** The site's stage-group colours (globals.css, light theme). */
export const GROUP_HEX = { queue: "#4B5563", review: "#B45309", appeal: "#B3271A" } as const;

/**
 * Bar widths in whole percent. A group with any case gets at least 2% so it
 * is visible; the largest group absorbs the rounding so the row sums to 100.
 */
export function mixSegments(mix: { pending: number; queue: number; review: number; appeal: number }) {
  // The site's ribbon order: what DOL did, what the employer did, then the queue.
  const groups = (["review", "appeal", "queue"] as const).filter((g) => mix[g] > 0);
  if (mix.pending <= 0 || groups.length === 0) return [];
  const widths = groups.map((g) => ({ group: g, n: mix[g], w: Math.max(2, Math.round((100 * mix[g]) / mix.pending)) }));
  const biggest = widths.reduce((a, b) => (b.n > a.n ? b : a));
  biggest.w += 100 - widths.reduce((a, b) => a + b.w, 0);
  return widths;
}

export function EmployerMoved({
  employerName,
  employerUrl,
  moves,
  mix,
  asOf,
  scope = "group",
  unsubscribeUrl,
  prefsUrl,
}: EmployerMovedProps) {
  const segments = mix ? mixSegments(mix) : [];
  const legend = mix
    ? [
        mix.held > 0 ? `${formatInt(mix.held)} on hold` : "",
        mix.review - mix.held > 0 ? `${formatInt(mix.review - mix.held)} at RFI or other review` : "",
        mix.appeal > 0 ? `${formatInt(mix.appeal)} under appeal` : "",
        mix.queue > 0 ? `${formatInt(mix.queue)} waiting for an analyst` : "",
      ].filter(Boolean)
    : [];
  return (
    <EmailLayout
      previewText={`${employerName}: ${moves[0]?.sentence ?? "its PERM cases moved"}.`}
      hideSettingsLink={!prefsUrl}
      settingsUrl={prefsUrl}
      settingsLabel="Email preferences"
      footerText={followFooter(employerName, scope)}
      footerExtra={
        <Text className="em-text-secondary" style={styles.footerExtra}>
          <Link href={unsubscribeUrl} className="em-link" style={styles.footerLink}>
            Stop employer alerts
          </Link>
        </Text>
      }
    >
      <Section style={styles.stamp}>
        <Text className="em-text-secondary" style={styles.eyebrow}>Employer you follow</Text>
        <Text className="em-text" style={styles.name}>{employerName}</Text>
      </Section>

      {moves.map((m, i) => (
        <Section key={`${m.dateLabel}-${i}`} style={styles.item}>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
            <tbody>
              <tr>
                <td style={m.tone === "good" ? styles.markGood : m.tone === "bad" ? styles.markBad : styles.markNeutral}>
                  &nbsp;
                </td>
                <td style={styles.body}>
                  <Text className="em-text-secondary" style={styles.date}>
                    {`Recorded ${m.dateLabel} `}
                  </Text>
                  <Text className="em-text" style={styles.sentence}>{`${m.sentence}.`}</Text>
                  {(m.cases ?? []).map((c) => (
                    <Text key={c.number} className="em-text-body" style={styles.caseRow}>
                      <Link href={c.url} className="em-link" style={styles.caseLink}>
                        {c.number}
                      </Link>
                      {c.note ? ` ${c.note}` : ""}
                    </Text>
                  ))}
                  {m.more && m.more > 0 ? (
                    <Text className="em-text-secondary" style={styles.caseMore}>
                      {`and ${formatInt(m.more)} more, listed on its page`}
                    </Text>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ))}

      {mix && segments.length > 0 ? (
        <Section style={styles.mixWrap}>
          <Text className="em-text-secondary" style={styles.eyebrow}>
            {`Its ${formatInt(mix.pending)} pending cases today`}
          </Text>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={styles.bar}>
            <tbody>
              <tr>
                {segments.map((s) => (
                  <td key={s.group} width={`${s.w}%`} style={{ ...styles.segment, backgroundColor: GROUP_HEX[s.group] }}>
                    &nbsp;
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <Text className="em-text-body" style={styles.legend}>
            {legend.join(", ")}
          </Text>
        </Section>
      ) : null}

      <Text className="em-text-body" style={styles.bodyText}>
        {closingLine(scope, asOf, mix !== null)}
      </Text>
      <Link href={employerUrl} className="em-link" style={styles.open}>
        {`See every figure for ${employerName}`}
      </Link>
    </EmailLayout>
  );
}

const MARK = { width: "8px", padding: 0 } as const;

const styles = {
  stamp: { marginBottom: "20px" },
  eyebrow: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    fontWeight: 700 as const,
    margin: "0 0 6px 0",
  },
  name: {
    fontFamily: SANS_STACK,
    color: "#1A1A1A",
    fontSize: "26px",
    fontWeight: 700 as const,
    lineHeight: "32px",
    margin: 0,
  },
  item: { marginBottom: "12px" },
  markGood: { ...MARK, backgroundColor: "#2ECC40", border: "2px solid #000001" },
  markBad: { ...MARK, backgroundColor: "#FFFFFE", border: "2px solid #000001" },
  markNeutral: { ...MARK, backgroundColor: "#D4D4D8", border: "2px solid #D4D4D8" },
  body: { paddingLeft: "14px", verticalAlign: "top" as const },
  date: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    margin: "0 0 2px 0",
  },
  sentence: {
    fontFamily: SANS_STACK,
    color: "#1A1A1A",
    fontSize: "17px",
    fontWeight: 700 as const,
    lineHeight: "24px",
    margin: 0,
  },
  caseRow: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "15px",
    lineHeight: "22px",
    margin: "6px 0 0 0",
  },
  caseLink: {
    color: "#1A1A1A",
    fontWeight: 600 as const,
    textDecorationLine: "underline" as const,
  },
  caseMore: {
    fontFamily: SANS_STACK,
    color: "#5A5A5A",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "6px 0 0 0",
  },
  mixWrap: { margin: "22px 0 18px 0" },
  bar: { border: "2px solid #000001", borderCollapse: "collapse" as const },
  segment: { height: "18px", padding: 0, fontSize: "1px", lineHeight: "1px" },
  legend: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "14px",
    lineHeight: "21px",
    margin: "8px 0 0 0",
  },
  bodyText: {
    fontFamily: SANS_STACK,
    color: "#2A2A2A",
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 12px 0",
  },
  open: {
    fontFamily: SANS_STACK,
    color: "#1A1A1A",
    fontSize: "15px",
    fontWeight: 600 as const,
    textDecorationLine: "underline" as const,
  },
  footerExtra: { fontSize: "14px", margin: "8px 0 0 0" },
  footerLink: { color: "#5A5A5A", textDecorationLine: "underline" as const },
} as const;
