// @vitest-environment jsdom
/**
 * The cases people reported at one office, a page at a time.
 *
 * /i485-by-field-office/national-benefits-center was 3.49 MB of HTML on Nov 20 2026, past the 2 MB Googlebot reads:
 * the every-case table drew all 1,568 rows into the page and again into the data the browser hydrates from, and a
 * style rule hid all but 25. The server now draws one page, and the rest travel as short rows of text the pager draws.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OfficeReportedCases, caseCells } from "../OfficeReportedCases";
import type { ReportedCase } from "@/lib/reportedCases";

const reported = (n: number): ReportedCase => ({
  id: `case-${n}`,
  sources: n % 3 === 0 ? ["reddit", "telegram"] : ["visastats"],
  category: n % 2 ? "EB-2" : "EB-3",
  chargeability: n % 2 ? "India" : "China",
  priorityDate: "2023-03-04",
  priorityNote: null,
  receiptDate: "2024-04-01",
  biometricsDate: "2024-05-02",
  transferDate: `2025-${String((n % 12) + 1).padStart(2, "0")}-15`,
  approvalDate: n % 4 ? "2025-12-20" : null,
  cardDate: null,
  visaAvailable: true,
  status: null,
  asOf: null,
  maybeRepeats: n % 50 === 0 ? 1 : 0,
});

const MANY = Array.from({ length: 1568 }, (_, i) => reported(i + 1));
const caseRows = (root: ParentNode) => [...root.querySelectorAll('[data-table="every-case"] tbody tr')];

describe("the cases people reported at an office", () => {
  it("draws one page of the every-case table on the server, however many cases there are", () => {
    const html = renderToString(<OfficeReportedCases cases={MANY} builtAt={null} officeName="the National Benefits Center" />);
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(caseRows(box)).toHaveLength(25);
    expect(box.textContent).toContain("1 to 25 of 1,568 cases");
    // 1,568 rows were 1.23 MB of this HTML before; one page of them is a few kilobytes.
    expect(html.length).toBeLessThan(120_000);
  });

  it("keeps every case a press away, in the order the list had", () => {
    render(<OfficeReportedCases cases={MANY} builtAt={null} officeName="the National Benefits Center" />);
    const nav = screen.getByRole("navigation", { name: "Pages of cases" });
    fireEvent.click(nav.querySelector('button[aria-label="Next page"]')!);
    expect(document.body.textContent).toContain("26 to 50 of 1,568 cases");
    const first = caseRows(document)[0]!;
    expect([...first.querySelectorAll("td")].map((c) => c.textContent?.trim())).toEqual(caseCells(MANY[25]!));
  });

  it("hands the browser each case as a short row of text, not a drawn row", () => {
    const cells = MANY.map(caseCells);
    expect(cells[0]).toEqual(["EB-2", "India", "Mar 4, 2023", "Apr 1, 2024", "May 2, 2024", "Feb 15, 2025", "Dec 20, 2025", "Not yet", "VisaStats"]);
    expect(caseCells(MANY[149]!)[8]).toBe("Reddit, Telegram (may repeat another case)");
    // Every case of the biggest office in a few hundred kilobytes, so the page stays far under Googlebot's 2 MB.
    expect(JSON.stringify(cells).length).toBeLessThan(250_000);
  });

  it("names a missing date and an undecided case in words", () => {
    const c = { ...reported(4), priorityDate: null, priorityNote: "Current", category: null, chargeability: null, biometricsDate: null };
    expect(caseCells(c).slice(0, 5)).toEqual(["Not given", "Not given", "Current", "Apr 1, 2024", "Not given"]);
    expect(caseCells(c)[6]).toBe("Not yet");
  });
});
