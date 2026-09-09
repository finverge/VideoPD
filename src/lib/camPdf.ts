import PDFDocument from "pdfkit";
import { isPdfRenderable, sanitizeForPdf, renderableOrPlaceholder } from "./dossierPdf";

/**
 * Credit Appraisal Memo (CAM) — matched to DLP/LOS's own real, BRD-specified
 * CAM (services/underwriting-decisioning, Appendix E.3 of BRD v1.23), not an
 * independently-invented shape. Confirmed by reading that service's actual
 * schemas.py/models.py/routers, not assumed.
 *
 * Two things carried over deliberately, matching that design exactly:
 *   1. Immutable snapshot — this module only ever RENDERS a CamSnapshot
 *      object assembled once, at generation time, by
 *      src/lib/camSnapshot.ts and persisted (CreditAppraisalMemo model).
 *      It never re-reads live case data itself. A document used to justify
 *      and audit a sanction decision must reflect what was actually known
 *      at that moment, not silently drift if a check is re-run afterward.
 *   2. The same section shape (financials split by product-family-style
 *      distinction, obligations/bureau block, eligibility assumptions,
 *      document checklist) — adapted field-by-field to what VideoPD
 *      actually has, with real gaps stated honestly rather than silently
 *      dropped or faked. VideoPD has no credit bureau, GST, ITR, or core-
 *      banking (ETB) integration — those fields render as an explicit
 *      "not available" line, the same way this app states every other
 *      real limitation, not a blank space that looks like an oversight.
 *
 * Same disclosure as dossierPdf.ts: NOT digitally signed or tamper-proof —
 * stated on the document itself, not just here.
 */

export interface CamSnapshotFlag { label: string; severity: string; detail: string }
export interface CamSnapshotDocument { documentType: string; status: string }
export interface CamSnapshotFinancials {
  selfDeclaredMonthlyIncome: number | null;
  bankStatementEstimatedMonthlyIncome: number | null;
  incomeVariancePct: number | null; // |self-declared − bank-statement-estimated| / self-declared × 100 — VideoPD's real analog to DLP's turnover_variance_pct
  averageMonthlyBalance: number | null;
  emiOutflow: number | null;
}
export interface CamSnapshotObligations {
  bureauScore: null; // no credit bureau integration in this build — always null, rendered as an explicit "not available" line, not hidden
  bureauScoreBand: null;
  dtiRatio: number | null; // EMI outflow ÷ estimated monthly income — real, computed from this app's own bank-statement parse, not a bureau figure
}
export interface CamSnapshotEligibility {
  recommendedDecision: string | null; // the underwriter's actual recorded recommendation, or null if not yet made — never an unreviewed AI draft presented as if it were the recommendation
  underwriterName: string | null;
  approverDecision: string | null;
  approverName: string | null;
  assumptions: string[]; // what the recommendation/decision was actually based on — see camSnapshot.ts for exactly which signals feed this
}
export interface CamSnapshotDecisionRound { actorRole: string; actorName: string; action: string; notes: string | null; decidedAt: string }

export interface CamSnapshot {
  applicationRef: string; // this app's own 8-char case reference — see camSnapshot.ts's own comment on why this isn't styled as a formatted "application number" the way DLP's is
  productFamily: string; // segment, in DLP's naming convention for this section
  applicantName: string;
  applicantPan: string | null; // populated only when idType === "pan"; null (with an honest note) otherwise — VideoPD collects one ID type, not always PAN
  etbStatus: null; // no core-banking system integration — always null, explicit "not available" line
  mobile: string;
  requestedAmount: number | null;
  tenureMonths: number | null;
  loanPurpose: string | null;
  productType: string | null;
  documents: CamSnapshotDocument[];
  financials: CamSnapshotFinancials;
  obligations: CamSnapshotObligations;
  eligibility: CamSnapshotEligibility;
  riskFlags: CamSnapshotFlag[];
  riskSeverity: string;
  decisionTrail: CamSnapshotDecisionRound[];
  skillIntentScore: number | null;
}

export interface CamPdfInput {
  tenantName: string;
  generatedBy: string;
  generatedAt: string;
  snapshot: CamSnapshot;
}

const INK = "#0f1730";
const MUTED = "#4a629d";
const FAINT = "#9caed3";
const LINE = "#e7ebf6";
const GOOD = "#128f66";
const WARN = "#b1530c";
const BAD = "#c23b3b";

const formatINR = (n: number | null) => (n == null ? "—" : `Rs. ${n.toLocaleString("en-IN")}`);
const NOT_AVAILABLE = "Not available — no integration in this build";

const NOTES_MAX_CHARS = 380;
function truncateNotes(text: string): string {
  const clean = sanitizeForPdf(text).replace(/\s*\n\s*/g, " — ");
  if (clean.length <= NOTES_MAX_CHARS) return clean;
  return clean.slice(0, NOTES_MAX_CHARS).trimEnd() + "… (full notes in system)";
}

export function generateCamPdf(data: CamPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // bufferPages: true is required for the footer loop below to reach
    // every page — without it, pdfkit flushes each page to the output
    // stream as soon as the next one starts, so by the time .end() runs
    // only the LAST page is still switchable. Confirmed live: a case with
    // enough content to spill onto a second page threw "switchToPage(0)
    // out of bounds" — single-page test cases never exposed this, since
    // page 0 and "the only remaining buffered page" were the same page.
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PAGE_W = 515;
    const s = data.snapshot;

    // Header
    doc.fontSize(15).font("Helvetica-Bold").fillColor(INK).text(data.tenantName, 40, 40);
    doc.fontSize(9).font("Helvetica").fillColor(MUTED).text("Credit Appraisal Memo", 40, 58);
    doc.fontSize(8).font("Helvetica").fillColor(FAINT).text(
      `Generated by ${data.generatedBy} · ${new Date(data.generatedAt).toLocaleString()}`, 40, 40, { width: PAGE_W, align: "right" }
    );
    // Immutability notice — the single most important framing difference
    // from a live-generated report, stated up top, not buried in the
    // footer: this is what was known AT THIS MOMENT, and stays that way
    // even if the case changes afterward.
    doc.fontSize(7).font("Helvetica-Oblique").fillColor(FAINT).text(
      "Immutable snapshot — reflects case state at the moment of generation, not live data.", 40, 52, { width: PAGE_W, align: "right" }
    );
    doc.moveTo(40, 76).lineTo(555, 76).strokeColor(LINE).stroke();

    let y = 88;
    const row = (label: string, value: string, x: number) => {
      doc.fontSize(8.5).font("Helvetica").fillColor(MUTED).text(label, x, y, { continued: true }).fillColor(INK).font("Helvetica-Bold").text(value);
    };
    row("Applicant: ", renderableOrPlaceholder(s.applicantName, true), 40);
    row("Reference: ", s.applicationRef, 300);
    y += 14;
    row("Mobile: ", s.mobile, 40);
    row("Product family: ", s.productFamily.replace(/_/g, " "), 300);
    y += 14;
    row("PAN: ", s.applicantPan ?? "— (ID on file is not a PAN)", 40);
    row("ETB status: ", NOT_AVAILABLE, 300);
    y += 14;
    row("Loan amount: ", formatINR(s.requestedAmount), 40);
    row("Tenure: ", s.tenureMonths ? `${s.tenureMonths} months` : "—", 300);
    y += 14;
    if (s.loanPurpose) {
      doc.fontSize(8.5).font("Helvetica").fillColor(MUTED).text("Purpose: ", 40, y, { continued: true }).fillColor(INK).font("Helvetica").text(renderableOrPlaceholder(s.loanPurpose, true), { width: 470 });
      y += 14;
    }
    y += 8;

    // Financials — self-declared vs. verified, with variance, same shape
    // as DLP's CamFinancialsOut (self_declared_annual_turnover vs.
    // verified_annual_turnover + turnover_variance_pct), applied to
    // VideoPD's actual data: bank-statement-parsed income, not GST.
    y = sectionTitle(doc, "Financials", y, PAGE_W);
    const f = s.financials;
    checkLine(doc, y, MUTED, "Self-declared monthly income", formatINR(f.selfDeclaredMonthlyIncome)); y += 13;
    checkLine(doc, y, MUTED, "Bank-statement-estimated monthly income", formatINR(f.bankStatementEstimatedMonthlyIncome)); y += 13;
    if (f.incomeVariancePct != null) {
      checkLine(doc, y, f.incomeVariancePct > 20 ? WARN : GOOD, "Income variance (declared vs. bank statement)", `${f.incomeVariancePct.toFixed(1)}%`); y += 13;
    }
    checkLine(doc, y, MUTED, "Average bank balance", formatINR(f.averageMonthlyBalance)); y += 13;
    checkLine(doc, y, MUTED, "EMI outflow (existing obligations, from statement)", formatINR(f.emiOutflow)); y += 13;
    y += 6;

    // Obligations / bureau — the honest-gap section. bureauScore/Band are
    // always null (stated as such below); dtiRatio is real, computed from
    // this app's own bank-statement parse.
    y = sectionTitle(doc, "Obligations & Bureau", y, PAGE_W);
    checkLine(doc, y, FAINT, "Credit bureau score / band", NOT_AVAILABLE); y += 13;
    checkLine(doc, y, s.obligations.dtiRatio != null && s.obligations.dtiRatio > 0.5 ? WARN : MUTED, "DTI ratio (EMI ÷ estimated income)",
      s.obligations.dtiRatio != null ? `${(s.obligations.dtiRatio * 100).toFixed(1)}%` : "—"); y += 13;
    y += 6;

    // Eligibility — the underwriter's ACTUAL recorded recommendation
    // (never an unreviewed AI draft standing in for it), the approver's
    // decision, and the real signals behind them.
    y = ensureSpace(doc, y, 60);
    y = sectionTitle(doc, "Eligibility", y, PAGE_W);
    checkLine(doc, y, s.eligibility.recommendedDecision === "APPROVE" ? GOOD : s.eligibility.recommendedDecision ? BAD : FAINT,
      "Underwriter recommendation", s.eligibility.recommendedDecision
        ? `${s.eligibility.recommendedDecision}${s.eligibility.underwriterName ? ` — ${s.eligibility.underwriterName}` : ""}`
        : "Not yet made"); y += 13;
    checkLine(doc, y, s.eligibility.approverDecision === "APPROVED" ? GOOD : s.eligibility.approverDecision ? (s.eligibility.approverDecision === "SENT_BACK" ? WARN : BAD) : FAINT,
      "Approver decision", s.eligibility.approverDecision
        ? `${s.eligibility.approverDecision.replace(/_/g, " ")}${s.eligibility.approverName ? ` — ${s.eligibility.approverName}` : ""}`
        : "Not yet made"); y += 15;
    if (s.eligibility.assumptions.length > 0) {
      doc.fontSize(8).font("Helvetica-Bold").fillColor(MUTED).text("Basis for the above:", 40, y); y += 12;
      for (const a of s.eligibility.assumptions) {
        y = ensureSpace(doc, y, 12);
        doc.fontSize(8.5).font("Helvetica").fillColor(INK).text(`- ${renderableOrPlaceholder(a, true)}`, 44, y, { width: PAGE_W - 4 });
        y += 12;
      }
    }
    if (s.skillIntentScore != null) {
      y += 2;
      checkLine(doc, y, MUTED, "Skill & Intent score", `${s.skillIntentScore} / 100`); y += 13;
    }
    y += 6;

    // Risk flags
    y = ensureSpace(doc, y, 40);
    y = sectionTitle(doc, `Risk Flags — overall: ${s.riskSeverity.toUpperCase()}`, y, PAGE_W);
    if (s.riskFlags.length === 0) {
      doc.fontSize(9).font("Helvetica-Oblique").fillColor(FAINT).text("None raised.", 40, y); y += 14;
    } else {
      const MAX_FLAGS = 6;
      for (const flag of s.riskFlags.slice(0, MAX_FLAGS)) {
        const sevColor = flag.severity === "high" ? BAD : flag.severity === "medium" ? WARN : MUTED;
        doc.fontSize(9).font("Helvetica-Bold").fillColor(sevColor).text(`[${flag.severity.toUpperCase()}] `, 40, y, { continued: true })
          .font("Helvetica").fillColor(INK).text(renderableOrPlaceholder(flag.label, true));
        y += 12;
      }
      if (s.riskFlags.length > MAX_FLAGS) {
        doc.fontSize(8).font("Helvetica-Oblique").fillColor(FAINT).text(`+${s.riskFlags.length - MAX_FLAGS} more flag(s) — see full case record.`, 40, y);
        y += 12;
      }
    }
    y += 6;

    // Document checklist — same {type, status} shape as DLP's CamDocumentEntry
    y = ensureSpace(doc, y, 40);
    y = sectionTitle(doc, "Document Checklist", y, PAGE_W);
    if (s.documents.length === 0) {
      doc.fontSize(9).font("Helvetica-Oblique").fillColor(FAINT).text("No documents on file.", 40, y); y += 14;
    } else {
      for (const d of s.documents) {
        y = ensureSpace(doc, y, 13);
        const color = d.status === "PASSED" ? GOOD : d.status === "FLAGGED" ? WARN : FAINT;
        doc.fontSize(8.5).font("Helvetica").fillColor(INK).text(d.documentType.replace(/_/g, " "), 40, y, { continued: true, width: 300 })
          .fillColor(color).font("Helvetica-Bold").text(`  ${d.status}`);
        y += 13;
      }
    }

    // Decision trail — only when more than one round (a send-back cycle)
    if (s.decisionTrail.length > 1) {
      y += 6;
      y = ensureSpace(doc, y, 50);
      y = sectionTitle(doc, "Decision Trail (all rounds)", y, PAGE_W);
      for (const d of s.decisionTrail) {
        y = ensureSpace(doc, y, 14);
        doc.fontSize(8).font("Helvetica").fillColor(MUTED)
          .text(`${new Date(d.decidedAt).toLocaleDateString()} — ${d.actorName} (${d.actorRole === "UNDERWRITER" ? "Underwriter" : "Approver"}) — `, 40, y, { continued: true })
          .font("Helvetica-Bold").fillColor(INK).text(d.action.replace(/_/g, " "));
        y += 12;
      }
    }

    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font("Helvetica").fillColor(FAINT).text(
        "Prototype-generated document — NOT digitally signed or tamper-proof. Advisory only; does not itself constitute or replace the recorded system decision.",
        40, 770, { width: PAGE_W, align: "center" }
      );
    }

    doc.end();
  });
}

function checkLine(doc: PDFKit.PDFDocument, y: number, color: string, label: string, value: string) {
  doc.fontSize(8.5).font("Helvetica-Bold").fillColor(color).text("- ", 40, y, { continued: true })
    .fillColor(INK).text(`${label}: `, { continued: true })
    .font("Helvetica").fillColor(MUTED).text(value);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number, width: number): number {
  doc.fontSize(10).font("Helvetica-Bold").fillColor(INK).text(title.toUpperCase(), 40, y);
  doc.moveTo(40, y + 13).lineTo(40 + width, y + 13).strokeColor(LINE).stroke();
  return y + 20;
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > 745) {
    doc.addPage();
    return 40;
  }
  return y;
}

// Re-exported so callers assembling a snapshot (camSnapshot.ts) can reuse
// the same Latin-1-safety helpers this module already depends on, without
// a second, drifting copy.
export { isPdfRenderable, sanitizeForPdf, renderableOrPlaceholder, truncateNotes };
