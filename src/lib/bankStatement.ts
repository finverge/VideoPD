import path from "path";
import os from "os";
import { mkdtemp, rm } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Bank statement extraction + basic eligibility (VideoPD Step 4, this
 * conversation's explicit ask): local extraction via PDF text-layer parsing
 * or ICR/OCR — never a paid statement-analyzer service like Perfios.
 *
 * Two-stage pipeline:
 *   1. Extraction (extractText) — PDF text layer if present; else OCR
 *      (Tesseract.js) directly for an uploaded image; else, for a scanned/
 *      image-only PDF (no usable text layer), rasterizes each page to a PNG
 *      (scripts/rasterize-pdf.py, PyMuPDF — a real, pip-installable-without-
 *      a-native-compiler renderer, confirmed present in this environment)
 *      and OCRs each rendered page. This used to be flagged NEEDS_REVIEW
 *      outright with no fallback attempted — see docs/videopd-future-work.md
 *      item 6 for why that was the case and why it no longer is.
 *   2. Structuring + eligibility (parseTransactions / computeMetrics /
 *      computeEligibility) — rule-based, transparent, ADVISORY ONLY. Per BRD
 *      Section 7.2 ("Automated non-underwriter-reviewed credit decisioning"
 *      is explicitly out of scope), this never auto-approves or auto-rejects
 *      — it only ever produces a flag + reasons for the underwriter to read.
 */

export interface StatementTransaction {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number;
}

export interface StatementMetrics {
  transactionCount: number;
  avgBalance: number;
  minBalance: number;
  totalCredits: number;
  totalDebits: number;
  bounceCount: number;
  emiOutflow: number;
  estimatedMonthlyIncome: number;
  monthsSpanned: number;
}

export type EligibilityFlag = "ELIGIBLE" | "NEEDS_REVIEW" | "NOT_ELIGIBLE";

const BOUNCE_PATTERN = /\b(bounce|return|insufficient|dishonour|dishonor|ecs return|cheque return)\b/i;
const EMI_PATTERN = /\b(emi|loan repay|installment|instalment)\b/i;
const AMOUNT_PATTERN = /\d[\d,]*\.\d{2}/g;
const DATE_PATTERN = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;

export interface PdfInfo {
  Producer?: string;
  Creator?: string;
  CreationDate?: string;
  ModDate?: string;
}

const SCANNED_PDF_MAX_PAGES = 15;
// A rendered page beyond this many raw OCR characters is "found real text on
// this page" — same 40-char floor already used for the plain-image path,
// applied per-page instead of once, so a mostly-blank first page doesn't
// mask real text further in.
const MIN_TEXT_LENGTH = 40;

async function ocrScannedPdf(absoluteFilePath: string): Promise<string | null> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "scanned-pdf-"));
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "rasterize-pdf.py");
    const { stdout } = await execFileAsync(
      "python",
      [scriptPath, absoluteFilePath, tmpDir, String(SCANNED_PDF_MAX_PAGES)],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const result = JSON.parse(stdout) as { pageCount: number; renderedPages: number; files: string[] };
    if (result.files.length === 0) return null;

    const Tesseract = await import("tesseract.js");
    const pageTexts: string[] = [];
    for (const pngPath of result.files) {
      const { data } = await Tesseract.recognize(pngPath, "eng");
      pageTexts.push(data.text.trim());
    }
    return pageTexts.join("\n\n").trim();
  } catch (e) {
    console.error("[bankStatement.ocrScannedPdf] rasterize/OCR failed:", e);
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractText(
  absoluteFilePath: string,
  mimeType: string
): Promise<{ text: string; status: "EXTRACTED" | "NEEDS_REVIEW" | "FAILED"; pdfInfo: PdfInfo | null; revisionCount: number | null; viaOcr: boolean }> {
  try {
    if (mimeType === "application/pdf") {
      // Runs as a separate `node` child process — see scripts/extract-pdf.js
      // for why: pdf-parse's vendored pdf.js corrupts across repeated calls
      // inside Next's long-lived dev-server process, in ways that persisted
      // through every in-process fix attempted (module.parent workarounds,
      // requiring its inner module directly, serverExternalPackages). A
      // fresh one-shot process is the one environment this was verified to
      // work reliably in.
      const scriptPath = path.join(process.cwd(), "scripts", "extract-pdf.js");
      const { stdout } = await execFileAsync("node", [scriptPath, absoluteFilePath], { maxBuffer: 20 * 1024 * 1024 });
      const result = JSON.parse(stdout) as { text: string; info: PdfInfo | null; revisionCount: number };
      const text = result.text.trim();
      if (text.length >= MIN_TEXT_LENGTH) {
        return { text, status: "EXTRACTED", pdfInfo: result.info, revisionCount: result.revisionCount, viaOcr: false };
      }

      // No usable native text layer — likely a scanned/image-only PDF.
      // Rasterize each page and OCR it (see ocrScannedPdf above) rather than
      // flagging NEEDS_REVIEW outright.
      const ocrText = await ocrScannedPdf(absoluteFilePath);
      if (ocrText && ocrText.length >= MIN_TEXT_LENGTH) {
        return { text: ocrText, status: "EXTRACTED", pdfInfo: result.info, revisionCount: result.revisionCount, viaOcr: true };
      }
      // Rasterize/OCR itself failed, or still came back too short (a
      // genuinely blank/unreadable scan) — flag for manual review, same as
      // before this fallback existed, rather than guess at near-nothing.
      return { text: ocrText ?? text, status: "NEEDS_REVIEW", pdfInfo: result.info, revisionCount: result.revisionCount, viaOcr: !!ocrText };
    }

    if (mimeType.startsWith("image/")) {
      const Tesseract = await import("tesseract.js");
      const { data } = await Tesseract.recognize(absoluteFilePath, "eng");
      const text = data.text.trim();
      // No PDF structure on a raw image — the metadata/revision checks
      // below simply don't apply here, not "checked and clean".
      if (text.length < MIN_TEXT_LENGTH) return { text, status: "NEEDS_REVIEW", pdfInfo: null, revisionCount: null, viaOcr: true };
      return { text, status: "EXTRACTED", pdfInfo: null, revisionCount: null, viaOcr: true };
    }

    return { text: "", status: "FAILED", pdfInfo: null, revisionCount: null, viaOcr: false };
  } catch (e) {
    console.error("[bankStatement.extractText] extraction failed:", e);
    return { text: "", status: "FAILED", pdfInfo: null, revisionCount: null, viaOcr: false };
  }
}

/** Parses OCR/PDF-text-layer output into transaction rows. Column layout
 * doesn't survive OCR reliably (whitespace collapses, debit/credit columns
 * can't be told apart by position alone), so this deliberately infers
 * debit-vs-credit from the balance *delta* between consecutive dated lines
 * rather than trying to guess which number is which column — the balance
 * figure is the one thing that stays unambiguous line to line.
 *
 * Grouped into one record per date-line before extraction (a record runs
 * until the next date-line or end of text), not one record per raw line —
 * confirmed against a real bank statement PDF export where a transaction's
 * date, description, and numbers each land on their own line (no
 * whitespace between adjacent amount columns once flattened to text), so
 * requiring a date and an amount on the *same* line matched zero rows on
 * a real, correctly-extracted statement. Grouping first, then running the
 * same amount extraction against the joined record text, recovers those
 * without changing how amounts themselves are read.
 */
export function parseTransactions(rawText: string): StatementTransaction[] {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const records: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (DATE_PATTERN.test(line)) {
      if (current.length > 0) records.push(current.join(" "));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
    // Lines before the first date-line (account summary, column headers,
    // branch address, etc.) belong to no record — dropped, not guessed at.
  }
  if (current.length > 0) records.push(current.join(" "));

  const rows: StatementTransaction[] = [];
  let previousBalance: number | null = null;

  for (const record of records) {
    const dateMatch = record.match(DATE_PATTERN);
    if (!dateMatch) continue;

    const amounts = record.match(AMOUNT_PATTERN);
    if (!amounts || amounts.length === 0) continue;

    const parseAmt = (s: string) => parseFloat(s.replace(/,/g, ""));
    const balance = parseAmt(amounts[amounts.length - 1]);
    const txnAmount = amounts.length >= 2 ? parseAmt(amounts[amounts.length - 2]) : null;

    const description = record
      .replace(DATE_PATTERN, "")
      .replace(new RegExp(amounts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"), "")
      .trim();

    let debit: number | null = null;
    let credit: number | null = null;
    if (txnAmount !== null && previousBalance !== null) {
      if (balance >= previousBalance) credit = txnAmount;
      else debit = txnAmount;
    }
    // First row (opening balance) or a row we can't sign — record the
    // balance for delta tracking but don't count it as a transaction amount.

    rows.push({ date: dateMatch[1], description, debit, credit, balance });
    previousBalance = balance;
  }

  return rows;
}

export interface AuthenticityCheckResult {
  status: "PASSED" | "FLAGGED" | "NOT_APPLICABLE";
  reasons: string[];
}

// Tools that generate/produce a bank statement are core-banking or reporting
// systems (Crystal Reports, iText, internal PDF libraries) — an image/design
// editor appearing as the Producer or Creator on a "bank statement" is a real
// red flag, not a guess: banks don't generate statements in Photoshop.
const SUSPICIOUS_PDF_TOOLS = /photoshop|illustrator|gimp|paint\.net|canva|indesign|affinity/i;

// A PDF's own CreationDate/ModDate differing by more than this is treated as
// "genuinely edited after generation", not just a multi-step generation
// process finishing a few seconds apart. A heuristic threshold, not a
// calibrated forensic standard — stated as such wherever this fires.
const MOD_DATE_GRACE_MS = 5 * 60 * 1000;

// PDF date strings look like "D:20230615120000+05'30'" or a bare
// "20230615120000" — parses the fixed year/month/day/hour/minute/second
// prefix all PDF generators use, ignoring the trailing timezone offset
// (only relative gap between two such dates matters here, and both come
// from the same document).
function parsePdfInfoDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/D?:?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Real, deterministic PDF structural/metadata tamper signals — not a
 * forensic-ML claim, just inspecting what's actually in the file:
 *
 * 1. Revision count: a legitimately single-pass-generated PDF has exactly
 *    one "%%EOF" marker; a PDF later opened and re-saved by an editor gets a
 *    new revision appended with its own "%%EOF" (a real, standard PDF
 *    structural fact, not invented for this — see extract-pdf.js's
 *    countRevisions). More than one means the file was saved again after
 *    its original creation.
 * 2. Producer/Creator naming an image/design editor rather than a document
 *    generator — a bank statement produced in Photoshop is itself the tell.
 * 3. ModDate meaningfully after CreationDate — the file's own internal
 *    timestamps saying it was edited after being generated.
 *
 * NOT attempted, and explicitly out of scope: detecting a doctored logo or
 * altered visual content within the page image itself. That needs real
 * image-forensics ML (error-level analysis, copy-move forgery detection) —
 * the same "genuinely hard ML problem, no credible path without a trained
 * model or vendor" category as deepfake/lip-sync detection elsewhere in this
 * app (see docs/videopd-future-work.md) — not attempted rather than faked.
 */
export function checkPdfMetadata(info: PdfInfo | null, revisionCount: number | null): AuthenticityCheckResult {
  if (revisionCount === null) {
    return { status: "NOT_APPLICABLE", reasons: ["Statement was submitted as an image, not a PDF — no PDF structure to check."] };
  }

  const reasons: string[] = [];

  if (revisionCount > 1) {
    reasons.push(
      `This PDF has been saved ${revisionCount} times (${revisionCount} revision markers found in the file) — a bank-generated statement is normally produced once and never re-saved. Worth confirming this is the original file from the bank.`
    );
  }

  const producer = info?.Producer ?? "";
  const creator = info?.Creator ?? "";
  if (SUSPICIOUS_PDF_TOOLS.test(producer) || SUSPICIOUS_PDF_TOOLS.test(creator)) {
    reasons.push(`This PDF's own metadata names "${producer || creator}" as the tool that produced or last touched it — an image/design editor, not a banking or reporting system.`);
  }

  const created = parsePdfInfoDate(info?.CreationDate);
  const modified = parsePdfInfoDate(info?.ModDate);
  if (created && modified && modified.getTime() - created.getTime() > MOD_DATE_GRACE_MS) {
    reasons.push(
      `This PDF's internal "last modified" timestamp is after its "created" timestamp by more than a few minutes — its own metadata says it was edited after being generated.`
    );
  }

  return { status: reasons.length > 0 ? "FLAGGED" : "PASSED", reasons };
}

// ₹1 tolerance for rounding/extraction noise, not a wide berth.
const BALANCE_RECONCILIATION_TOLERANCE = 1;

/**
 * Real, non-circular arithmetic tamper signal: each row's transaction
 * amount and its running balance are extracted independently from the same
 * line (see parseTransactions — the balance-delta comparison only decides
 * debit-vs-credit's SIGN; the amount's own VALUE comes from a separate
 * capture group on the same line, so nothing forces them to already agree).
 * Verifying the balance actually moved by the stated transaction amount is
 * the classic tell of a doctored statement — a number edited on one line
 * without correcting the running balance underneath. Real math against
 * really-independently-extracted numbers, same footing as every other
 * check in this codebase — an arithmetic fact, not a forensic claim.
 *
 * Honest caveat, stated in the result: on an OCR-extracted (image)
 * statement rather than a PDF text layer, a mismatch is more likely to be
 * innocent digit-misreading noise than on a PDF, where extraction is exact.
 */
export function checkTransactionIntegrity(rows: StatementTransaction[], extractedViaOcr: boolean): AuthenticityCheckResult {
  let mismatchCount = 0;
  let previousBalance: number | null = null;

  for (const row of rows) {
    const amount = row.credit ?? row.debit ?? null;
    if (amount !== null && previousBalance !== null) {
      const actualDelta = Math.abs(row.balance - previousBalance);
      if (Math.abs(actualDelta - amount) > BALANCE_RECONCILIATION_TOLERANCE) mismatchCount++;
    }
    previousBalance = row.balance;
  }

  if (mismatchCount === 0) {
    return { status: "PASSED", reasons: [] };
  }

  const noise = extractedViaOcr
    ? " This statement was read via OCR rather than a PDF text layer, so this may also reflect digit-misreading noise rather than tampering — worth checking against the original document either way."
    : "";
  return {
    status: "FLAGGED",
    reasons: [`${mismatchCount} transaction${mismatchCount === 1 ? "" : "s"} where the stated running balance doesn't reconcile with the transaction amount on that line.${noise}`],
  };
}

export function computeMetrics(rows: StatementTransaction[]): StatementMetrics {
  const withAmount = rows.filter((r) => r.debit !== null || r.credit !== null);
  const balances = rows.map((r) => r.balance);
  const totalCredits = withAmount.reduce((s, r) => s + (r.credit ?? 0), 0);
  const totalDebits = withAmount.reduce((s, r) => s + (r.debit ?? 0), 0);
  const bounceCount = rows.filter((r) => BOUNCE_PATTERN.test(r.description)).length;
  const emiOutflow = withAmount.filter((r) => EMI_PATTERN.test(r.description) && r.debit).reduce((s, r) => s + (r.debit ?? 0), 0);

  // Recurring-amount credits (same amount appearing 2+ times) as an income
  // proxy — closer to a real salary/regular-income signal than a flat
  // average of every credit, which would be skewed by one-off deposits.
  const creditAmounts = withAmount.filter((r) => r.credit).map((r) => r.credit as number);
  const counts = new Map<number, number>();
  for (const amt of creditAmounts) counts.set(amt, (counts.get(amt) ?? 0) + 1);
  const recurring = [...counts.entries()].filter(([, n]) => n >= 2);

  const dates = rows.map((r) => parseStatementDate(r.date)).filter((d): d is Date => d !== null);
  const monthsSpanned = dates.length >= 2
    ? Math.max(1, Math.round((Math.max(...dates.map((d) => d.getTime())) - Math.min(...dates.map((d) => d.getTime()))) / (1000 * 60 * 60 * 24 * 30)))
    : 1;

  const recurringTotal = recurring.reduce((s, [amt, n]) => s + amt * n, 0);
  const estimatedMonthlyIncome = recurringTotal > 0
    ? Math.round(recurringTotal / monthsSpanned)
    : Math.round(totalCredits / monthsSpanned);

  return {
    transactionCount: withAmount.length,
    avgBalance: balances.length ? Math.round(balances.reduce((a, b) => a + b, 0) / balances.length) : 0,
    minBalance: balances.length ? Math.min(...balances) : 0,
    totalCredits: Math.round(totalCredits),
    totalDebits: Math.round(totalDebits),
    bounceCount,
    emiOutflow: Math.round(emiOutflow),
    estimatedMonthlyIncome,
    monthsSpanned,
  };
}

function parseStatementDate(s: string): Date | null {
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(year, Number(mo) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

export function computeEligibility(metrics: StatementMetrics): { flag: EligibilityFlag; reasons: string[] } {
  const reasons: string[] = [];

  if (metrics.transactionCount < 5) {
    reasons.push(`Only ${metrics.transactionCount} transaction(s) could be parsed from this statement — too few for a reliable assessment. Recommend requesting a clearer statement or manual review.`);
    return { flag: "NEEDS_REVIEW", reasons };
  }

  if (metrics.bounceCount >= 3) {
    reasons.push(`${metrics.bounceCount} bounced/returned transactions found in the statement period.`);
    return { flag: "NOT_ELIGIBLE", reasons };
  }
  if (metrics.minBalance < 0) {
    reasons.push("Account balance went negative at least once during the statement period.");
    return { flag: "NOT_ELIGIBLE", reasons };
  }

  let needsReview = false;
  if (metrics.bounceCount > 0) {
    reasons.push(`${metrics.bounceCount} bounced/returned transaction(s) found — review before approval.`);
    needsReview = true;
  }
  if (metrics.estimatedMonthlyIncome > 0) {
    const emiPerMonth = metrics.emiOutflow / metrics.monthsSpanned;
    const burden = emiPerMonth / metrics.estimatedMonthlyIncome;
    if (burden > 0.5) {
      reasons.push(`Existing EMI/loan outflow is ~${Math.round(burden * 100)}% of estimated monthly income (recommended ceiling: 50%).`);
      needsReview = true;
    }
  }

  if (needsReview) return { flag: "NEEDS_REVIEW", reasons };

  reasons.push("No bounced transactions; balance and income patterns from the statement appear healthy.");
  return { flag: "ELIGIBLE", reasons };
}

export function absoluteUploadPath(relativeFilePath: string): string {
  return path.join(process.cwd(), relativeFilePath);
}
