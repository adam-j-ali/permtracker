import type { EmployerMovedProps } from "@/emails/EmployerMoved";

/**
 * The employers page's picture of the every-case email is the follow alert's own template (src/emails/
 * EmployerMoved.tsx) drawn from this sample, so the page can't show an email the product doesn't send. The company
 * is one of the tour's invented employers and the cases are made up; the picture's caption says so.
 *
 * To take the picture again after the template changes: `EMAIL_SAMPLE_OUT=<file>.html pnpm vitest run --project
 * components src/components/marketing/__tests__/employerEmailSample.test.tsx` writes the email, a browser captures
 * the card in both colour schemes at 640px wide, and `scripts/page_shots.py <dir> employers` makes the WebPs
 * (the "employers/email" entry in scripts/page-pictures.json carries no capture of its own for that reason).
 */
export const EMPLOYER_EMAIL_SAMPLE: EmployerMovedProps = {
  employerName: "Halcyon Robotics",
  employerUrl: "https://permtracker.app/perm-employers",
  scope: "each",
  moves: [
    {
      dateLabel: "Nov 12",
      sentence: "DOL certified 2 of its cases",
      tone: "good",
      cases: [
        { number: "G-100-25349-118204", url: "https://permtracker.app/perm-case-status", note: "Controls Engineer II, filed Dec 2025" },
        { number: "G-100-25352-120877", url: "https://permtracker.app/perm-case-status", note: "Robotics Software Engineer, filed Dec 2025" },
      ],
      more: 0,
    },
    {
      dateLabel: "Nov 12",
      sentence: "DOL sent a request for information on 1 of its cases",
      tone: "neutral",
      cases: [{ number: "G-100-26021-204415", url: "https://permtracker.app/perm-case-status", note: "Mechanical Design Engineer, filed Jan 2026" }],
      more: 0,
    },
  ],
  mix: { pending: 14, queue: 12, review: 2, appeal: 0, held: 0 },
  asOf: "November 13, 2026",
  unsubscribeUrl: "https://permtracker.app/email-preferences",
  prefsUrl: "https://permtracker.app/email-preferences",
};

/** The subject that email goes out under (`employerSubject`), shown in the picture's title bar. */
export const EMPLOYER_EMAIL_SUBJECT = "Halcyon Robotics: DOL certified 2 of its cases, and 1 more";
