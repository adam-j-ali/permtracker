// @vitest-environment jsdom
/**
 * The employers page's email picture is the real template drawn from a sample. This holds the three things said
 * about that picture (its subject line, its alt text, its sentences) to the sample and to the code that words a
 * real alert, and writes the email to a file when asked, for taking the picture again.
 */
import { writeFileSync } from "node:fs";

import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { EmployerMoved } from "@/emails/EmployerMoved";
import { caseMoveSentence } from "@/lib/employerCaseMoves";

import { EMPLOYER_EMAIL_SAMPLE, EMPLOYER_EMAIL_SUBJECT } from "../employerEmailSample";
import { EMPLOYER_SHOTS } from "../employerShots";

/** The picture's description (scripts/page-pictures.json, "employers/email"). */
const ALT = EMPLOYER_SHOTS.email.alt;

describe("the employers page's sample email", () => {
  it("uses the sentences a real alert would", () => {
    const [certified, asked] = EMPLOYER_EMAIL_SAMPLE.moves;
    expect(certified?.sentence).toBe(caseMoveSentence("ANALYST REVIEW", "CERTIFIED", certified?.cases?.length ?? 0));
    expect(asked?.sentence).toBe(caseMoveSentence("ANALYST REVIEW", "RFI ISSUED", asked?.cases?.length ?? 0));
  });

  it("goes out under the subject the picture's title bar shows", () => {
    const { employerName, moves } = EMPLOYER_EMAIL_SAMPLE;
    expect(EMPLOYER_EMAIL_SUBJECT).toBe(`${employerName}: ${moves[0]!.sentence}, and ${moves.length - 1} more`);
    expect(EMPLOYER_EMAIL_SUBJECT.length).toBeLessThanOrEqual(78);
  });

  it("renders, and its alt text says what it shows", async () => {
    // Act
    const html = await render(EmployerMoved(EMPLOYER_EMAIL_SAMPLE));
    if (process.env.EMAIL_SAMPLE_OUT) writeFileSync(process.env.EMAIL_SAMPLE_OUT, html);
    // Assert: every fact the alt text gives is in the email.
    for (const said of [
      "Halcyon Robotics",
      "DOL certified 2 of its cases",
      "DOL sent a request for information on 1 of its cases",
      "2 at RFI or other review, 12 waiting for an analyst",
    ]) {
      expect(html).toContain(said);
      expect(ALT).toContain(said);
    }
    expect(html).toContain("14 pending cases today");
    expect(ALT).toContain("14 pending cases today");
    for (const c of EMPLOYER_EMAIL_SAMPLE.moves.flatMap((m) => m.cases ?? [])) expect(html).toContain(c.number);
  });
});
