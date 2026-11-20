/**
 * The recruitment audit file: one indexed PDF of a case's wage determination, Notice of Filing, the proof of each
 * recruitment step, the applicant log and the draft recruitment report, in that order, made in the browser so the
 * files never leave the user's computer. It's the file a PERM audit or a request for information asks for, and what
 * the five-year records duty keeps (20 CFR 656.10(f)).
 *
 * A PDF is joined page for page and a PNG or JPEG photo gets a page of its own. Any other file (a Word document, a
 * file that couldn't be fetched) is listed in the index as not joined, with its name, so nothing is dropped quietly.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { outcomeLabel, type ApplicantEntry, type RecruitmentReport } from "@convex/lib/perm/recruitment/applicantReport";
import { recruitmentStep, stepInSentence, type RecruitmentStep } from "@convex/lib/perm/recruitment/steps";

export interface AuditDocument {
  name: string;
  url: string;
  mimeType: string;
  category?: string | null;
  step?: string | null;
}

export interface AuditInput {
  title: string;
  /** The case's employer and job, for the cover. */
  employer: string | null;
  position: string | null;
  caseNumber: string | null;
  documents: readonly AuditDocument[];
  applicants: readonly ApplicantEntry[];
  report: RecruitmentReport;
  /** The day the file is made, for the cover ("November 20, 2026"). */
  madeOn: string;
  fetchFile?: (url: string) => Promise<ArrayBuffer>;
}

interface Section {
  title: string;
  firstPage: number | null;
  note?: string;
}

const LETTER: [number, number] = [612, 792];
const MARGIN = 54;
const INK = rgb(0.07, 0.07, 0.07);
const SOFT = rgb(0.35, 0.35, 0.35);

/** Helvetica writes Windows-1252 only: any other character becomes a plain one, never a broken page. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

/** Lines of `text` that fit `width` at `size`, words kept whole. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** A writer that flows text down letter pages, opening a new page when one fills. */
class Writer {
  page: PDFPage;
  y: number;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = doc.addPage(LETTER);
    this.y = LETTER[1] - MARGIN;
  }
  private room(h: number) {
    if (this.y - h < MARGIN) {
      this.page = this.doc.addPage(LETTER);
      this.y = LETTER[1] - MARGIN;
    }
  }
  text(t: string, opts: { size?: number; bold?: boolean; soft?: boolean; gap?: number } = {}) {
    const size = opts.size ?? 11;
    const f = opts.bold ? this.bold : this.font;
    for (const line of wrap(t, f, size, LETTER[0] - MARGIN * 2)) {
      this.room(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font: f, color: opts.soft ? SOFT : INK });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 6;
  }
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}

/** The documents of each section, in the file's order. */
export function auditSections(documents: readonly AuditDocument[], steps: readonly RecruitmentStep[]) {
  const wage = documents.filter((d) => d.category === "pwd" && !d.step);
  const notice = documents.filter((d) => d.step === "notice_of_filing");
  const proof = steps
    .filter((s) => s.key !== "notice_of_filing")
    .map((s) => ({ step: s, docs: documents.filter((d) => d.step === s.key) }));
  return { wage, notice, proof };
}

export async function buildAuditFile(input: AuditInput): Promise<Uint8Array> {
  const fetchFile = input.fetchFile ?? defaultFetch;
  const out = await PDFDocument.create();
  out.setTitle(pdfSafe(input.title));
  out.setLanguage("en-US");
  out.setCreator("PERM Tracker");
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  // The cover and index, filled in once every section's first page is known.
  const cover = out.addPage(LETTER);
  const sections: Section[] = [];
  const notJoined: string[] = [];

  const addFiles = async (title: string, docs: readonly AuditDocument[]) => {
    const section: Section = { title, firstPage: null };
    sections.push(section);
    if (!docs.length) {
      section.note = "nothing attached";
      return;
    }
    for (const d of docs) {
      const first = out.getPageCount() + 1;
      try {
        const bytes = await fetchFile(d.url);
        if (d.mimeType === "application/pdf") {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
        } else if (d.mimeType === "image/png" || d.mimeType === "image/jpeg") {
          const img = d.mimeType === "image/png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
          const page = out.addPage(LETTER);
          const scale = Math.min((LETTER[0] - MARGIN * 2) / img.width, (LETTER[1] - MARGIN * 2 - 24) / img.height, 1);
          page.drawText(pdfSafe(d.name), { x: MARGIN, y: LETTER[1] - MARGIN - 11, size: 11, font: bold, color: INK });
          page.drawImage(img, { x: MARGIN, y: LETTER[1] - MARGIN - 24 - img.height * scale, width: img.width * scale, height: img.height * scale });
        } else {
          notJoined.push(`${d.name} (${title}): this kind of file can't be joined into a PDF; it stays in the case's documents.`);
          continue;
        }
        if (section.firstPage === null) section.firstPage = first;
      } catch {
        notJoined.push(`${d.name} (${title}): couldn't be read just now; it stays in the case's documents.`);
      }
    }
  };

  const { wage, notice, proof } = auditSections(input.documents, input.report.steps);
  await addFiles("The wage determination", wage);
  await addFiles("Notice of Filing (20 CFR 656.10(d))", notice);
  for (const { step, docs } of proof) {
    await addFiles(`${step.label} (${step.cite})`, step.datesAreProof && !docs.length ? [] : docs);
    if (step.datesAreProof && !docs.length) sections[sections.length - 1]!.note = "its dates on the application are its proof";
  }

  // The applicant log.
  const logStart = out.getPageCount() + 1;
  const log = new Writer(out, font, bold);
  log.text("Applicant log", { size: 16, bold: true, gap: 10 });
  if (!input.applicants.length) log.text("No applicants are in the log.", { soft: true });
  for (const a of input.applicants) {
    const step = a.source ? recruitmentStep(a.source) : undefined;
    const source = step ? stepInSentence(step) : null;
    log.text(a.ref, { bold: true, gap: 2 });
    log.text(
      [
        a.appliedOn ? `Applied ${a.appliedOn}` : null,
        source ? `answering the ${source}` : null,
        a.contactedOn ? `contacted ${a.contactedOn}${a.contactMethod ? ` by ${a.contactMethod.replace("_", " ")}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(", ") || "No dates entered.",
      { soft: true, gap: 2 },
    );
    log.text(`${outcomeLabel(a.outcome)}${a.reason ? `: ${a.reason}` : ""}`, { gap: 10 });
  }
  sections.push({ title: "Applicant log", firstPage: logStart });

  // The draft recruitment report.
  const reportStart = out.getPageCount() + 1;
  const r = input.report;
  const w = new Writer(out, font, bold);
  w.text("Recruitment report (draft)", { size: 16, bold: true, gap: 4 });
  w.text("For the employer or its representative to review and sign (20 CFR 656.17(g)(1)).", { soft: true, gap: 12 });
  w.text("Recruitment steps taken", { bold: true, gap: 4 });
  for (const s of r.steps) w.text(`${s.label} (${s.cite})`, { gap: 2 });
  w.y -= 8;
  w.text("Results", { bold: true, gap: 4 });
  w.text(
    `${r.total} U.S. applicant${r.total === 1 ? "" : "s"} responded. ${r.hired} ${r.hired === 1 ? "was" : "were"} hired, ${r.notHired} ${
      r.notHired === 1 ? "was" : "were"
    } not hired, and ${r.pending} ${r.pending === 1 ? "is" : "are"} still being considered.`,
    { gap: 10 },
  );
  for (const g of r.groups) {
    w.text(`${g.label}: ${g.entries.length}`, { bold: true, gap: 2 });
    for (const e of g.entries) w.text(`${e.ref}${e.reason ? `: ${e.reason}` : ": no reason written yet"}`, { gap: 2 });
    w.y -= 6;
  }
  if (r.withoutReason.length) {
    w.text(`Not final: ${r.withoutReason.length} applicant${r.withoutReason.length === 1 ? " has" : "s have"} no reason written yet.`, { bold: true });
  }
  sections.push({ title: "Recruitment report (draft)", firstPage: reportStart });

  // The cover and index.
  let y = LETTER[1] - MARGIN;
  const line = (t: string, size = 11, f = font, color = INK) => {
    for (const l of wrap(t, f, size, LETTER[0] - MARGIN * 2)) {
      cover.drawText(l, { x: MARGIN, y: y - size, size, font: f, color });
      y -= size + 5;
    }
  };
  line(input.title, 18, bold);
  y -= 6;
  line([input.employer, input.position].filter(Boolean).join(", ") || "Case", 12);
  if (input.caseNumber) line(`Case ${input.caseNumber}`, 11, font, SOFT);
  line(`Made ${input.madeOn} with PERM Tracker. Not legal advice.`, 10, font, SOFT);
  y -= 14;
  line("Contents", 13, bold);
  for (const s of sections) line(`${s.title}${s.firstPage ? `, page ${s.firstPage}` : s.note ? `: ${s.note}` : ""}`);
  if (notJoined.length) {
    y -= 10;
    line("Not joined", 13, bold);
    for (const n of notJoined) line(n, 10, font, SOFT);
  }
  return out.save();
}
