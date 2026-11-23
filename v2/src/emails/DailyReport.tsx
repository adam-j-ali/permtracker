/**
 * The daily operator report, to the admin only (convex/dailyReport.ts).
 *
 * Sections needing a person come first, each with its status as a word
 * (colour alone does not survive every mail client), then everything that is
 * fine, collapsed to one line each.
 *
 * It's read on a phone. Each detail line is its own paragraph in the body
 * face: a typewriter face behind a ruled, padded margin left about 26
 * characters a line. An OK section's detail stays in the text part (reportText)
 * and on /admin#monitor, never in this HTML.
 */
import { Section, Text } from "@react-email/components";

import {
  type DailyReport as Report,
  type ReportSection,
  STATUS_RANK,
  attention,
  dayLabel,
  worstStatus,
} from "../../convex/lib/dailyReportCompose";
import { EmailHeader, EmailLayout } from "./components";
import { SITE_URL } from "../../convex/lib/links";

const STATUS_WORD: Record<ReportSection["status"], string> = {
  fail: "FAILING",
  warn: "WATCH",
  unknown: "UNREAD",
  off: "OFF",
  ok: "OK",
};

const STATUS_COLOR: Record<ReportSection["status"], string> = {
  fail: "#B42318",
  warn: "#9A5B00",
  unknown: "#5A5A5A",
  off: "#5A5A5A",
  ok: "#1E7B34",
};

export interface DailyReportProps {
  report: Report;
}

function SectionBlock({ s, full }: { s: ReportSection; full: boolean }) {
  return (
    <Section style={styles.section}>
      <Text className="em-text" style={styles.title}>
        <span style={{ ...styles.badge, color: STATUS_COLOR[s.status] }}>{STATUS_WORD[s.status]}</span>{" "}
        {s.title}
        {": "}
        <span style={styles.summary}>{s.summary}</span>
      </Text>
      {full
        ? s.lines.map((l, i) => (
            <Text key={i} className="em-text-body" style={styles.line}>
              {l}
            </Text>
          ))
        : null}
    </Section>
  );
}

export function DailyReport({ report }: DailyReportProps) {
  const need = attention(report);
  const rest = [...report.sections]
    .filter((s) => s.status !== "fail" && s.status !== "warn")
    .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);
  const overall = worstStatus(report.sections.map((s) => s.status));
  const headline =
    need.length === 0
      ? "Everything checked came back clean."
      : `${need.length} thing${need.length === 1 ? " needs" : "s need"} a look.`;

  return (
    <EmailLayout
      previewText={headline}
      settingsUrl={`${SITE_URL}/admin#monitor`}
      settingsLabel="Open the admin page"
      footerText="The daily operator report. Sent to the admin address only."
      dense
    >
      <EmailHeader
        title={`Daily report, ${dayLabel(report.day)}`}
        subtitle={headline}
        urgency={overall === "fail" ? "high" : "normal"}
      />
      {need.map((s) => (
        <SectionBlock key={s.key} s={s} full />
      ))}
      {rest.map((s) => (
        <SectionBlock key={s.key} s={s} full={false} />
      ))}
    </EmailLayout>
  );
}

const styles = {
  // No side padding: the layout's content box already pads the card.
  section: { padding: 0, marginBottom: "18px" },
  title: { fontSize: "15px", lineHeight: "22px", margin: "0 0 6px", fontWeight: 700 },
  badge: { fontSize: "14px", fontWeight: 700 },
  summary: { fontWeight: 400 },
  line: { fontSize: "15px", lineHeight: "21px", margin: "0 0 6px" },
} as const;
