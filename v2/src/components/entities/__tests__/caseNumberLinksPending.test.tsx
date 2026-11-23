import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * A case number in a list opens /perm-case-status, the slowest page on the site: a case it doesn't hold is asked of
 * DOL live, about 3.5 seconds. With a bare link the press looked ignored, and 48 of the 164 rage clicks on employer
 * pages in 30 days to Nov 23 2026 were on the case numbers in "Its newest filings". Every list's case number now
 * shows that it heard the press while the page loads.
 */

vi.mock("next/link", () => ({
  default: ({ prefetch: _p, children, ...rest }: { prefetch?: unknown; children?: React.ReactNode }) => <a {...rest}>{children}</a>,
  // Every link is mid-navigation, so each pending mark shows.
  useLinkStatus: () => ({ pending: true }),
}));

import { DecidedTable } from "@/components/activity/DecidedTable";
import { FilingRows } from "@/components/entities/FilingRows";
import { DayCaseRow } from "@/components/queue/DayCaseRow";

const linkTo = (caseNumber: string) => screen.getByRole("link", { name: caseNumber });

describe("a case number in a list shows it heard the press", () => {
  it("in an employer's newest filings", () => {
    render(<FilingRows rows={[{ caseNumber: "G-100-26012-553242", job: "Production Engineer", date: "2026-01-12", status: "RFI ISSUED" }]} />);
    const link = linkTo("G-100-26012-553242");
    // The spinner sits inside the link, hidden from a screen reader, so the link's name stays the number.
    expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/perm-case-status?case=G-100-26012-553242");
  });

  it("in a day's list of filings", () => {
    render(
      <ul>
        <DayCaseRow c={{ caseNumber: "G-100-26200-100001", status: "IN PROCESS", employer: "Acme", employerSlug: null, jobTitle: "Engineer", final: false }} />
      </ul>,
    );
    expect(linkTo("G-100-26200-100001").querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("in the table of DOL's published decisions", () => {
    render(
      <DecidedTable
        caption="Decided"
        sort={{ key: "decidedOn", dir: "desc" }}
        onSort={() => {}}
        rows={[
          {
            caseNumber: "G-100-25001-000001",
            program: "perm",
            status: "certified",
            decidedOn: "2025-03-03",
            receivedOn: "2024-01-02",
            employerName: "Employer",
            employerSlug: null,
            jobTitle: "Engineer",
            socCode: null,
            socTitle: null,
            state: null,
            wage: null,
            wageUnit: null,
            attorneyName: null,
            attorneySlug: null,
          } as never,
        ]}
      />,
    );
    // A table keeps the dot, which holds its place, so a column never widens under the press.
    expect(linkTo("G-100-25001-000001").querySelector("[data-pending]")).not.toBeNull();
  });

  it.each(["src/components/activity/ChangeTable.tsx", "src/components/rfi/StageCaseBrowser.tsx", "src/components/rfi/StageExitBrowser.tsx"])(
    "in %s, whose case number is a pending link",
    (file) => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).toMatch(/<PendingLink\s+href=\{`\/perm-case-status\?case=\$\{encodeURIComponent\(\w+\.caseNumber\)\}`\}/);
      expect(src).not.toMatch(/<IntentLink\s+href=\{`\/perm-case-status\?case=/);
    },
  );
});
