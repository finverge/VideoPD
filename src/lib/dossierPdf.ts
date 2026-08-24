import PDFDocument from "pdfkit";

/**
 * Renders the VideoPD Actionable Dossier (BRD BR-44) as a downloadable PDF.
 *
 * This is the "downloadable rendering" half of BR-44, not the full ask —
 * it is NOT digitally signed or watermarked, and its authenticity can't be
 * cryptographically verified. That needs real signing infrastructure
 * (certificate or HSM-backed signing service), which is out of scope for a
 * local prototype — see docs/videopd-future-work.md item 10. Said plainly
 * on the document itself so nobody mistakes this for the tamper-proof
 * artifact BR-44 ultimately calls for.
 */

export interface DossierFlagData { type: string; label: string; detail: string }
export interface DossierAnswerData { questionText: string; answerText: string; answerTextEn?: string | null; translationAvailable?: boolean; score: number }
export interface DossierBankStatementData {
  status: string; eligibilityFlag: string | null; reasons: string[];
  metrics: { avgBalance: number; minBalance: number; bounceCount: number; estimatedMonthlyIncome: number; emiOutflow: number; transactionCount: number } | null;
}
export interface DossierPdfInput {
  applicantName: string;
  mobile: string;
  segment: string;
  refNumber: string;
  requestedAmount: number | null;
  tenureMonths: number | null;
  loanPurpose: string | null;
  skillIntentScore: number;
  generatedAt: string;
  livenessCaptured: boolean;
  businessVerificationCaptured: boolean;
  flags: DossierFlagData[];
  bankStatement: DossierBankStatementData | null;
  answers: DossierAnswerData[];
}

const formatINR = (n: number | null) => (n == null ? "—" : `Rs. ${n.toLocaleString("en-IN")}`);

// pdfkit's default fonts (Helvetica etc.) are the PDF base-14 set — WinAnsi
// encoding only, no Devanagari/Telugu/Tamil/Kannada/Malayalam glyphs and no
// ₹ glyph either. Embedding real Indic-script fonts is future work (see
// docs/videopd-future-work.md) — until then, text outside that coverage
// must never be handed to pdfkit as-is: it silently renders as mojibake
// rather than erroring, which is worse than an honest placeholder.
const RENDERABLE_PATTERN = /^[\x00-\xFF‘’“”–—…]*$/;
function isPdfRenderable(text: string): boolean {
  return RENDERABLE_PATTERN.test(text);
}
function sanitizeForPdf(text: string): string {
  return text.replace(/₹/g, "Rs. ");
}
const FULL_PLACEHOLDER = "(Original answer is in a script this PDF export can't render yet — see English translation below.)";
const SHORT_PLACEHOLDER = "(non-Latin script)";

// `short` matters: the full explanatory placeholder is ~90 characters, fine
// in the Q&A transcript section (dynamic Y via heightOfString, full page
// width) but not in the fixed-position two-column header — confirmed live,
// a non-Latin applicant name wrapped the full placeholder onto a second
// line and visually collided with "Mobile:"/"Segment:" beside and below it,
// since the header's y-offsets (110, 126, 142...) assume each row is one
// line tall and don't reflow for a taller-than-expected Applicant row.
function renderableOrPlaceholder(text: string, short = false): string {
  const clean = sanitizeForPdf(text);
  if (isPdfRenderable(clean)) return clean;
  return short ? SHORT_PLACEHOLDER : FULL_PLACEHOLDER;
}

export function generateDossierPdf(data: DossierPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#0f1730").text("Lakshya Skill Finance", 50, 50);
    doc.fontSize(12).font("Helvetica").fillColor("#4a629d").text("VideoPD Actionable Dossier", 50, 72);
    doc.moveTo(50, 95).lineTo(545, 95).strokeColor("#e7ebf6").stroke();

    doc.moveDown(2);
    doc.fontSize(10).fillColor("#4a629d").font("Helvetica");
    doc.text(`Applicant: `, 50, 110, { continued: true }).fillColor("#0f1730").font("Helvetica-Bold").text(renderableOrPlaceholder(data.applicantName, true));
    doc.fillColor("#4a629d").font("Helvetica").text(`Mobile: `, 50, 126, { continued: true }).fillColor("#0f1730").text(data.mobile);
    doc.fillColor("#4a629d").text(`Segment: `, 300, 110, { continued: true }).fillColor("#0f1730").text(data.segment.replace("_", " "));
    doc.fillColor("#4a629d").text(`Reference: `, 300, 126, { continued: true }).fillColor("#0f1730").text(data.refNumber);
    doc.fillColor("#4a629d").text(`Loan amount: `, 50, 142, { continued: true }).fillColor("#0f1730").text(formatINR(data.requestedAmount));
    doc.fillColor("#4a629d").text(`Tenure: `, 300, 142, { continued: true }).fillColor("#0f1730").text(data.tenureMonths ? `${data.tenureMonths} months` : "—");
    doc.fillColor("#4a629d").text(`Generated: `, 50, 158, { continued: true }).fillColor("#0f1730").text(new Date(data.generatedAt).toLocaleString());
    if (data.loanPurpose) {
      doc.fillColor("#4a629d").text(`Purpose: `, 50, 174, { continued: true }).fillColor("#0f1730").text(renderableOrPlaceholder(data.loanPurpose, true), { width: 445 });
    }

    let y = data.loanPurpose ? 200 : 190;

    // Skill & Intent Score
    sectionTitle(doc, "Skill & Intent Score", y); y += 20;
    doc.fontSize(22).font("Helvetica-Bold").fillColor("#1cb27d").text(`${data.skillIntentScore} / 100`, 50, y);
    doc.fontSize(9).font("Helvetica").fillColor("#9caed3").text("Rule-based (BR-43) — configurable per lending partner, pending Lakshya's credit questionnaire.", 50, y + 26);
    y += 50;

    // Capture completeness
    sectionTitle(doc, "Verification Captures", y); y += 20;
    doc.fontSize(10).font("Helvetica").fillColor(data.livenessCaptured ? "#128f66" : "#b1530c")
      .text(`${data.livenessCaptured ? "PASS" : "MISSING"} — Liveness capture`, 50, y);
    y += 15;
    doc.fillColor(data.businessVerificationCaptured ? "#128f66" : "#b1530c")
      .text(`${data.businessVerificationCaptured ? "PASS" : "MISSING"} — Business/asset verification capture`, 50, y);
    y += 25;

    // Flags
    if (data.flags.length > 0) {
      sectionTitle(doc, "Flags (advisory — review before deciding)", y); y += 20;
      for (const f of data.flags) {
        y = ensureSpace(doc, y, 30);
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#b1530c").text(`${f.label} (${f.type})`, 50, y);
        y += 13;
        const detail = sanitizeForPdf(f.detail);
        doc.fontSize(9).font("Helvetica").fillColor("#4a629d").text(detail, 50, y, { width: 495 });
        y += doc.heightOfString(detail, { width: 495 }) + 10;
      }
    }

    // Bank statement
    if (data.bankStatement) {
      y = ensureSpace(doc, y, 40);
      sectionTitle(doc, "Bank Statement Eligibility (advisory only — never an auto-decision)", y); y += 20;
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f1730").text(data.bankStatement.eligibilityFlag?.replace("_", " ") ?? "—", 50, y);
      y += 16;
      for (const r of data.bankStatement.reasons) {
        doc.fontSize(9).font("Helvetica").fillColor("#4a629d").text(`- ${r}`, 50, y, { width: 495 });
        y += doc.heightOfString(`- ${r}`, { width: 495 }) + 4;
      }
      if (data.bankStatement.metrics) {
        y += 6;
        const m = data.bankStatement.metrics;
        const rows: [string, string][] = [
          ["Average balance", formatINR(m.avgBalance)], ["Minimum balance", formatINR(m.minBalance)],
          ["Bounced transactions", String(m.bounceCount)], ["Est. monthly income", formatINR(m.estimatedMonthlyIncome)],
          ["EMI outflow", formatINR(m.emiOutflow)], ["Transactions parsed", String(m.transactionCount)],
        ];
        for (let i = 0; i < rows.length; i += 2) {
          doc.fontSize(9).font("Helvetica").fillColor("#4a629d").text(`${rows[i][0]}: `, 50, y, { continued: true }).fillColor("#0f1730").text(rows[i][1]);
          if (rows[i + 1]) doc.fillColor("#4a629d").text(`${rows[i + 1][0]}: `, 300, y, { continued: true }).fillColor("#0f1730").text(rows[i + 1][1]);
          y += 14;
        }
      }
      y += 15;
    }

    // Q&A transcript
    if (data.answers.length > 0) {
      y = ensureSpace(doc, y, 40);
      sectionTitle(doc, "Skill & Intent Q&A Transcript", y); y += 20;
      for (const a of data.answers) {
        y = ensureSpace(doc, y, 50);
        // Question/answer text is stored in the borrower's own language (see
        // questionPrompt() in lib/videoPdQuestions.ts) — may not be Latin
        // script, which pdfkit's default fonts can't render (see the
        // isPdfRenderable comment above).
        const question = renderableOrPlaceholder(a.questionText);
        const answer = renderableOrPlaceholder(a.answerText);
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f1730").text(question, 50, y, { width: 495 });
        y += doc.heightOfString(question, { width: 495 }) + 4;
        doc.fontSize(9).font("Helvetica").fillColor("#4a629d").text(answer, 50, y, { width: 495 });
        y += doc.heightOfString(answer, { width: 495 }) + 4;
        if (a.answerTextEn) {
          const en = `EN: ${sanitizeForPdf(a.answerTextEn)}`;
          doc.fontSize(8).font("Helvetica-Oblique").fillColor("#9caed3").text(en, 50, y, { width: 495 });
          y += doc.heightOfString(en, { width: 495 }) + 4;
        } else if (a.translationAvailable === false) {
          doc.fontSize(8).font("Helvetica-Oblique").fillColor("#d6740a").text("English translation unavailable.", 50, y);
          y += 12;
        }
        y += 10;
      }
    }

    // Footer disclaimer on every page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font("Helvetica").fillColor("#9caed3").text(
        "Prototype-generated summary — NOT a digitally signed or tamper-proof document. Advisory only; does not constitute an approval decision.",
        50, 780, { width: 495, align: "center" }
      );
    }

    doc.end();
  });
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#0f1730").text(title.toUpperCase(), 50, y);
  doc.moveTo(50, y + 15).lineTo(545, y + 15).strokeColor("#e7ebf6").stroke();
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > 760) {
    doc.addPage();
    return 50;
  }
  return y;
}
