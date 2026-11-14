// @vitest-environment jsdom
/**
 * A confirmation names everything its click confirms.
 *
 * When someone types several case numbers, or follows several employers, inside ten minutes, one follow-up email
 * confirms the ones still waiting (convex/caseAlerts.ts, `followUpConfirmation`), and a pasted list is confirmed
 * by one email (`subscribeList`). The click is consent only for what the email said, so each of them has to be
 * in it: above the button, or under it for a list too long to sit there, with a sentence above that says so.
 */
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { CaseAlertConfirm, LIST_ABOVE_BUTTON_MAX } from "../CaseAlertConfirm";
import { EmployerAlertConfirm } from "../EmployerAlertConfirm";
import { CASES_PER_ADDRESS } from "../../lib/caseList";

const CONFIRM = "https://permtracker.app/case-alert/confirm?token=T";

/** The email's words as a reader gets them: tags and the renderer's comment markers out, entities decoded. */
function wordsOf(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html.replace(/<!--.*?-->/g, "");
  return (el.textContent ?? "").replace(/\s+/g, " ");
}

describe("a confirmation for several", () => {
  const A = "G-100-26125-868956";
  const B = "G-100-26130-111111";
  const C = "P-100-26131-222222";

  it("names every case with its status, above the button", async () => {
    // Act
    const html = await render(
      CaseAlertConfirm({
        caseNumber: A,
        confirmUrl: CONFIRM,
        cases: [
          { caseNumber: A, status: "ANALYST REVIEW" },
          { caseNumber: B, status: null },
          { caseNumber: C, status: "DETERMINATION ISSUED" },
        ],
      }),
    );
    // Assert: each number and each status, the count, and all of it before the button.
    const text = wordsOf(html);
    expect(text).toContain("3 cases");
    expect(text).toContain("2 of them are in our records");
    for (const words of [A, B, C, "Analyst Review", "Determination Issued", "Not in our records yet"]) {
      expect(text).toContain(words);
      expect(text.indexOf(words)).toBeLessThan(text.indexOf("Confirm these alerts"));
    }
  });

  it("names the numbers it doesn't hold, as the ones to check", async () => {
    const html = await render(
      CaseAlertConfirm({
        caseNumber: A,
        confirmUrl: CONFIRM,
        cases: [
          { caseNumber: A, status: "ANALYST REVIEW" },
          { caseNumber: B, status: null },
        ],
      }),
    );
    expect(wordsOf(html)).toContain(`We don\u2019t hold 1 of them yet: ${B}. That\u2019s normal for a recent filing`);
    expect(wordsOf(html)).toContain("check it against your receipt first");
  });

  it("says so when DOL's record couldn't be read, and never calls a number missing", async () => {
    const html = await render(
      CaseAlertConfirm({
        caseNumber: A,
        confirmUrl: CONFIRM,
        lookupFailed: true,
        cases: [
          { caseNumber: A, status: null },
          { caseNumber: B, status: null },
        ],
      }),
    );
    const text = wordsOf(html);
    expect(text).toContain("We couldn\u2019t check these case numbers just now");
    expect(text).not.toContain("Not in our records yet");
    expect(text).not.toContain("We don\u2019t hold");
  });

  it("puts a long list under the button, and says so above it", async () => {
    // Arrange: one more than fits above the button.
    const cases = Array.from({ length: LIST_ABOVE_BUTTON_MAX + 1 }, (_, i) => ({
      caseNumber: `G-100-26125-${String(100000 + i)}`,
      status: "ANALYST REVIEW",
    }));
    // Act
    const text = wordsOf(await render(CaseAlertConfirm({ caseNumber: cases[0]!.caseNumber, confirmUrl: CONFIRM, cases })));
    // Assert: the button first, every case after it, and the sentence that says where they are.
    const button = text.indexOf("Confirm these alerts");
    expect(text.indexOf(`All ${cases.length} are listed under the button.`)).toBeLessThan(button);
    for (const c of cases) expect(text.indexOf(c.caseNumber)).toBeGreaterThan(button);
  });

  it("draws the list as a table a screen reader can read: a caption and a header for each column", async () => {
    const html = await render(
      CaseAlertConfirm({
        caseNumber: A,
        confirmUrl: CONFIRM,
        cases: [
          { caseNumber: A, status: "CERTIFIED" },
          { caseNumber: B, status: "DENIED" },
        ],
      }),
    );
    expect(html).toMatch(/<caption[^>]*>The cases this confirms<\/caption>/);
    expect(html.match(/<th scope="col"/g)).toHaveLength(2);
  });

  it("stays well under the size Gmail cuts a message off at, with the longest list there can be", async () => {
    // Arrange: the ceiling of cases, the longest number and status DOL has, both opt-ins and a long link.
    const cases = Array.from({ length: CASES_PER_ADDRESS }, (_, i) => ({
      caseNumber: `JO-A-300-26271-${String(264525 + i)}`,
      status: i % 3 === 0 ? null : "DENIED - BALCA AFFIRMED",
    }));
    // Act
    const html = await render(
      CaseAlertConfirm({
        caseNumber: cases[0]!.caseNumber,
        confirmUrl: `${CONFIRM}${"x".repeat(160)}`,
        cases,
        includesNews: true,
        includesNewsletter: true,
      }),
    );
    // Assert: Gmail clips past 102 KB, and a clipped email loses its footer.
    expect(new TextEncoder().encode(html).length).toBeLessThan(80_000);
  });

  it("draws one case as it always has, with no list", async () => {
    const html = await render(CaseAlertConfirm({ caseNumber: A, confirmUrl: CONFIRM }));
    expect(html).not.toContain("The cases this confirms");
    expect(wordsOf(html)).toContain("Your case number");
  });

  it("names each other employer above the button, with its size", async () => {
    const html = await render(
      EmployerAlertConfirm({
        employerName: "Adobe Inc.",
        confirmUrl: CONFIRM,
        alsoEmployers: ["Maplebear Inc. (every case)", "Zeta Labs LLC"],
      }),
    );
    expect(html).toContain("The same click also confirms your follow of Maplebear Inc. (every case), Zeta Labs LLC.");
    expect(html.indexOf("Zeta Labs LLC")).toBeLessThan(html.indexOf("Follow this employer"));
  });

  it("says nothing about other employers when there are none", async () => {
    const html = await render(EmployerAlertConfirm({ employerName: "Adobe Inc.", confirmUrl: CONFIRM }));
    expect(html).not.toContain("The same click also confirms your follow");
  });
});
