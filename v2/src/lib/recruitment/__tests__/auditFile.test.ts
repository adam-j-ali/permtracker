import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { recruitmentReport } from "@convex/lib/perm/recruitment/applicantReport";
import { auditSections, buildAuditFile, pdfSafe } from "../auditFile";

// A 1x1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) =>
  c.charCodeAt(0),
);

async function twoPagePdf(): Promise<ArrayBuffer> {
  const d = await PDFDocument.create();
  d.addPage();
  d.addPage();
  const bytes = await d.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("the recruitment audit file", () => {
  it("joins the PDFs and photos in the rule's order, lists what it couldn't join, and opens as a PDF", async () => {
    const caseFields = { jobOrderStartDate: "2026-01-05", sundayAdFirstDate: "2026-01-11", noticeOfFilingStartDate: "2026-01-06" };
    const applicants = [
      { ref: "Applicant 1", outcome: "not_qualified" as const, reason: "No bachelor's degree, which the job requires.", appliedOn: "2026-01-12" },
      { ref: "Applicant 2", outcome: "hired" as const },
    ];
    const pdf = await twoPagePdf();
    const files: Record<string, ArrayBuffer | Error> = {
      "u://pwd": pdf,
      "u://ad1": PNG.buffer as ArrayBuffer,
      "u://nof": pdf,
      "u://broken": new Error("HTTP 404"),
    };
    const bytes = await buildAuditFile({
      title: "Recruitment audit file",
      employer: "ACME Robotics",
      position: "Engineer",
      caseNumber: null,
      madeOn: "November 20, 2026",
      applicants,
      report: recruitmentReport(caseFields, applicants),
      documents: [
        { name: "PWD.pdf", url: "u://pwd", mimeType: "application/pdf", category: "pwd" },
        { name: "Ad 1 tear sheet.png", url: "u://ad1", mimeType: "image/png", category: "recruitment", step: "sunday_ad_1" },
        { name: "Notice.pdf", url: "u://nof", mimeType: "application/pdf", category: "recruitment", step: "notice_of_filing" },
        { name: "Notes.docx", url: "u://pwd", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", step: "sunday_ad_1" },
        { name: "Gone.pdf", url: "u://broken", mimeType: "application/pdf", step: "sunday_ad_1" },
      ],
      fetchFile: async (url) => {
        const f = files[url];
        if (!f || f instanceof Error) throw f ?? new Error("missing");
        return f;
      },
    });
    const back = await PDFDocument.load(bytes);
    // Cover 1, the wage determination 2-3, the Notice of Filing 4-5, the ad photo 6, the log 7, the report 8.
    expect(back.getPageCount()).toBe(8);
    expect(back.getTitle()).toBe("Recruitment audit file");
  });

  it("orders the sections: the wage determination, the Notice of Filing, then each step's proof", () => {
    const report = recruitmentReport({ jobOrderStartDate: "2026-01-05", sundayAdFirstDate: "2026-01-11", noticeOfFilingStartDate: "2026-01-06" }, []);
    const s = auditSections(
      [
        { name: "a", url: "", mimeType: "application/pdf", category: "pwd" },
        { name: "b", url: "", mimeType: "application/pdf", step: "sunday_ad_1" },
        { name: "c", url: "", mimeType: "application/pdf", step: "notice_of_filing" },
      ],
      report.steps,
    );
    expect(s.wage.map((d) => d.name)).toEqual(["a"]);
    expect(s.notice.map((d) => d.name)).toEqual(["c"]);
    expect(s.proof.map((p) => [p.step.key, p.docs.map((d) => d.name)])).toEqual([
      ["job_order", []],
      ["sunday_ad_1", ["b"]],
    ]);
  });

  it("writes only characters its font can draw", () => {
    expect(pdfSafe("Doesn’t meet “the” requirement – 2 yrs…")).toBe(`Doesn't meet "the" requirement - 2 yrs...`);
    expect(pdfSafe("José 日本")).toBe("José ??");
  });
});
