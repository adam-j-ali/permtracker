// @vitest-environment jsdom
/**
 * A confirmation names everything its click confirms.
 *
 * When someone types several case numbers, or follows several employers, inside ten minutes, one follow-up email
 * confirms the ones still waiting (convex/caseAlerts.ts, `followUpConfirmation`). The click is consent only for
 * what the email said, so each of them has to be in it, above the button.
 */
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { CaseAlertConfirm } from "../CaseAlertConfirm";
import { EmployerAlertConfirm } from "../EmployerAlertConfirm";

const CONFIRM = "https://permtracker.app/case-alert/confirm?token=T";

describe("a confirmation for several", () => {
  it("names each other case above the button", async () => {
    // Act
    const html = await render(
      CaseAlertConfirm({
        caseNumber: "G-100-26125-868956",
        confirmUrl: CONFIRM,
        alsoCases: ["G-100-26130-111111", "G-100-26131-222222"],
      }),
    );
    // Assert
    expect(html).toContain("G-100-26130-111111, G-100-26131-222222");
    expect(html).toContain("The same click also confirms alerts for the other cases you entered");
    expect(html.indexOf("G-100-26131-222222")).toBeLessThan(html.indexOf("Confirm these alerts"));
  });

  it("says case, not cases, for one other", async () => {
    const html = await render(
      CaseAlertConfirm({ caseNumber: "G-100-26125-868956", confirmUrl: CONFIRM, alsoCases: ["G-100-26130-111111"] }),
    );
    expect(html).toContain("for the other case you entered");
  });

  it("says nothing about other cases when there are none", async () => {
    const html = await render(CaseAlertConfirm({ caseNumber: "G-100-26125-868956", confirmUrl: CONFIRM }));
    expect(html).not.toContain("The same click also confirms alerts");
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
